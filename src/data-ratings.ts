import {
  isMonitorAccessorySheetCategory,
  isProjectorAccessorySheetCategory,
  pruneOlderUploads,
  productMatchesCategoryRollup,
} from "./data";
import type { SubCategory } from "./types";
import type { ParsedRatingsRow, RatingsCellLabels } from "./parsers-ratings";
import { supabase } from "./supabase";
import type { Marketplace, SubCategoryFilter } from "./types";
import { normalizeKey } from "./utils";

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
  const batchSize = 400;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(getErrorMessage(error));
  }
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
 * Match ratings master rows using **Category / Sub Category** columns from the sheet
 * (same layout as sellout). Model-name inference is fallback only — avoids e.g. a
 * projector title containing "screen" being dropped from the Projectors filter.
 */
export function ratingsRowMatchesSubCategory(
  row: Pick<ProductRatingsRow, "model_name" | "category" | "sub_category">,
  filter: SubCategoryFilter,
): boolean {
  if (filter === "all") return true;

  const sub = normalizeKey(row.sub_category ?? "");
  const cat = String(row.category ?? "").trim();

  if (filter === "projector") {
    if (sub !== "projector" && sub !== "projectors") return false;
    if (!cat) return true;
    return isProjectorAccessorySheetCategory(cat) || normalizeKey(cat).includes("projector");
  }

  if (filter === "projector_screen") {
    if (!sub.includes("screen")) return false;
    if (!cat) return true;
    return isProjectorAccessorySheetCategory(cat) || normalizeKey(cat).includes("projector");
  }

  if (filter === "projector_stand") {
    if (!sub.includes("stand")) return false;
    if (!cat) return true;
    return isProjectorAccessorySheetCategory(cat) || normalizeKey(cat).includes("projector");
  }

  if (filter === "monitor") {
    if (sub !== "monitor" && sub !== "monitors") return false;
    if (!cat) return true;
    return isMonitorAccessorySheetCategory(cat);
  }

  if (filter === "monitor_arm") {
    if (sub.includes("arm")) {
      if (!cat) return true;
      return isMonitorAccessorySheetCategory(cat) || normalizeKey(cat).includes("monitor");
    }
    return productMatchesCategoryRollup("monitor_arm", {
      product_name: row.model_name,
      category: row.category,
      sub_category: row.sub_category,
    });
  }

  return productMatchesCategoryRollup(filter as SubCategory, {
    product_name: row.model_name,
    category: row.category,
    sub_category: row.sub_category,
  });
}

export async function loadRatingsDashboardRows(
  marketplace: Marketplace,
  subCategory: SubCategoryFilter,
): Promise<ProductRatingsRow[]> {
  const { data: upload, error: uploadErr } = await supabase
    .from("uploads")
    .select("id, snapshot_date")
    .eq("upload_kind", "ratings_ranking")
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (uploadErr) throw new Error(getErrorMessage(uploadErr));
  if (!upload?.id) return [];

  const { data, error } = await supabase
    .from("product_ratings_snapshot")
    .select(
      "product_code, model_name, category, sub_category, remarks, review_y, review_count_y, rank_y, review_t, review_count_t, rank_t, cell_labels, snapshot_date",
    )
    .eq("upload_id", upload.id)
    .eq("marketplace", marketplace);
  if (error) {
    if (isMissingSchemaError(error, "product_ratings_snapshot")) return [];
    if (isMissingSchemaError(error, "cell_labels")) {
      const fallback = await supabase
        .from("product_ratings_snapshot")
        .select(
          "product_code, model_name, category, sub_category, remarks, review_y, review_count_y, rank_y, review_t, review_count_t, rank_t, snapshot_date",
        )
        .eq("upload_id", upload.id)
        .eq("marketplace", marketplace);
      if (fallback.error) throw new Error(getErrorMessage(fallback.error));
      const snapshotDate = String(upload.snapshot_date ?? "");
      return ((fallback.data ?? []) as ProductRatingsRow[])
        .filter((row) => {
          if (!isActiveRemarks(row.remarks)) return false;
          return ratingsRowMatchesSubCategory(row, subCategory);
        })
        .map((row) => ({ ...row, cell_labels: {}, snapshot_date: snapshotDate }));
    }
    throw new Error(getErrorMessage(error));
  }

  const snapshotDate = String(upload.snapshot_date ?? "");
  const rows = ((data ?? []) as ProductRatingsRow[]).filter((row) => {
    if (!isActiveRemarks(row.remarks)) return false;
    return ratingsRowMatchesSubCategory(row, subCategory);
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
    cell_labels: (row.cell_labels ?? {}) as RatingsCellLabels,
    snapshot_date: snapshotDate,
  }));
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
}): Promise<string> {
  const priorFlipkart = await loadPriorFlipkartRatingsMap();

  const { data: uploadRow, error: uploadErr } = await supabase
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
      notes: `Ratings — Amazon ${payload.amazonCount} · Flipkart ${payload.flipkartCount}`,
    })
    .select("id")
    .single();

  if (uploadErr) {
    const msg = getErrorMessage(uploadErr).toLowerCase();
    if (
      msg.includes("upload_kind") ||
      msg.includes("product_ratings_snapshot") ||
      msg.includes("cell_labels")
    ) {
      throw new Error(
        "Ratings schema missing or outdated. Run migrations 010 and 011 in Supabase (or supabase/run-ratings-ranking.sql + run-ratings-cell-labels.sql), then retry.",
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
