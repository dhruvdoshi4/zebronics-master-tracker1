import {
  isMonitorAccessorySheetCategory,
  isProjectorAccessorySheetCategory,
  pruneOlderUploads,
  productMatchesAnyCoreSelloutCategory,
  productMatchesCategoryRollup,
} from "./data";
import { productMatchesWorkspaceDashboardScope } from "./marketplace-dashboard-scope";
import {
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_PRAVIN,
  uploadNotesForCatalogWorkspace,
  uploadRowBelongsToCatalogWorkspace,
  type CatalogWorkspace,
} from "./catalog-workspace";
import {
  karanDashboardSheetCategory,
  karanDashboardSubCategoryLabel,
} from "./karan-category-scope";
import { pravinDashboardSheetCategory } from "./pravin-category-scope";
import {
  rowBelongsToManagerDashboard,
  resolveManagerDashboardScopeContext,
} from "./manager-dashboard-scope";
import { ADMIN_MANAGER_WORKSPACES } from "./admin-realm";
import type { LegacyMarketplace } from "./types";
import { getActiveCatalogWorkspace } from "./workspace-catalog-scope";
import { getActiveDataScope } from "./workspace-data-scope";
import type { SubCategory } from "./types";
import type { ParsedRatingsRow, RatingsCellLabels } from "./parsers-ratings";
import { supabase } from "./supabase";
import type { Marketplace, SubCategoryFilter } from "./types";
import { normalizeKey } from "./utils";

/** Sheet Category / Sub category filters (same as Amazon PO dashboard). */
export type RatingsSheetFilter = {
  category: string;
  sheetSubCategory: string;
};

export function ratingsRowMatchesMarketplaceDashboardScope(
  row: Pick<ProductRatingsRow, "model_name" | "category" | "sub_category">,
): boolean {
  return productMatchesWorkspaceDashboardScope({
    category: row.category,
    sub_category: row.sub_category,
    product_name: row.model_name,
  });
}

export function ratingsRowMatchesSheetFilter(
  row: Pick<ProductRatingsRow, "category" | "sub_category" | "model_name">,
  filter: RatingsSheetFilter,
  marketplace?: LegacyMarketplace,
  catalogWorkspace = getActiveCatalogWorkspace(),
): boolean {
  if (filter.category === "all") return true;
  if (catalogWorkspace === CATALOG_WORKSPACE_PERSONAL_AUDIO && marketplace) {
    const sheetCat = karanDashboardSheetCategory(
      {
        category: row.category,
        sub_category: row.sub_category,
        product_name: row.model_name,
      },
      marketplace,
    );
    if (sheetCat !== filter.category) return false;
    if (filter.sheetSubCategory !== "all") {
      const label = karanDashboardSubCategoryLabel(
        {
          category: row.category,
          sub_category: row.sub_category,
          product_name: row.model_name,
        },
        marketplace,
      );
      if (label !== filter.sheetSubCategory) return false;
    }
    return true;
  }
  if (catalogWorkspace === CATALOG_WORKSPACE_PRAVIN) {
    const sheetCat = pravinDashboardSheetCategory({
      category: row.category,
      sub_category: row.sub_category,
      product_name: row.model_name,
    });
    if (sheetCat !== filter.category) return false;
    if (filter.sheetSubCategory !== "all") {
      if ((row.sub_category ?? "").trim() !== filter.sheetSubCategory) return false;
    }
    return true;
  }
  if ((row.category ?? "").trim() !== filter.category) return false;
  if (filter.sheetSubCategory !== "all") {
    if ((row.sub_category ?? "").trim() !== filter.sheetSubCategory) return false;
  }
  return true;
}

function ratingsRowMatchesCatalogScope(
  row: Pick<ProductRatingsRow, "model_name" | "category" | "sub_category">,
  marketplace: Marketplace,
  catalogWorkspace: ReturnType<typeof getActiveCatalogWorkspace>,
): boolean {
  const legacy =
    marketplace === "amazon" || marketplace === "flipkart" ? marketplace : "amazon";
  return rowBelongsToManagerDashboard(
    {
      category: row.category,
      sub_category: row.sub_category,
      product_name: row.model_name,
    },
    resolveManagerDashboardScopeContext({
      catalogWorkspace,
      marketplace: legacy,
    }),
  );
}

export type ProductRatingsRow = {
  product_code: string;
  model_name: string;
  category: string;
  sub_category: string;
  remarks: string;
  review_y: number | null;
  review_count_y: number | null;
  rank_y: number | null;
  review_t: number | null;
  review_count_t: number | null;
  rank_t: number | null;
  cell_labels: RatingsCellLabels;
  snapshot_date: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Unknown error";
}

function isMissingSchemaError(error: unknown, token: string): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes(token.toLowerCase()) && msg.includes("does not exist");
}

function isCellLabelsColumnError(error: unknown): boolean {
  return getErrorMessage(error).toLowerCase().includes("cell_labels");
}

const RATINGS_SNAPSHOT_COLUMNS =
  "product_code, model_name, category, sub_category, remarks, review_y, review_count_y, rank_y, review_t, review_count_t, rank_t";

type RatingsSnapshotDbRow = Omit<ProductRatingsRow, "snapshot_date">;

/** PostgREST caps at 1000 rows per request — paginate so Amazon tab (1100+ SKUs) is complete. */
async function fetchAllRatingsSnapshotRows(
  uploadId: string,
  marketplace?: Marketplace,
): Promise<RatingsSnapshotDbRow[]> {
  const pageSize = 1000;
  const all: RatingsSnapshotDbRow[] = [];
  let from = 0;
  let withLabels = true;

  for (;;) {
    const columns = withLabels
      ? `${RATINGS_SNAPSHOT_COLUMNS}, cell_labels`
      : RATINGS_SNAPSHOT_COLUMNS;
    let query = supabase
      .from("product_ratings_snapshot")
      .select(columns)
      .eq("upload_id", uploadId);
    if (marketplace) {
      query = query.eq("marketplace", marketplace);
    }
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) {
      if (withLabels && isCellLabelsColumnError(error)) {
        withLabels = false;
        from = 0;
        all.length = 0;
        continue;
      }
      throw new Error(getErrorMessage(error));
    }
    const batch = (data ?? []) as unknown as RatingsSnapshotDbRow[];
    for (const row of batch) {
      all.push({
        ...row,
        cell_labels: (row.cell_labels ?? {}) as RatingsCellLabels,
      });
    }
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

async function upsertRatingsSnapshotRows(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  try {
    await upsertInBatches(
      "product_ratings_snapshot",
      rows,
      "upload_id,marketplace,product_code",
    );
  } catch (error) {
    if (!isCellLabelsColumnError(error)) throw error;
    const withoutLabels = rows.map(({ cell_labels: _c, ...rest }) => rest);
    await upsertInBatches(
      "product_ratings_snapshot",
      withoutLabels,
      "upload_id,marketplace,product_code",
    );
  }
}

function isActiveRemarks(remarks: string): boolean {
  const r = normalizeKey(remarks);
  if (!r) return true;
  return !r.includes("eol") && r !== "rfo";
}

async function upsertInBatches(table: string, rows: unknown[], onConflict: string) {
  const { upsertSupabaseParallel } = await import("./xlsx-fast");
  await upsertSupabaseParallel(table, rows, onConflict, { batchSize: 600, concurrency: 4 });
}

async function loadPriorFlipkartRatingsMap(): Promise<
  Map<string, Pick<ParsedRatingsRow, "review_t" | "review_count_t" | "rank_t">>
> {
  const map = new Map<string, Pick<ParsedRatingsRow, "review_t" | "review_count_t" | "rank_t">>();
  const { data: upload, error: uploadErr } = await supabase
    .from("uploads")
    .select("id")
    .eq("upload_kind", "ratings_ranking")
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (uploadErr || !upload?.id) return map;

  const { data, error } = await supabase
    .from("product_ratings_snapshot")
    .select("product_code, review_t, review_count_t, rank_t")
    .eq("upload_id", upload.id)
    .eq("marketplace", "flipkart");
  if (error) {
    if (isMissingSchemaError(error, "product_ratings_snapshot")) return map;
    throw new Error(getErrorMessage(error));
  }

  for (const row of data ?? []) {
    const code = String((row as { product_code: string }).product_code).trim().toUpperCase();
    map.set(code, {
      review_t: (row as { review_t: number | null }).review_t,
      review_count_t: (row as { review_count_t: number | null }).review_count_t,
      rank_t: (row as { rank_t: number | null }).rank_t,
    });
  }
  return map;
}

export async function getLatestRatingsUploadMeta(): Promise<{
  snapshotDate: string | null;
  fileName: string | null;
}> {
  const { data, error } = await supabase
    .from("uploads")
    .select("snapshot_date, file_name")
    .eq("upload_kind", "ratings_ranking")
    .eq("data_scope", getActiveDataScope())
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingSchemaError(error, "upload_kind")) return { snapshotDate: null, fileName: null };
    throw new Error(getErrorMessage(error));
  }
  if (!data) return { snapshotDate: null, fileName: null };
  return {
    snapshotDate: data.snapshot_date ? String(data.snapshot_date) : null,
    fileName: data.file_name ? String(data.file_name) : null,
  };
}

/**
 * Match ratings rows from the master workbook.
 * - **Amazon** tab: Category = "Monitor & Acc." / "Projector & Acc." + Sub Category.
 * - **Flipkart** tab: Category = "PC" (etc.) + Sub Category = "Monitor" / "Projector".
 * When Sub Category matches the filter, trust it — do not require Amazon-style category text.
 */
export function ratingsRowMatchesSubCategory(
  row: Pick<ProductRatingsRow, "model_name" | "category" | "sub_category">,
  filter: SubCategoryFilter,
): boolean {
  if (filter === "all") {
    return productMatchesAnyCoreSelloutCategory({
      product_name: row.model_name,
      category: row.category,
      sub_category: row.sub_category,
    });
  }

  const sub = normalizeKey(row.sub_category ?? "");
  const cat = String(row.category ?? "").trim();
  const catKey = normalizeKey(cat);

  if (filter === "projector") {
    if (sub === "projector" || sub === "projectors") return true;
    if (sub.includes("screen") || sub.includes("stand")) return false;
    if (!cat) return false;
    return isProjectorAccessorySheetCategory(cat) || catKey.includes("projector");
  }

  if (filter === "projector_screen") {
    if (sub.includes("screen")) return true;
    if (!cat) return false;
    return isProjectorAccessorySheetCategory(cat) || catKey.includes("projector");
  }

  if (filter === "projector_stand") {
    if (sub.includes("stand")) return true;
    if (!cat) return false;
    return isProjectorAccessorySheetCategory(cat) || catKey.includes("projector");
  }

  if (filter === "monitor") {
    if (sub === "monitor" || sub === "monitors") return true;
    if (!cat) return false;
    return isMonitorAccessorySheetCategory(cat) || catKey.includes("monitor");
  }

  if (filter === "monitor_arm") {
    if (sub.includes("arm")) return true;
    return productMatchesCategoryRollup("monitor_arm", {
      product_name: row.model_name,
      category: row.category,
      sub_category: row.sub_category,
    });
  }

  if (filter === "cartridge") {
    if (
      sub.includes("cartridge") ||
      sub.includes("toner") ||
      sub.includes("drum") ||
      sub.includes("lpc")
    ) {
      return true;
    }
  }

  return productMatchesCategoryRollup(filter as SubCategory, {
    product_name: row.model_name,
    category: row.category,
    sub_category: row.sub_category,
  });
}

export type RatingsEmptyDiagnostics = {
  hasUpload: boolean;
  fileName: string | null;
  snapshotDate: string | null;
  amazonRowsInDb: number;
  flipkartRowsInDb: number;
  channelRowsInDb: number;
  channelActiveAfterRemarks: number;
  channelMatchingSubCategory: number;
};

/** Explains why the ratings table is empty (upload vs filters vs missing Amazon rows). */
export async function getRatingsEmptyDiagnostics(
  marketplace: Marketplace,
  filter: RatingsSheetFilter,
): Promise<RatingsEmptyDiagnostics> {
  const empty: RatingsEmptyDiagnostics = {
    hasUpload: false,
    fileName: null,
    snapshotDate: null,
    amazonRowsInDb: 0,
    flipkartRowsInDb: 0,
    channelRowsInDb: 0,
    channelActiveAfterRemarks: 0,
    channelMatchingSubCategory: 0,
  };

  const { data: upload, error: uploadErr } = await supabase
    .from("uploads")
    .select("id, snapshot_date, file_name")
    .eq("upload_kind", "ratings_ranking")
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (uploadErr || !upload?.id) return empty;

  empty.hasUpload = true;
  empty.fileName = upload.file_name ? String(upload.file_name) : null;
  empty.snapshotDate = upload.snapshot_date ? String(upload.snapshot_date) : null;

  let rows: Array<{
    marketplace: Marketplace;
    category: string;
    sub_category: string;
    remarks: string;
    model_name: string;
  }>;
  try {
    const pageSize = 1000;
    rows = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("product_ratings_snapshot")
        .select("marketplace, category, sub_category, remarks, model_name")
        .eq("upload_id", upload.id)
        .range(from, from + pageSize - 1);
      if (error) return empty;
      const batch = (data ?? []) as typeof rows;
      rows.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
  } catch {
    return empty;
  }

  for (const row of rows) {
    if (row.marketplace === "amazon") empty.amazonRowsInDb += 1;
    if (row.marketplace === "flipkart") empty.flipkartRowsInDb += 1;
  }

  const channelRows = rows.filter((r) => r.marketplace === marketplace);
  empty.channelRowsInDb = channelRows.length;
  const active = channelRows.filter((r) => isActiveRemarks(r.remarks));
  empty.channelActiveAfterRemarks = active.length;
  const catalogWorkspace = getActiveCatalogWorkspace();
  const legacy =
    marketplace === "amazon" || marketplace === "flipkart" ? marketplace : "amazon";
  empty.channelMatchingSubCategory = active.filter(
    (r) =>
      ratingsRowMatchesCatalogScope(r, marketplace, catalogWorkspace) &&
      ratingsRowMatchesSheetFilter(r, filter, legacy, catalogWorkspace),
  ).length;

  return empty;
}

export async function loadRatingsDashboardRows(
  marketplace: Marketplace,
  filter?: RatingsSheetFilter,
  catalogWorkspace = getActiveCatalogWorkspace(),
): Promise<ProductRatingsRow[]> {
  const { data: uploadRows, error: uploadErr } = await supabase
    .from("uploads")
    .select("id, snapshot_date, catalog_workspace, notes")
    .eq("upload_kind", "ratings_ranking")
    .eq("data_scope", getActiveDataScope())
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(24);
  if (uploadErr) throw new Error(getErrorMessage(uploadErr));
  const upload = (uploadRows ?? []).find((row) =>
    uploadRowBelongsToCatalogWorkspace(
      row as { catalog_workspace?: string | null; notes?: string | null },
      catalogWorkspace,
    ),
  );
  if (!upload?.id) return [];

  const snapshotDate = String(upload.snapshot_date ?? "");
  let rawRows: RatingsSnapshotDbRow[];
  try {
    rawRows = await fetchAllRatingsSnapshotRows(upload.id, marketplace);
  } catch (e) {
    if (isMissingSchemaError(e, "product_ratings_snapshot")) return [];
    throw e;
  }

  const legacy =
    marketplace === "amazon" || marketplace === "flipkart" ? marketplace : "amazon";

  const rows = rawRows.filter((row) => {
    if (!isActiveRemarks(row.remarks)) return false;
    if (!ratingsRowMatchesCatalogScope(row, marketplace, catalogWorkspace)) return false;
    if (filter && !ratingsRowMatchesSheetFilter(row, filter, legacy, catalogWorkspace)) {
      return false;
    }
    return true;
  });

  rows.sort((a, b) => {
    if (marketplace === "amazon") {
      const rankA = a.rank_t ?? Number.POSITIVE_INFINITY;
      const rankB = b.rank_t ?? Number.POSITIVE_INFINITY;
      if (rankA !== rankB) return rankA - rankB;
    } else {
      const countA = a.review_count_t ?? 0;
      const countB = b.review_count_t ?? 0;
      if (countB !== countA) return countB - countA;
    }
    return a.model_name.localeCompare(b.model_name, "en-IN");
  });

  return rows.map((row) => ({
    ...row,
    cell_labels: row.cell_labels ?? {},
    snapshot_date: snapshotDate,
  }));
}

/**
 * Latest ratings/reviews/rank row for one listing (used on the product Sellout
 * Intelligence page). Unlike the dashboard loader this keeps EOL/RFO rows so the
 * product's own numbers still show, and matches the code case-insensitively.
 */
export async function loadProductRatingsRow(
  marketplace: Marketplace,
  productCode: string,
  catalogWorkspace = getActiveCatalogWorkspace(),
): Promise<ProductRatingsRow | null> {
  const code = productCode.trim();
  if (!code) return null;

  const { data: uploadRows, error: uploadErr } = await supabase
    .from("uploads")
    .select("id, snapshot_date, catalog_workspace, notes")
    .eq("upload_kind", "ratings_ranking")
    .eq("data_scope", getActiveDataScope())
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(24);
  if (uploadErr) throw new Error(getErrorMessage(uploadErr));
  const upload = (uploadRows ?? []).find((row) =>
    uploadRowBelongsToCatalogWorkspace(
      row as { catalog_workspace?: string | null; notes?: string | null },
      catalogWorkspace,
    ),
  );
  if (!upload?.id) return null;

  const lookupCode = marketplace === "flipkart" ? code.toUpperCase() : code;
  const runQuery = (columns: string) =>
    supabase
      .from("product_ratings_snapshot")
      .select(columns)
      .eq("upload_id", upload.id!)
      .eq("marketplace", marketplace)
      .ilike("product_code", lookupCode)
      .limit(1);

  let result = await runQuery(`${RATINGS_SNAPSHOT_COLUMNS}, cell_labels`);
  if (result.error && isCellLabelsColumnError(result.error)) {
    result = await runQuery(RATINGS_SNAPSHOT_COLUMNS);
  }
  if (result.error) {
    if (isMissingSchemaError(result.error, "product_ratings_snapshot")) return null;
    throw new Error(getErrorMessage(result.error));
  }

  const row = ((result.data ?? [])[0] ?? null) as unknown as RatingsSnapshotDbRow | null;
  if (!row) return null;
  return {
    ...row,
    cell_labels: row.cell_labels ?? {},
    snapshot_date: String(upload.snapshot_date ?? ""),
  };
}

/** Admin category view: merge ratings rows across all manager workspaces. */
export async function loadAdminGlobalRatingsDashboardRows(
  marketplace: Marketplace,
  filter?: RatingsSheetFilter,
): Promise<ProductRatingsRow[]> {
  const chunks = await Promise.all(
    ADMIN_MANAGER_WORKSPACES.map((workspace) =>
      loadRatingsDashboardRows(marketplace, filter, workspace),
    ),
  );
  const deduped = new Map<string, ProductRatingsRow>();
  for (const rows of chunks) {
    for (const row of rows) {
      const key = `${marketplace}:${String(row.product_code ?? "").trim().toUpperCase()}`;
      deduped.set(key, row);
    }
  }
  return [...deduped.values()];
}

/** True when most rows lack review counts (usually an upload before the column fix). */
export function ratingsRowsMissingCounts(rows: ProductRatingsRow[]): boolean {
  if (rows.length < 5) return false;
  const withCounts = rows.filter(
    (r) => r.review_count_y != null || r.review_count_t != null,
  ).length;
  return withCounts / rows.length < 0.25;
}

export async function ingestRatingsRankingUpload({
  payload,
  fileName,
  uploadedBy,
  snapshotDate,
  catalogWorkspace = getActiveCatalogWorkspace(),
}: {
  payload: {
    rows: ParsedRatingsRow[];
    amazonCount: number;
    flipkartCount: number;
    amazonWithReviewCounts: number;
  };
  fileName: string;
  uploadedBy: string;
  snapshotDate: string;
  catalogWorkspace?: CatalogWorkspace;
}): Promise<string> {
  const [priorFlipkart, uploadInsert] = await Promise.all([
    loadPriorFlipkartRatingsMap(),
    supabase
      .from("uploads")
      .insert({
        marketplace: "amazon",
        file_name: fileName,
        uploaded_by: uploadedBy,
        snapshot_date: snapshotDate,
        status: "processing",
        upload_kind: "ratings_ranking",
        raw_row_count: payload.rows.length,
        valid_row_count: payload.rows.length,
        rejected_row_count: 0,
        notes: [
          `Ratings — Amazon ${payload.amazonCount} · Flipkart ${payload.flipkartCount}`,
          uploadNotesForCatalogWorkspace(catalogWorkspace),
        ]
          .filter(Boolean)
          .join(" · "),
        catalog_workspace: catalogWorkspace,
      })
      .select("id")
      .single(),
  ]);

  const { data: uploadRow, error: uploadErr } = uploadInsert;

  if (uploadErr) {
    const msg = getErrorMessage(uploadErr).toLowerCase();
    if (
      msg.includes("upload_kind") ||
      msg.includes("product_ratings_snapshot") ||
      msg.includes("cell_labels")
    ) {
      throw new Error(
        "Ratings schema missing or outdated. Run supabase/run-ratings-ranking.sql and supabase/run-ratings-cell-labels.sql in Supabase SQL Editor, then retry.",
      );
    }
    throw new Error(getErrorMessage(uploadErr));
  }

  const uploadId = String(uploadRow!.id);

  try {
    const dbRows = payload.rows.map((row) => {
      let review_y = row.review_y;
      let review_count_y = row.review_count_y;
      let rank_y = row.rank_y;

      if (row.marketplace === "flipkart") {
        const prior = priorFlipkart.get(row.product_code);
        if (prior) {
          review_y = prior.review_t;
          review_count_y = prior.review_count_t;
          rank_y = prior.rank_t;
        }
      }

      return {
        upload_id: uploadId,
        marketplace: row.marketplace,
        product_code: row.product_code,
        model_name: row.model_name,
        category: row.category,
        sub_category: row.sub_category,
        remarks: row.remarks,
        review_y,
        review_count_y,
        rank_y,
        review_t: row.review_t,
        review_count_t: row.review_count_t,
        rank_t: row.rank_t,
        cell_labels: row.cell_labels ?? {},
        snapshot_date: snapshotDate,
      };
    });

    if (dbRows.length > 0) {
      await upsertRatingsSnapshotRows(dbRows);
    }
  } catch (e) {
    await supabase.from("uploads").delete().eq("id", uploadId);
    throw e;
  }

  await supabase
    .from("uploads")
    .update({
      status: "completed",
      notes: `Ratings: Amazon ${payload.amazonCount} · Flipkart ${payload.flipkartCount} (as on ${snapshotDate})`,
    })
    .eq("id", uploadId);

  await pruneOlderUploads(uploadId);
  return uploadId;
}
