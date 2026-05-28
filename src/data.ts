import {
  type CategoryOngoingMonthMtd,
  type CategoryPreviousMonthSo,
  type CategorySheetMonthlySellout,
  getCurrentFyStart,
  mergeCategorySheetMonthlySellout,
  previousMonthYmFromSnapshot,
} from "./category-sellout-insights";
import {
  buildComputedMetric,
  computeRecommendedPoUnits,
  poDrrForProjection,
} from "./metrics";
import {
  applyHoStockNetworkToMetricRow,
  attachHoStockNetworkFields,
  loadHoStockNetworkContext,
  usesHoStockNetworkPattern,
} from "./ho-stock-network";
import { supabase } from "./supabase";
import {
  TRACKED_SUB_CATEGORIES,
  type ComputedMetric,
  type DashboardRecord,
  type DailySale,
  type Marketplace,
  type ParsedUploadPayload,
  type ProductMaster,
  type DataScope,
  type LegacyMarketplace,
  type SubCategory,
  type UploadKind,
  isQcomMarketplace,
  isQcomSelloutMarketplace,
} from "./types";
import { isExcludedFromActiveDashboard, listAmazonHardcodedEolAsins } from "./eol";
import {
  enrichFlipkartProductName,
  findFlipkartFsnsByModelQuery,
  FLIPKART_FSN_MODEL_NAMES,
} from "./flipkart-fsn-catalog";
import {
  catalogProductName,
  isDirectListingCodeQuery,
  looksLikeProductSku,
  unifiedLookupModelName,
} from "./product-display";
import {
  buildSelloutUploadNotes,
  parseLatestDaySelloutFromUploadNotes,
  type UploadLatestDaySellout,
} from "./upload-notes";
import {
  loadProductIdMap,
  lookupCodesByErpProductId,
  lookupErpProductId,
  pickFlipkartFsn,
  resolveErpProductIdForListing,
  searchProductIdMap,
} from "./product-id-map";
import {
  buildSelloutClassificationHaystack,
  CORE_SELL_OUT_SUB_CATEGORIES,
  isCartridgeSheetCategory,
  isExcludedNonDisplaySelloutProduct,
} from "./sellout-category-scope";
import { inferSubCategoryFromProductFields, isWearableProductName } from "./parsers";
import {
  CATALOG_WORKSPACE_MONITOR,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_HOME_AUDIO,
  CATALOG_WORKSPACE_PRAVIN,
  CATALOG_WORKSPACE_RITHIKA,
  isManagerCatalogWorkspace,
  parseCatalogWorkspaceFromUploadRow,
  productMasterBelongsToWorkspace,
  uploadNotesForCatalogWorkspace,
  uploadRowBelongsToCatalogWorkspace,
  type CatalogWorkspace,
} from "./catalog-workspace";
import { getActiveCatalogWorkspace } from "./workspace-catalog-scope";
import {
  productMatchesKaranCategoryRollup,
  productMatchesKaranDashboardScope,
  type KaranSubCategory,
} from "./karan-category-scope";
import type { RithikaSubCategory } from "./rithika-category-scope";
import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  isAnalysisCategoryAll,
  isAnalysisSubCategoryAll,
} from "./analysis-category-paths";
import {
  buildDawgAnalysisCategoryTree,
  buildPravinAnalysisCategoryTree,
  mergeAnalysisCategoryTree,
  productMatchesDawgCategoryAnalysis,
  treeFromProductMasterRows,
  type AnalysisCategoryTree,
} from "./analysis-category-filters";
import { productMatchesDawgScope } from "./dawg-scope";
import { parseDawgCombinedSelloutFile } from "./parsers-dawg-sellout";
import {
  inferRithikaSubCategory,
  isLegacyRithikaStoredSubCategory,
  productMatchesRithikaCategoryRollup,
} from "./rithika-category-scope";
import {
  productMatchesPravinCategoryRollup,
  productMatchesPravinDashboardScope,
  productMatchesPravinTopCategory,
  rowPassesPravinCategoryScope,
} from "./pravin-category-scope";
import {
  productMatchesRishabhCategoryRollup,
  productMatchesRishabhDashboardScopeForMarketplace,
  rowPassesRishabhCategoryScope,
} from "./rishabh-category-scope";
import {
  rowBelongsToManagerDashboard,
  resolveManagerDashboardScopeContext,
} from "./manager-dashboard-scope";
import {
  flipkartAprilMonthCandidates,
  flipkartAprilUnitsFromMonthMap,
  repairFlipkartComputedMetric,
} from "./flipkart-sellout-kpi";
import {
  buildSheetMonthUnitsMap,
  mergeCategoryMonthlyFromTableAndDaily,
  rebuildMonthlyCombined,
} from "./sellout-monthly-map";
import { getActiveDataScope } from "./workspace-data-scope";
import { type UploadHistoryScope, uploadRowMatchesHistoryScope } from "./tenants";
import {
  formatInteger,
  normalizeKey,
  normalizeMarketplaceProductCode,
  safeUnitsSold,
} from "./utils";

export type UploadContextScope = CatalogWorkspace | DataScope;

export type WorkspaceSubCategory =
  | SubCategory
  | KaranSubCategory
  | RithikaSubCategory
  | string;

export type WorkspaceSubCategoryFilter = WorkspaceSubCategory | "all";

function isDawgUploadContextScope(scope: UploadContextScope): scope is DataScope {
  return scope === "dawg";
}

function resolveSelloutUploadScope(
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): UploadContextScope {
  return getActiveDataScope() === "dawg" ? "dawg" : catalogWorkspace;
}

function isMissingCatalogWorkspaceColumn(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("catalog_workspace") &&
    (msg.includes("does not exist") ||
      msg.includes("could not find") ||
      msg.includes("schema cache") ||
      msg.includes("pgrst"))
  );
}

function isMissingDataScopeColumn(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("data_scope") &&
    (msg.includes("does not exist") ||
      msg.includes("could not find") ||
      msg.includes("schema cache") ||
      msg.includes("pgrst"))
  );
}

function stripCatalogWorkspaceField<T extends Record<string, unknown>>(row: T): Omit<T, "catalog_workspace"> {
  const { catalog_workspace: _cw, ...rest } = row;
  return rest;
}

const OPTIONAL_METRIC_COLUMNS = [
  "prior_fy_so_units",
  "prior_year_mtd_units",
  "latest_day_so_units",
] as const;

function isMissingOptionalMetricColumn(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return OPTIONAL_METRIC_COLUMNS.some(
    (col) =>
      msg.includes(col) &&
      (msg.includes("does not exist") ||
        msg.includes("could not find") ||
        msg.includes("schema cache") ||
        msg.includes("pgrst")),
  );
}

function stripOptionalMetricFields<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out = { ...row };
  for (const col of OPTIONAL_METRIC_COLUMNS) {
    delete out[col];
  }
  return out;
}

/** Retry computed_metrics upsert when optional KPI columns are not migrated yet. */
async function upsertInBatchesAllowMissingOptionalMetricColumns(
  rows: unknown[],
  onConflict: string,
  options?: UpsertBatchOptions,
): Promise<void> {
  try {
    await upsertInBatches("computed_metrics", rows, onConflict, options);
  } catch (error) {
    if (!isMissingOptionalMetricColumn(error)) throw error;
    const stripped = (rows as Record<string, unknown>[]).map(stripOptionalMetricFields);
    await upsertInBatches("computed_metrics", stripped, onConflict, options);
  }
}

/** Columns guaranteed by base schema — safe for SELECT/UPSERT when migrations are partial. */
function toCoreComputedMetricUpsertRow(metric: ComputedMetric): Record<string, unknown> {
  return {
    marketplace: metric.marketplace,
    product_code: metric.product_code,
    as_of_date: metric.as_of_date,
    upload_id: metric.upload_id ?? null,
    inventory_units: metric.inventory_units,
    total_so_units: metric.total_so_units,
    may_mtd_units: metric.may_mtd_units,
    apr_so_units: metric.apr_so_units,
    drr_units: metric.drr_units,
    drr_28d_avg_units: metric.drr_28d_avg_units ?? 0,
    doc_days: metric.doc_days,
    purchase_order_units: metric.purchase_order_units,
  };
}

async function countMetricsForUpload(uploadId: string): Promise<number> {
  const { count, error } = await supabase
    .from("computed_metrics")
    .select("product_code", { count: "exact", head: true })
    .eq("upload_id", uploadId);
  if (error) throw new Error(getErrorMessage(error));
  return count ?? 0;
}

/** Upsert rows; if `catalog_workspace` column is not migrated yet, retry without it (uses upload notes). */
async function upsertInBatchesAllowMissingWorkspaceColumn(
  table: string,
  rows: unknown[],
  onConflict: string,
  options?: UpsertBatchOptions,
): Promise<void> {
  try {
    await upsertInBatches(table, rows, onConflict, options);
  } catch (error) {
    if (!isMissingCatalogWorkspaceColumn(error)) throw error;
    const stripped = (rows as Record<string, unknown>[]).map(stripCatalogWorkspaceField);
    await upsertInBatches(table, stripped, onConflict, options);
  }
}

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
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

export function chunkArray<T>(items: T[], chunkSize = 500): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function dedupeRowsByConflict(
  rows: unknown[],
  onConflict: string,
): Record<string, unknown>[] {
  const conflictColumns = onConflict
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (conflictColumns.length === 0) {
    return rows as Record<string, unknown>[];
  }

  const map = new Map<string, Record<string, unknown>>();
  for (const rowUnknown of rows) {
    const row = rowUnknown as Record<string, unknown>;
    const key = conflictColumns.map((col) => String(row[col] ?? "")).join("::");
    const prior = map.get(key);
    const merged = { ...(prior ?? {}), ...row };
    const priorUploadId = prior?.upload_id;
    if (priorUploadId != null && row.upload_id == null) {
      merged.upload_id = priorUploadId;
    }
    if (
      conflictColumns.includes("sale_date") &&
      (prior?.units_sold !== undefined || row.units_sold !== undefined)
    ) {
      merged.units_sold = safeUnitsSold(prior?.units_sold) + safeUnitsSold(row.units_sold);
    } else if (row.units_sold !== undefined && row.units_sold !== null) {
      merged.units_sold = safeUnitsSold(row.units_sold);
    } else if (prior?.units_sold !== undefined) {
      merged.units_sold = safeUnitsSold(prior.units_sold);
    }
    map.set(key, merged);
  }

  return [...map.values()];
}

const FLIPKART_EOL_MODELS_TABLE = "flipkart_eol_models";
const FLIPKART_EOL_FSNS_TABLE = "flipkart_eol_fsns";

function isMissingFlipkartEolTableError(error: unknown, table = FLIPKART_EOL_MODELS_TABLE): boolean {
  const msg = getErrorMessage(error);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  return (
    code === "PGRST205" ||
    new RegExp(`${table}|flipkart_eol_models|flipkart_eol_fsns|schema cache|does not exist|could not find.*table`, "i").test(
      msg,
    )
  );
}

/**
 * Keys persisted from Flipkart Remarks=EOL rows; Amazon excludes matching model names.
 * If the DB table is not migrated yet, returns empty (Amazon upload still succeeds).
 */
export async function getFlipkartEolModelNames(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from(FLIPKART_EOL_MODELS_TABLE)
    .select("model_name_normalized");
  if (error) {
    if (isMissingFlipkartEolTableError(error)) {
      console.warn(
        `[upload] Table "${FLIPKART_EOL_MODELS_TABLE}" is not available; Amazon will not filter by Flipkart EOL model names until migration 003 is applied. ${getErrorMessage(error)}`,
      );
      return new Set();
    }
    throw new Error(getErrorMessage(error));
  }
  return new Set(
    (data ?? [])
      .map((row: { model_name_normalized?: string }) =>
        String(row.model_name_normalized ?? "").trim(),
      )
      .filter(Boolean),
  );
}

/** FSNs with Remarks = EOL on the latest Flipkart sellout master (explicit only). */
export async function getFlipkartEolFsns(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from(FLIPKART_EOL_FSNS_TABLE)
    .select("product_code");
  if (error) {
    if (isMissingFlipkartEolTableError(error, FLIPKART_EOL_FSNS_TABLE)) {
      return new Set();
    }
    throw new Error(getErrorMessage(error));
  }
  return new Set(
    (data ?? [])
      .map((row: { product_code?: string }) =>
        String(row.product_code ?? "").trim().toUpperCase(),
      )
      .filter(Boolean),
  );
}

/**
 * Removes all Event SO history and legacy metrics for a channel.
 * Use before a fresh upload so partial bad ingests (e.g. Apr-25 = 216) cannot linger in charts.
 */
function isMissingCategoryMonthlyTableError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes("category_monthly_sellout") && msg.includes("does not exist");
}

/** PostgREST deletes are capped; loop until no rows remain so upserts never hit stale FKs. */
async function deleteTableRowsInBatches(
  table: "daily_sales" | "category_monthly_sellout",
  filterColumn: "marketplace",
  filterValue: Marketplace,
  batchSize = 2500,
): Promise<void> {
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq(filterColumn, filterValue)
      .limit(batchSize);
    if (error) throw new Error(getErrorMessage(error));
    const ids = (data ?? []).map((row) => Number((row as { id: number }).id));
    if (ids.length === 0) break;
    const { error: deleteError } = await supabase.from(table).delete().in("id", ids);
    if (deleteError) throw new Error(getErrorMessage(deleteError));
    if (ids.length < batchSize) break;
  }
}

export async function purgeMarketplaceSelloutHistory(
  marketplace: Marketplace,
): Promise<void> {
  await deleteTableRowsInBatches("daily_sales", "marketplace", marketplace);

  try {
    await deleteTableRowsInBatches("category_monthly_sellout", "marketplace", marketplace);
  } catch (e: unknown) {
    if (!isMissingCategoryMonthlyTableError(e)) throw e;
  }

  const { error: legacyMetricsError } = await supabase
    .from("computed_metrics")
    .delete()
    .eq("marketplace", marketplace)
    .is("upload_id", null);
  if (legacyMetricsError) throw new Error(getErrorMessage(legacyMetricsError));
}

async function deleteRowsForUploadId(
  table: "daily_sales" | "computed_metrics" | "category_monthly_sellout",
  marketplace: Marketplace,
  uploadId: string,
): Promise<void> {
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("marketplace", marketplace)
      .eq("upload_id", uploadId)
      .limit(2500);
    if (error) throw new Error(getErrorMessage(error));
    const ids = (data ?? []).map((row) => (row as { id: number }).id);
    if (ids.length === 0) break;
    const { error: deleteError } = await supabase.from(table).delete().in("id", ids);
    if (deleteError) throw new Error(getErrorMessage(deleteError));
    if (ids.length < 2500) break;
  }
}

/** After a successful sellout upload, drop rows from older uploads (batched by upload id). */
export async function pruneStaleSelloutDataForMarketplace(
  marketplace: Marketplace,
  keepUploadId: string,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
): Promise<void> {
  const isDawgScope = getActiveDataScope() === "dawg";
  let listQuery = supabase
    .from("uploads")
    .select("id, notes, data_scope")
    .eq("marketplace", marketplace)
    .neq("id", keepUploadId);
  if (isDawgScope) {
    listQuery = listQuery.eq("data_scope", "dawg");
  }
  const listRes = await listQuery;
  if (listRes.error) throw new Error(getErrorMessage(listRes.error));
  const staleUploads = ((listRes.data ?? []) as Array<{
    id: string;
    notes?: string | null;
    data_scope?: string | null;
  }>).filter((row) => parseCatalogWorkspaceFromUploadRow(row) === catalogWorkspace);

  for (const row of staleUploads ?? []) {
    const uploadId = String((row as { id: string }).id);
    await deleteRowsForUploadId("daily_sales", marketplace, uploadId);
    await deleteRowsForUploadId("computed_metrics", marketplace, uploadId);
    try {
      await deleteRowsForUploadId("category_monthly_sellout", marketplace, uploadId);
    } catch (e: unknown) {
      if (!isMissingCategoryMonthlyTableError(e)) throw e;
    }
  }

  const { error: legacySalesError } = await supabase
    .from("daily_sales")
    .delete()
    .eq("marketplace", marketplace)
    .is("upload_id", null);
  if (legacySalesError) throw new Error(getErrorMessage(legacySalesError));

  const { error: legacyMetricsError } = await supabase
    .from("computed_metrics")
    .delete()
    .eq("marketplace", marketplace)
    .is("upload_id", null);
  if (legacyMetricsError) throw new Error(getErrorMessage(legacyMetricsError));
}

export type IngestProgressUpdate = {
  message: string;
  percent?: number;
};

type UpsertBatchOptions = {
  batchSize?: number;
  concurrency?: number;
  onChunk?: (completedChunks: number, totalChunks: number) => void;
};

async function assertUploadRecordExists(uploadId: string): Promise<void> {
  const { data, error } = await supabase
    .from("uploads")
    .select("id")
    .eq("id", uploadId)
    .maybeSingle();
  if (error) throw new Error(getErrorMessage(error));
  if (!data) {
    throw new Error(
      "Upload record was not found after creation. Wait a moment and try again, or check Supabase connectivity.",
    );
  }
}

/** Wipe both channels — clears phantom Amazon/Flipkart totals on category charts. */
export async function purgeAllStaleSelloutHistory(): Promise<void> {
  await purgeMarketplaceSelloutHistory("amazon");
  await purgeMarketplaceSelloutHistory("flipkart");
}

function defaultUpsertBatchSize(table: string): number {
  return table === "daily_sales" ? 1000 : 500;
}

function defaultUpsertConcurrency(table: string): number {
  return table === "daily_sales" ? 4 : 1;
}

async function upsertInBatches(
  table: string,
  rows: unknown[],
  onConflict: string,
  options?: UpsertBatchOptions,
) {
  const overallStart = performance.now();
  const dedupeStart = performance.now();
  const dedupedRows = dedupeRowsByConflict(rows, onConflict);
  console.log(
    `[upload] dedupe ${table}: ${rows.length} -> ${dedupedRows.length} rows in ${(performance.now() - dedupeStart).toFixed(0)}ms`,
  );

  const batchSize = options?.batchSize ?? defaultUpsertBatchSize(table);
  const concurrency = options?.concurrency ?? defaultUpsertConcurrency(table);
  const chunks = chunkArray(dedupedRows, batchSize);

  const upsertChunk = async (chunk: unknown[], chunkIndex: number) => {
    const chunkStart = performance.now();
    const { error } = await (supabase as unknown as {
      from: (name: string) => {
        upsert: (
          payload: unknown[],
          options: { onConflict: string; ignoreDuplicates: boolean },
        ) => Promise<{ error: { message: string } | null }>;
      };
    })
      .from(table)
      .upsert(chunk, { onConflict, ignoreDuplicates: false });
    const chunkMs = performance.now() - chunkStart;
    console.log(
      `[upload] upsert ${table} chunk ${chunkIndex + 1}/${chunks.length} (${chunk.length} rows): ${chunkMs.toFixed(0)}ms${error ? ` ERROR: ${error.message}` : ""}`,
    );
    if (error) throw new Error(getErrorMessage(error));
  };

  for (let waveStart = 0; waveStart < chunks.length; waveStart += concurrency) {
    const wave = chunks.slice(waveStart, waveStart + concurrency);
    await Promise.all(
      wave.map((chunk, waveOffset) => upsertChunk(chunk, waveStart + waveOffset)),
    );
    options?.onChunk?.(Math.min(waveStart + wave.length, chunks.length), chunks.length);
  }

  console.log(
    `[upload] upsert ${table} total: ${(performance.now() - overallStart).toFixed(0)}ms (${chunks.length} chunks, concurrency ${concurrency})`,
  );
}

type ProductMasterUpsertRow = {
  marketplace: Marketplace;
  product_code: string;
  product_name: string;
  category: string | null;
  sub_category: string | null;
  brand: string | null;
  listing_code?: string | null;
};

/** Keep catalogue model names when a re-upload omits or mis-parses the model column. */
async function mergePreservedCatalogNames<T extends ProductMasterUpsertRow>(
  marketplace: Marketplace,
  products: T[],
): Promise<T[]> {
  if (products.length === 0) return products;

  const codes = [...new Set(products.map((product) => product.product_code))];
  const existing = new Map<string, string>();

  for (const codeChunk of chunkArray(codes, 150)) {
    const { data, error } = await supabase
      .from("product_master")
      .select("product_code, product_name")
      .eq("marketplace", marketplace)
      .in("product_code", codeChunk);

    if (error) {
      console.warn(
        "[upload] could not read existing product names for merge:",
        getErrorMessage(error),
      );
      return products;
    }

    for (const row of data ?? []) {
      const r = row as { product_code: string; product_name: string };
      existing.set(String(r.product_code), String(r.product_name ?? ""));
    }
  }

  return products.map((product) => {
    const incomingCatalog = catalogProductName(
      product.product_name,
      product.product_code,
    );
    const priorCatalog = catalogProductName(
      existing.get(product.product_code),
      product.product_code,
    );
    const product_name =
      incomingCatalog ||
      priorCatalog ||
      product.product_name.trim() ||
      existing.get(product.product_code)?.trim() ||
      product.product_code;
    return { ...product, product_name };
  });
}

export async function ingestParsedUpload({
  payload,
  marketplace,
  fileName,
  uploadedBy,
  snapshotDate,
  catalogWorkspace = CATALOG_WORKSPACE_MONITOR,
  dataScope = getActiveDataScope(),
  skipPurge = false,
  deferPrune = false,
  onProgress,
}: {
  payload: ParsedUploadPayload;
  marketplace: Marketplace;
  fileName: string;
  uploadedBy: string;
  snapshotDate: string;
  catalogWorkspace?: CatalogWorkspace;
  dataScope?: DataScope;
  /** When a parent ingest already purged this channel (e.g. QCom master). */
  skipPurge?: boolean;
  /** When pruning should run after all channels in a multi-sheet upload. */
  deferPrune?: boolean;
  onProgress?: (update: IngestProgressUpdate) => void;
}) {
  const ingestStart = performance.now();
  console.log("[upload] ingest start", {
    marketplace,
    products: payload.products.length,
    metrics: payload.metricInputs.length,
    errors: payload.errors.length,
  });

  const insertUploadStart = performance.now();
  const workspaceNote = uploadNotesForCatalogWorkspace(catalogWorkspace);
  const insertPayload: Record<string, unknown> = {
    marketplace,
    file_name: fileName,
    uploaded_by: uploadedBy,
    snapshot_date: snapshotDate,
    status: "processing",
    upload_kind: "sellout",
    raw_row_count: payload.rawCount,
    valid_row_count: payload.validCount,
    rejected_row_count: payload.errors.length + payload.ignoredCount,
    notes: workspaceNote,
    catalog_workspace: catalogWorkspace,
    data_scope: dataScope,
  };
  let insertResponse = await supabase.from("uploads").insert(insertPayload).select("*").single();
  if (insertResponse.error && isMissingCatalogWorkspaceColumn(insertResponse.error)) {
    delete insertPayload.catalog_workspace;
    insertResponse = await supabase.from("uploads").insert(insertPayload).select("*").single();
  }
  if (insertResponse.error && isMissingDataScopeColumn(insertResponse.error)) {
    delete insertPayload.data_scope;
    insertResponse = await supabase.from("uploads").insert(insertPayload).select("*").single();
  }
  const { data: upload, error: uploadCreateError } = insertResponse;
  console.log(
    `[upload] insert uploads row: ${(performance.now() - insertUploadStart).toFixed(0)}ms`,
  );
  if (uploadCreateError) {
    console.error("[upload] uploads insert FAILED — full error object:", uploadCreateError);
    console.error("[upload] full insert response:", insertResponse);
    const msg = getErrorMessage(uploadCreateError);
    if (
      /invalid input value for enum/i.test(msg) &&
      (isQcomMarketplace(marketplace) || marketplace === "consolidated")
    ) {
      throw new Error(
        `${msg}\n\nQuick Commerce channels (and consolidated catalogue) must be added in Supabase first. Run supabase/run-qcom-marketplaces.sql in the SQL Editor, then upload again.`,
      );
    }
    throw new Error(msg);
  }

  try {
    const uploadId = upload.id as string;

    if (payload.validCount === 0 || payload.products.length === 0) {
      throw new Error(
        dataScope === "dawg"
          ? 'No daWg SKUs found in this sheet. Use the daWg Sellout workbook with an "Amazon" or "Flipkart" tab and Category "Gaming - daWg" or "Personal Audio".'
          : "No tracked rows found in this sheet. Check Category / Sub Category columns and try again.",
      );
    }

    const usePostUploadCleanup = payload.dailySales.length > 0;
    if (!skipPurge) {
      if (!usePostUploadCleanup) {
        if (dataScope !== "dawg") {
          await purgeMarketplaceSelloutHistory(marketplace);
        }
      } else {
        onProgress?.({ message: "Writing sellout data (no full-table wipe)…" });
      }
    }

    onProgress?.({ message: "Saving product catalogue…" });
    const products = await mergePreservedCatalogNames(
      marketplace,
      payload.products.map((product) => ({
        ...product,
        product_name:
          product.marketplace === "flipkart"
            ? enrichFlipkartProductName(product.product_code, product.product_name)
            : product.product_name,
        sub_category: product.sub_category ?? "",
        category: product.category ?? "",
        brand: product.brand ?? "",
        catalog_workspace: catalogWorkspace,
      })),
    );

    const metrics: ComputedMetric[] = payload.metricInputs.map((input) =>
      buildComputedMetric({ ...input, upload_id: uploadId }),
    );

    if (products.length) {
      await upsertInBatchesAllowMissingWorkspaceColumn(
        "product_master",
        products,
        "marketplace,product_code",
      );
    }

    if (metrics.length) {
      const coreRows = metrics.map((metric) => toCoreComputedMetricUpsertRow(metric));
      await upsertInBatches(
        "computed_metrics",
        coreRows,
        "marketplace,product_code,as_of_date",
      );
      try {
        await upsertInBatchesAllowMissingOptionalMetricColumns(
          metrics,
          "marketplace,product_code,as_of_date",
        );
      } catch (error) {
        console.warn(
          "[upload] optional computed_metrics columns skipped:",
          getErrorMessage(error),
        );
      }
      const savedCount = await countMetricsForUpload(uploadId);
      if (savedCount === 0) {
        throw new Error(
          `Sellout KPI rows were not saved to the database (${metrics.length} parsed). ` +
            "In Supabase SQL Editor run supabase/run-pravin-metrics-complete.sql (all sections), then upload again.",
        );
      }
      console.log(
        `[upload] computed_metrics saved: ${savedCount} rows for upload ${uploadId}`,
      );
    }

    if (payload.dailySales.length) {
      await assertUploadRecordExists(uploadId);
      const dailySalesWithUpload = payload.dailySales.map((row) => ({
        ...row,
        upload_id: uploadId,
        units_sold: safeUnitsSold((row as { units_sold?: unknown }).units_sold),
      }));
      onProgress?.({
        message: `Writing ${formatInteger(dailySalesWithUpload.length)} daily sellout rows…`,
      });
      await upsertInBatches(
        "daily_sales",
        dailySalesWithUpload,
        "marketplace,product_code,sale_date",
        {
          onChunk: (done, total) => {
            if (total <= 1) return;
            const pct = Math.round((done / total) * 100);
            onProgress?.({
              message: `Daily sellout batches ${done}/${total}…`,
              percent: 40 + Math.round(pct * 0.45),
            });
          },
        },
      );
    }

    if (payload.categoryMonthlySellout.length) {
      try {
        await upsertInBatches(
          "category_monthly_sellout",
          payload.categoryMonthlySellout.map((row) => ({
            ...row,
            upload_id: uploadId,
          })),
          "upload_id,marketplace,sub_category,month_ym",
        );
      } catch (e: unknown) {
        if (isMissingCategoryMonthlyTableError(e)) {
          console.warn(
            "[upload] category_monthly_sellout table missing — run migration 006. Category charts may be wrong until then.",
          );
        } else {
          throw e;
        }
      }
    }

    if (
      marketplace === "flipkart" &&
      payload.flipkartEolModelNames &&
      payload.flipkartEolModelNames.length > 0
    ) {
      const now = new Date().toISOString();
      try {
        await upsertInBatches(
          FLIPKART_EOL_MODELS_TABLE,
          payload.flipkartEolModelNames.map((raw) => ({
            model_name_normalized: normalizeKey(raw),
            last_seen_at: now,
          })),
          "model_name_normalized",
        );
      } catch (e: unknown) {
        if (isMissingFlipkartEolTableError(e)) {
          console.warn(
            `[upload] Could not save Flipkart EOL model names — apply migration for "${FLIPKART_EOL_MODELS_TABLE}". ${getErrorMessage(e)}`,
          );
        } else {
          throw e;
        }
      }
    }

    if (
      marketplace === "flipkart" &&
      payload.flipkartEolFsns &&
      payload.flipkartEolFsns.length > 0
    ) {
      const now = new Date().toISOString();
      try {
        await upsertInBatches(
          FLIPKART_EOL_FSNS_TABLE,
          payload.flipkartEolFsns.map((fsn) => ({
            product_code: fsn.trim().toUpperCase(),
            last_seen_at: now,
          })),
          "product_code",
        );
      } catch (e: unknown) {
        if (isMissingFlipkartEolTableError(e, FLIPKART_EOL_FSNS_TABLE)) {
          console.warn(
            `[upload] Could not save Flipkart EOL FSNs — apply migration for "${FLIPKART_EOL_FSNS_TABLE}". ${getErrorMessage(e)}`,
          );
        } else {
          throw e;
        }
      }
    }

    if (payload.errors.length) {
      await upsertInBatches(
        "ingestion_errors",
        payload.errors.map((error) => ({
          upload_id: uploadId,
          row_number: error.rowNumber,
          reason: error.reason,
          raw_payload: error.payload ?? {},
        })),
        "upload_id,row_number,reason",
      );
    }

    if (marketplace === "flipkart") {
      try {
        await backfillFlipkartProductNamesFromCatalog();
      } catch (e) {
        console.warn(
          `[upload] Flipkart model-name backfill skipped: ${getErrorMessage(e)}`,
        );
      }
    }

    const finalizeStart = performance.now();
    const completedNotes = [
      workspaceNote,
      buildSelloutUploadNotes(payload),
    ]
      .filter(Boolean)
      .join("\n");
    const { error: completedError } = await supabase
      .from("uploads")
      .update({
        status: "completed",
        notes: completedNotes || null,
      })
      .eq("id", uploadId);
    console.log(
      `[upload] finalize uploads row: ${(performance.now() - finalizeStart).toFixed(0)}ms`,
    );

    if (completedError) throw new Error(getErrorMessage(completedError));

    if (usePostUploadCleanup) {
      onProgress?.({ message: "Removing rows from previous uploads…" });
      await pruneStaleSelloutDataForMarketplace(marketplace, uploadId, catalogWorkspace);
    }

    if (!deferPrune) {
      const pruned = await pruneOlderUploads(uploadId);
      if (pruned > 0) {
        console.log(`[upload] removed ${pruned} older ${marketplace} sellout upload(s)`);
      }
    }

    console.log(
      `[upload] ingest TOTAL: ${(performance.now() - ingestStart).toFixed(0)}ms`,
    );
    return uploadId;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    await supabase
      .from("uploads")
      .update({
        status: "failed",
        notes: errorMessage,
      })
      .eq("id", upload.id);
    throw new Error(errorMessage, { cause: error });
  }
}

const DASHBOARD_METRIC_COLUMNS =
  "marketplace, product_code, as_of_date, upload_id, inventory_units, total_so_units, may_mtd_units, apr_so_units, drr_units, drr_28d_avg_units, doc_days, purchase_order_units";

const DASHBOARD_METRIC_COLUMNS_WITH_OPTIONAL = `${DASHBOARD_METRIC_COLUMNS}, prior_fy_so_units, prior_year_mtd_units`;

const DASHBOARD_PRODUCT_COLUMNS =
  "product_code, product_name, category, sub_category, brand, image_url, listing_code";

function metricHasKpiData(metric: ComputedMetric): boolean {
  return (
    (metric.inventory_units ?? 0) > 0 ||
    (metric.may_mtd_units ?? 0) > 0 ||
    (metric.total_so_units ?? 0) > 0 ||
    (metric.apr_so_units ?? 0) > 0 ||
    (metric.prior_fy_so_units ?? 0) > 0 ||
    (metric.drr_units ?? 0) > 0 ||
    (metric.drr_28d_avg_units ?? 0) > 0
  );
}

function mergeDashboardMetricsIntoMap(
  target: Map<string, ComputedMetric>,
  rows: ComputedMetric[],
  marketplace: Marketplace,
  overwrite = false,
) {
  for (const metric of rows) {
    const code = normalizeMarketplaceProductCode(marketplace, metric.product_code);
    if (!code) continue;
    const existing = target.get(code);
    if (!existing) {
      target.set(code, { ...metric, product_code: code });
      continue;
    }
    if (overwrite) {
      if (metricHasKpiData(metric) || !metricHasKpiData(existing)) {
        target.set(code, { ...metric, product_code: code });
      }
      continue;
    }
    if (!metricHasKpiData(existing) && metricHasKpiData(metric)) {
      target.set(code, { ...metric, product_code: code });
    }
  }
}

/** Latest computed_metrics row per SKU (ignores upload_id — for orphaned/null upload_id rows). */
async function fetchLatestMetricsPerProductCodes(
  marketplace: Marketplace,
  productCodes: string[],
): Promise<ComputedMetric[]> {
  const out: ComputedMetric[] = [];
  const seen = new Set<string>();
  const normalized = [
    ...new Set(
      productCodes
        .map((code) => normalizeMarketplaceProductCode(marketplace, code))
        .filter(Boolean),
    ),
  ];
  for (const codeChunk of chunkArray(normalized, 100)) {
    const rows = await selectComputedMetricsByCodesOrdered(marketplace, codeChunk);
    for (const row of rows) {
      const code = normalizeMarketplaceProductCode(marketplace, row.product_code);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      out.push({ ...row, product_code: code });
    }
  }
  return out;
}

async function selectComputedMetricsByUploadId(
  marketplace: Marketplace,
  uploadId: string,
): Promise<ComputedMetric[]> {
  const withOptional = await supabase
    .from("computed_metrics")
    .select(DASHBOARD_METRIC_COLUMNS_WITH_OPTIONAL)
    .eq("marketplace", marketplace)
    .eq("upload_id", uploadId);
  if (!withOptional.error) {
    return (withOptional.data ?? []) as ComputedMetric[];
  }
  if (!isMissingOptionalMetricColumn(withOptional.error)) {
    throw new Error(getErrorMessage(withOptional.error));
  }
  const core = await supabase
    .from("computed_metrics")
    .select(DASHBOARD_METRIC_COLUMNS)
    .eq("marketplace", marketplace)
    .eq("upload_id", uploadId);
  if (core.error) throw new Error(getErrorMessage(core.error));
  return (core.data ?? []) as ComputedMetric[];
}

async function selectComputedMetricsByCodesAndUploadIds(
  marketplace: Marketplace,
  productCodes: string[],
  uploadIds: string[],
): Promise<ComputedMetric[]> {
  if (productCodes.length === 0 || uploadIds.length === 0) return [];
  const normalized = productCodes.map((code) =>
    normalizeMarketplaceProductCode(marketplace, code),
  );
  const withOptional = await supabase
    .from("computed_metrics")
    .select(DASHBOARD_METRIC_COLUMNS_WITH_OPTIONAL)
    .eq("marketplace", marketplace)
    .in("upload_id", uploadIds)
    .in("product_code", normalized);
  if (!withOptional.error) {
    return (withOptional.data ?? []) as ComputedMetric[];
  }
  if (!isMissingOptionalMetricColumn(withOptional.error)) {
    throw new Error(getErrorMessage(withOptional.error));
  }
  const core = await supabase
    .from("computed_metrics")
    .select(DASHBOARD_METRIC_COLUMNS)
    .eq("marketplace", marketplace)
    .in("upload_id", uploadIds)
    .in("product_code", normalized);
  if (core.error) throw new Error(getErrorMessage(core.error));
  return (core.data ?? []) as ComputedMetric[];
}

async function selectComputedMetricsByCodesAndDate(
  marketplace: Marketplace,
  snapshotDate: string,
  productCodes: string[],
): Promise<ComputedMetric[]> {
  if (productCodes.length === 0) return [];
  const withOptional = await supabase
    .from("computed_metrics")
    .select(DASHBOARD_METRIC_COLUMNS_WITH_OPTIONAL)
    .eq("marketplace", marketplace)
    .eq("as_of_date", snapshotDate)
    .in("product_code", productCodes);
  if (!withOptional.error) {
    return (withOptional.data ?? []) as ComputedMetric[];
  }
  if (!isMissingOptionalMetricColumn(withOptional.error)) {
    throw new Error(getErrorMessage(withOptional.error));
  }
  const core = await supabase
    .from("computed_metrics")
    .select(DASHBOARD_METRIC_COLUMNS)
    .eq("marketplace", marketplace)
    .eq("as_of_date", snapshotDate)
    .in("product_code", productCodes);
  if (core.error) throw new Error(getErrorMessage(core.error));
  return (core.data ?? []) as ComputedMetric[];
}

async function selectComputedMetricsByCodesOrdered(
  marketplace: Marketplace,
  productCodes: string[],
): Promise<ComputedMetric[]> {
  if (productCodes.length === 0) return [];
  const withOptional = await supabase
    .from("computed_metrics")
    .select(DASHBOARD_METRIC_COLUMNS_WITH_OPTIONAL)
    .eq("marketplace", marketplace)
    .in("product_code", productCodes)
    .order("as_of_date", { ascending: false });
  if (!withOptional.error) {
    return (withOptional.data ?? []) as ComputedMetric[];
  }
  if (!isMissingOptionalMetricColumn(withOptional.error)) {
    throw new Error(getErrorMessage(withOptional.error));
  }
  const core = await supabase
    .from("computed_metrics")
    .select(DASHBOARD_METRIC_COLUMNS)
    .eq("marketplace", marketplace)
    .in("product_code", productCodes)
    .order("as_of_date", { ascending: false });
  if (core.error) throw new Error(getErrorMessage(core.error));
  return (core.data ?? []) as ComputedMetric[];
}

/** Build KPI rows from daily_sales when computed_metrics are missing for this upload. */
async function hydrateDashboardMetricsFromDailySales(
  marketplace: Marketplace,
  catalogWorkspace: CatalogWorkspace,
  selloutMeta: LatestSelloutUploadMeta,
  scopeCtx: {
    catalogWorkspace: CatalogWorkspace;
    dataScope: DataScope;
  },
  target: Map<string, ComputedMetric>,
): Promise<void> {
  if (!selloutMeta.id) return;

  const { data: pmRows, error: pmErr } = await supabase
    .from("product_master")
    .select("product_code, category, sub_category, product_name, catalog_workspace")
    .eq("marketplace", marketplace);
  if (pmErr) throw new Error(getErrorMessage(pmErr));

  const codes = ((pmRows ?? []) as ProductMaster[])
    .filter((row) => {
      if (isManagerCatalogWorkspace(catalogWorkspace)) {
        return rowBelongsToManagerDashboard(row, {
          ...scopeCtx,
          marketplace: marketplace as LegacyMarketplace,
        });
      }
      return productMasterBelongsToWorkspace(row, catalogWorkspace);
    })
    .map((row) => normalizeMarketplaceProductCode(marketplace, row.product_code))
    .filter(Boolean);

  for (const code of codes) {
    if (target.has(code)) {
      const existing = target.get(code)!;
      if (
        (existing.inventory_units ?? 0) > 0 ||
        (existing.may_mtd_units ?? 0) > 0 ||
        (existing.total_so_units ?? 0) > 0
      ) {
        continue;
      }
    }
    const monthly = await getProductMonthlySellout(
      marketplace,
      code,
      catalogWorkspace,
    );
    if (monthly.length === 0) continue;
    const synthetic = buildSyntheticMetricFromMonthly(
      marketplace,
      code,
      monthly,
      selloutMeta.snapshotDate,
    );
    synthetic.upload_id = selloutMeta.id;
    target.set(code, synthetic);
  }
}

/** Load computed_metrics for a workspace dashboard, with upload_id + snapshot fallbacks. */
async function loadWorkspaceDashboardMetricsMap(
  marketplace: Marketplace,
  catalogWorkspace: CatalogWorkspace,
  selloutMeta: LatestSelloutUploadMeta,
  scopeCtx: {
    catalogWorkspace: CatalogWorkspace;
    dataScope: DataScope;
  },
): Promise<Map<string, ComputedMetric>> {
  const latestByCode = new Map<string, ComputedMetric>();

  async function fetchByUploadId(uploadId: string | null, overwrite = false) {
    if (!uploadId) return;
    const rows = await selectComputedMetricsByUploadId(marketplace, uploadId);
    mergeDashboardMetricsIntoMap(latestByCode, rows, marketplace, overwrite);
  }

  await fetchByUploadId(selloutMeta.id, true);

  if (catalogWorkspace === CATALOG_WORKSPACE_PRAVIN) {
    if (latestByCode.size === 0 && selloutMeta.snapshotDate) {
      const { data: tagged, error: taggedErr } = await supabase
        .from("product_master")
        .select("product_code")
        .eq("marketplace", marketplace)
        .eq("catalog_workspace", CATALOG_WORKSPACE_PRAVIN);
      if (taggedErr) throw new Error(getErrorMessage(taggedErr));
      const codes = ((tagged ?? []) as { product_code: string }[]).map(
        (row) => row.product_code,
      );
      for (const codeChunk of chunkArray(codes, 150)) {
        if (codeChunk.length === 0) continue;
        const rows = await selectComputedMetricsByCodesAndDate(
          marketplace,
          selloutMeta.snapshotDate,
          codeChunk,
        );
        mergeDashboardMetricsIntoMap(latestByCode, rows, marketplace, true);
      }
    }
    return latestByCode;
  }

  if (isManagerCatalogWorkspace(catalogWorkspace)) {
    const recent = await listWorkspaceSelloutUploadIds(
      marketplace,
      catalogWorkspace,
      12,
    );
    for (const upload of recent) {
      if (upload.id === selloutMeta.id) continue;
      await fetchByUploadId(upload.id);
    }
  }

  if (selloutMeta.snapshotDate) {
    const { data: pmRows, error: pmErr } = await supabase
      .from("product_master")
      .select("product_code, category, sub_category, product_name, catalog_workspace")
      .eq("marketplace", marketplace);
    if (pmErr) throw new Error(getErrorMessage(pmErr));
    const codes = ((pmRows ?? []) as ProductMaster[])
      .filter((row) => {
        if (isManagerCatalogWorkspace(catalogWorkspace)) {
          return rowBelongsToManagerDashboard(row, {
            ...scopeCtx,
            marketplace: marketplace as LegacyMarketplace,
          });
        }
        return productMasterBelongsToWorkspace(row, catalogWorkspace);
      })
      .map((row) => row.product_code);
    for (const codeChunk of chunkArray(codes, 150)) {
      if (codeChunk.length === 0) continue;
      const rows = await selectComputedMetricsByCodesAndDate(
        marketplace,
        selloutMeta.snapshotDate,
        codeChunk,
      );
      mergeDashboardMetricsIntoMap(latestByCode, rows, marketplace);
    }
    const missingCodes = codes.filter(
      (code) => !latestByCode.has(normalizeMarketplaceProductCode(marketplace, code)),
    );
    if (missingCodes.length > 0) {
      if (isManagerCatalogWorkspace(catalogWorkspace)) {
        const workspaceUploadIds = [
          ...(selloutMeta.id ? [selloutMeta.id] : []),
          ...(await listWorkspaceSelloutUploadIds(marketplace, catalogWorkspace, 12)).map(
            (u) => u.id,
          ),
        ];
        const uniqueUploadIds = [...new Set(workspaceUploadIds)];
        for (const codeChunk of chunkArray(missingCodes, 150)) {
          if (codeChunk.length === 0) continue;
          const rows = await selectComputedMetricsByCodesAndUploadIds(
            marketplace,
            codeChunk,
            uniqueUploadIds,
          );
          mergeDashboardMetricsIntoMap(latestByCode, rows, marketplace);
        }
      } else {
        const latestRows = await fetchLatestMetricsPerProductCodes(
          marketplace,
          missingCodes,
        );
        mergeDashboardMetricsIntoMap(latestByCode, latestRows, marketplace);
      }
    }
  }

  const needsHydrate =
    latestByCode.size === 0 ||
    ![...latestByCode.values()].some((m) => metricHasKpiData(m));
  if (needsHydrate) {
    await hydrateDashboardMetricsFromDailySales(
      marketplace,
      catalogWorkspace,
      selloutMeta,
      scopeCtx,
      latestByCode,
    );
  }

  return latestByCode;
}

export async function getDashboardRecords(
  marketplace: Marketplace,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
): Promise<DashboardRecord[]> {
  const isDawgScope = getActiveDataScope() === "dawg";
  const scopeCtx = {
    catalogWorkspace,
    dataScope: getActiveDataScope(),
    marketplace: marketplace as LegacyMarketplace,
  };
  const matchesScope = isDawgScope
    ? productMatchesDawgScope
    : isManagerCatalogWorkspace(catalogWorkspace)
      ? (row: {
          category?: string | null;
          sub_category?: string | null;
          product_name?: string | null;
          catalog_workspace?: string | null;
        }) => rowBelongsToManagerDashboard(row, scopeCtx)
      : productMatchesMarketplaceDashboardScope;
  const [flipkartEolModelNames, selloutMeta] = await Promise.all([
    marketplace === "amazon" || marketplace === "flipkart"
      ? getFlipkartEolModelNames()
      : Promise.resolve(new Set<string>()),
    getLatestSelloutUploadMeta(marketplace, catalogWorkspace),
  ]);

  /** No sellout for this channel + workspace — do not show Hari/other uploads or stale metrics. */
  if (!selloutMeta.id) {
    return [];
  }

  const latestByCode = await loadWorkspaceDashboardMetricsMap(
    marketplace,
    catalogWorkspace,
    selloutMeta,
    scopeCtx,
  );

  const metricCodes = [...latestByCode.keys()];
  const productRows: ProductMaster[] = [];
  const isPravinScope = catalogWorkspace === CATALOG_WORKSPACE_PRAVIN;
  const productSelect = isPravinScope
    ? `${DASHBOARD_PRODUCT_COLUMNS}, catalog_workspace`
    : DASHBOARD_PRODUCT_COLUMNS;

  for (const codeChunk of chunkArray(metricCodes, 150)) {
    const { data, error: productError } = await supabase
      .from("product_master")
      .select(productSelect)
      .eq("marketplace", marketplace)
      .in("product_code", codeChunk);
    if (productError) throw new Error(getErrorMessage(productError));
    productRows.push(...((data ?? []) as unknown as ProductMaster[]));
  }

  let scopedExtras: ProductMaster[] = [];
  if (
    !isDawgScope &&
    isManagerCatalogWorkspace(catalogWorkspace) &&
    !isPravinScope
  ) {
    const { data, error: scopedError } = await supabase
      .from("product_master")
      .select(`${DASHBOARD_PRODUCT_COLUMNS}, catalog_workspace`)
      .eq("marketplace", marketplace);
    if (scopedError) throw new Error(getErrorMessage(scopedError));
    scopedExtras = ((data ?? []) as ProductMaster[]).filter(
      (row) =>
        productMasterBelongsToWorkspace(row, catalogWorkspace) &&
        matchesScope(row),
    );
  } else if (!isDawgScope && !isPravinScope) {
    const { data, error: scopedError } = await supabase
      .from("product_master")
      .select(DASHBOARD_PRODUCT_COLUMNS)
      .eq("marketplace", marketplace)
      .or(
        "category.ilike.%cartridge%,category.ilike.%monitor%,category.ilike.%projector%",
      );
    if (scopedError) throw new Error(getErrorMessage(scopedError));
    scopedExtras = (data ?? []) as ProductMaster[];
  }
  for (const row of scopedExtras) {
    if (!matchesScope(row)) continue;
    if (!productRows.some((p) => p.product_code === row.product_code)) {
      productRows.push(row);
    }
  }

  const productMap = new Map(
    (productRows as ProductMaster[]).map((product) => [
      product.product_code,
      product,
    ]),
  );

  const dashboardCodes = new Set<string>(latestByCode.keys());
  if (!isDawgScope && !isPravinScope) {
    for (const product of productRows as ProductMaster[]) {
      if (matchesScope(product)) {
        dashboardCodes.add(product.product_code);
      }
    }
  }

  const emptyMetric = (productCode: string, asOfDate: string): ComputedMetric => ({
    marketplace,
    product_code: productCode,
    as_of_date: asOfDate,
    inventory_units: 0,
    total_so_units: 0,
    may_mtd_units: 0,
    apr_so_units: 0,
    prior_fy_so_units: 0,
    drr_units: 0,
    drr_28d_avg_units: 0,
    doc_days: 0,
    purchase_order_units: 0,
    upload_id: null,
  });

  const fallbackAsOf =
    [...latestByCode.values()][0]?.as_of_date ?? new Date().toISOString().slice(0, 10);

  const hoCtx =
    !isDawgScope &&
    !isQcomMarketplace(marketplace) &&
    usesHoStockNetworkPattern(scopeCtx.dataScope)
      ? await loadHoStockNetworkContext(catalogWorkspace)
      : null;

  return [...dashboardCodes]
    .map((productCode) => {
      const metric = latestByCode.get(productCode) ?? emptyMetric(productCode, fallbackAsOf);
      const product = productMap.get(productCode);
      const computedPo = Number(
        computeRecommendedPoUnits(
          poDrrForProjection(metric),
          metric.inventory_units,
        ).toFixed(2),
      );
      const base = {
        ...metric,
        purchase_order_units: computedPo,
        product_name: product?.product_name ?? "",
        category: product?.category ?? null,
        sub_category: product?.sub_category ?? null,
        brand: product?.brand ?? null,
        image_url: product?.image_url ?? null,
        listing_code: product?.listing_code ?? null,
      };
      const withNetwork = attachHoStockNetworkFields(base, hoCtx, {
        marketplace,
        productCode,
        dataScope: scopeCtx.dataScope,
      });
      return applyHoStockNetworkToMetricRow(withNetwork, {
        hoNetworkActive: hoCtx !== null,
      });
    })
    .filter((row) => {
      if (!isPravinScope) {
        const product = productMap.get(row.product_code) as
          | (ProductMaster & { catalog_workspace?: string | null })
          | undefined;
        if (
          !matchesScope({
            category: row.category ?? product?.category ?? null,
            sub_category: row.sub_category ?? product?.sub_category ?? null,
            product_name: row.product_name ?? product?.product_name ?? null,
            catalog_workspace: product?.catalog_workspace ?? null,
          })
        ) {
          return false;
        }
      }
      return !isExcludedFromActiveDashboard(
        marketplace,
        row.product_code,
        row.product_name,
        flipkartEolModelNames,
      );
    })
    .sort((a, b) => b.purchase_order_units - a.purchase_order_units);
}

export type LatestSheetColumnSelloutSummary = {
  /** ISO date key for the rightmost sheet column (day or month anchor). */
  saleDate: string | null;
  totalUnits: number;
};

type LatestSelloutUploadMeta = {
  id: string | null;
  snapshotDate: string | null;
  latestDayFromNotes: UploadLatestDaySellout | null;
};

async function getLatestSelloutUploadMeta(
  marketplace: Marketplace,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
): Promise<LatestSelloutUploadMeta> {
  if (isQcomSelloutMarketplace(marketplace)) {
    const baseQuery = () =>
      supabase
        .from("uploads")
        .select("id, snapshot_date, upload_kind, notes")
        .eq("marketplace", marketplace)
        .eq("status", "completed")
        .not("snapshot_date", "is", null)
        .order("uploaded_at", { ascending: false })
        .limit(12);

    let rows: Array<{
      id: string;
      snapshot_date: string;
      upload_kind?: string | null;
      notes?: string | null;
    }> = [];

    const withKind = await baseQuery().eq("upload_kind", "sellout");
    if (withKind.error) {
      if (!isMissingUploadKindColumn(withKind.error)) {
        throw new Error(getErrorMessage(withKind.error));
      }
      const fallback = await baseQuery();
      if (fallback.error) throw new Error(getErrorMessage(fallback.error));
      rows = ((fallback.data ?? []) as typeof rows).filter(isSelloutUploadRow);
    } else {
      rows = (withKind.data ?? []) as typeof rows;
    }

    const latest = rows[0];
    return {
      id: latest?.id ?? null,
      snapshotDate: latest?.snapshot_date?.trim() || null,
      latestDayFromNotes: parseLatestDaySelloutFromUploadNotes(latest?.notes),
    };
  }

  const uploadScope: UploadContextScope =
    getActiveDataScope() === "dawg" ? "dawg" : catalogWorkspace;
  const ctx = await getLatestUploadContextByMarketplace(uploadScope);
  let channel =
    marketplace === "amazon" ? ctx.amazon : marketplace === "flipkart" ? ctx.flipkart : null;

  if (isManagerCatalogWorkspace(catalogWorkspace) && channel?.id) {
    let metricCount = await countMetricsForUpload(channel.id);
    if (metricCount === 0) {
      const recent = await listWorkspaceSelloutUploadIds(
        marketplace,
        catalogWorkspace,
        12,
      );
      for (const upload of recent) {
        if (upload.id === channel.id) continue;
        const count = await countMetricsForUpload(upload.id);
        if (count > 0) {
          channel = { id: upload.id, snapshotDate: upload.snapshotDate };
          metricCount = count;
          break;
        }
      }
    }
  }

  return {
    id: channel?.id ?? null,
    snapshotDate: channel?.snapshotDate ?? null,
    latestDayFromNotes: null,
  };
}

/**
 * Rightmost date column from the latest sellout upload — prefers day-level headers
 * (e.g. 18/May) over month totals (Apr-26 → YYYY-MM-01).
 */
async function resolveMostRecentSheetSaleDate(
  marketplace: Marketplace,
  meta: LatestSelloutUploadMeta,
): Promise<string | null> {
  const { id: uploadId, snapshotDate } = meta;

  const base = () => {
    let query = supabase
      .from("daily_sales")
      .select("sale_date")
      .eq("marketplace", marketplace);
    if (uploadId) {
      query = query.eq("upload_id", uploadId);
    }
    return query;
  };

  if (snapshotDate) {
    const { data: snapshotRow, error: snapshotError } = await base()
      .eq("sale_date", snapshotDate)
      .limit(1)
      .maybeSingle();
    if (snapshotError) throw new Error(getErrorMessage(snapshotError));
    if (snapshotRow) return snapshotDate;

    const { data: onOrBeforeSnapshot, error: beforeError } = await base()
      .not("sale_date", "like", "%-01")
      .lte("sale_date", snapshotDate)
      .order("sale_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (beforeError) throw new Error(getErrorMessage(beforeError));
    const capped = (onOrBeforeSnapshot as { sale_date: string } | null)?.sale_date?.trim();
    if (capped) return capped;

    const reportMonthAnchor = `${snapshotDate.slice(0, 7)}-01`;
    const { data: monthAnchorRow, error: monthError } = await base()
      .eq("sale_date", reportMonthAnchor)
      .limit(1)
      .maybeSingle();
    if (monthError) throw new Error(getErrorMessage(monthError));
    if (monthAnchorRow) return reportMonthAnchor;

    return snapshotDate;
  }

  if (uploadId) {
    const { data: uploadRow, error: uploadError } = await supabase
      .from("uploads")
      .select("snapshot_date")
      .eq("id", uploadId)
      .maybeSingle();
    if (uploadError) throw new Error(getErrorMessage(uploadError));
    const fromUpload = String(
      (uploadRow as { snapshot_date?: string } | null)?.snapshot_date ?? "",
    ).trim();
    if (fromUpload) return fromUpload;
  }

  const { data: dayRow, error: dayError } = await base()
    .not("sale_date", "like", "%-01")
    .order("sale_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (dayError) throw new Error(getErrorMessage(dayError));
  const dayDate = (dayRow as { sale_date: string } | null)?.sale_date?.trim();
  if (dayDate) return dayDate;

  const { data: anyRow, error: anyError } = await base()
    .order("sale_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (anyError) throw new Error(getErrorMessage(anyError));
  return (anyRow as { sale_date: string } | null)?.sale_date?.trim() ?? null;
}

export type SelloutLookupRow = Pick<
  DashboardRecord,
  "product_code" | "listing_code" | "as_of_date"
>;

async function enrichLatestSelloutUploadMeta(
  _marketplace: Marketplace,
  meta: LatestSelloutUploadMeta,
  lookupRows: SelloutLookupRow[],
): Promise<LatestSelloutUploadMeta> {
  const snapshotFromRows = lookupRows.reduce<string | null>((max, row) => {
    const d = String(row.as_of_date ?? "").trim();
    if (!d) return max;
    return !max || d > max ? d : max;
  }, null);

  if (meta.id && meta.snapshotDate && meta.latestDayFromNotes) {
    return meta;
  }

  let notesLatestDay = meta.latestDayFromNotes;
  if (meta.id && !notesLatestDay) {
    const { data: uploadRow, error: uploadErr } = await supabase
      .from("uploads")
      .select("notes")
      .eq("id", meta.id)
      .maybeSingle();
    if (uploadErr) throw new Error(getErrorMessage(uploadErr));
    notesLatestDay = parseLatestDaySelloutFromUploadNotes(
      (uploadRow as { notes?: string | null } | null)?.notes,
    );
  }

  if (meta.id && meta.snapshotDate) {
    return { ...meta, latestDayFromNotes: notesLatestDay };
  }

  return {
    id: meta.id,
    snapshotDate: meta.snapshotDate ?? snapshotFromRows,
    latestDayFromNotes: notesLatestDay,
  };
}

/** Sheet coverage date for KPIs — QCom masters use the picker date as the latest day column (e.g. 18/May). */
function resolveKpiSaleDate(
  marketplace: Marketplace,
  meta: LatestSelloutUploadMeta,
  resolvedFromDailySales: string | null,
): string | null {
  if (isQcomMarketplace(marketplace) && meta.snapshotDate) {
    return meta.snapshotDate;
  }
  return resolvedFromDailySales ?? meta.snapshotDate ?? null;
}

async function expandDashboardSelloutLookupCodes(
  marketplace: Marketplace,
  rows: SelloutLookupRow[],
): Promise<string[]> {
  const codes = new Set<string>();
  for (const row of rows) {
    const productCode = row.product_code?.trim();
    const listingCode = row.listing_code?.trim();
    if (productCode) codes.add(productCode);
    if (listingCode) codes.add(listingCode);
  }
  if (!isQcomMarketplace(marketplace) || codes.size === 0) {
    return [...codes];
  }

  const productCodes = [
    ...new Set(rows.map((row) => row.product_code?.trim()).filter(Boolean) as string[]),
  ];
  for (const chunk of chunkArray(productCodes, 80)) {
    const { data: byProduct, error: productErr } = await supabase
      .from("product_master")
      .select("product_code, listing_code")
      .eq("marketplace", marketplace)
      .in("product_code", chunk);
    if (productErr) throw new Error(getErrorMessage(productErr));
    for (const row of byProduct ?? []) {
      const r = row as { product_code: string; listing_code: string | null };
      if (r.product_code?.trim()) codes.add(r.product_code.trim());
      if (r.listing_code?.trim()) codes.add(r.listing_code.trim());
    }

    const { data: byListing, error: listingErr } = await supabase
      .from("product_master")
      .select("product_code, listing_code")
      .eq("marketplace", marketplace)
      .in("listing_code", chunk);
    if (listingErr) throw new Error(getErrorMessage(listingErr));
    for (const row of byListing ?? []) {
      const r = row as { product_code: string; listing_code: string | null };
      if (r.product_code?.trim()) codes.add(r.product_code.trim());
      if (r.listing_code?.trim()) codes.add(r.listing_code.trim());
    }
  }

  return [...codes];
}

async function sumDailySelloutForDate(
  marketplace: Marketplace,
  saleDate: string,
  lookupCodes: string[],
  uploadId: string | null,
): Promise<number> {
  let totalUnits = 0;

  const queryForChunk = (chunk: string[], scopedUploadId: string | null) => {
    let query = supabase
      .from("daily_sales")
      .select("units_sold")
      .eq("marketplace", marketplace)
      .eq("sale_date", saleDate)
      .in("product_code", chunk);
    if (scopedUploadId) {
      query = query.eq("upload_id", scopedUploadId);
    }
    return query;
  };

  for (const chunk of chunkArray(lookupCodes, 150)) {
    const { data, error } = await queryForChunk(chunk, uploadId);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of data ?? []) {
      totalUnits += Math.max(0, Number((row as { units_sold: unknown }).units_sold ?? 0));
    }
  }

  if (totalUnits === 0 && uploadId) {
    for (const chunk of chunkArray(lookupCodes, 150)) {
      const { data, error } = await queryForChunk(chunk, null);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of data ?? []) {
        totalUnits += Math.max(0, Number((row as { units_sold: unknown }).units_sold ?? 0));
      }
    }
  }

  return totalUnits;
}

/** Sum every SKU row for one channel + date (matches Excel total row for that day column). */
async function sumAllChannelDailySelloutForDate(
  marketplace: Marketplace,
  saleDate: string,
  uploadId: string | null,
): Promise<number> {
  let totalUnits = 0;
  const pageSize = 1000;
  let from = 0;

  while (true) {
    let query = supabase
      .from("daily_sales")
      .select("units_sold")
      .eq("marketplace", marketplace)
      .eq("sale_date", saleDate)
      .range(from, from + pageSize - 1);
    if (uploadId) {
      query = query.eq("upload_id", uploadId);
    }
    const { data, error } = await query;
    if (error) throw new Error(getErrorMessage(error));
    const batch = data ?? [];
    for (const row of batch) {
      totalUnits += Math.max(0, Number((row as { units_sold: unknown }).units_sold ?? 0));
    }
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return totalUnits;
}

async function maxDailySaleDateForUpload(
  marketplace: Marketplace,
  uploadId: string | null,
  onOrBefore?: string,
): Promise<string | null> {
  let query = supabase
    .from("daily_sales")
    .select("sale_date")
    .eq("marketplace", marketplace)
    .not("sale_date", "like", "%-01");
  if (uploadId) {
    query = query.eq("upload_id", uploadId);
  }
  if (onOrBefore) {
    query = query.lte("sale_date", onOrBefore);
  }
  const { data, error } = await query
    .order("sale_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(getErrorMessage(error));
  return (data as { sale_date: string } | null)?.sale_date?.trim() ?? null;
}

function isMissingLatestDaySoColumn(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes("latest_day_so_units") && msg.includes("does not exist");
}

/** Sum per-SKU latest day column stored on computed_metrics (4614 on Zepto tab). */
async function sumLatestDaySoFromUploadMetrics(
  marketplace: Marketplace,
  meta: LatestSelloutUploadMeta,
): Promise<number> {
  const { id: uploadId, snapshotDate } = meta;
  if (!uploadId || !snapshotDate) return 0;

  let total = 0;
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("computed_metrics")
      .select("latest_day_so_units")
      .eq("marketplace", marketplace)
      .eq("as_of_date", snapshotDate)
      .eq("upload_id", uploadId)
      .range(from, from + pageSize - 1);
    if (error) {
      if (isMissingLatestDaySoColumn(error)) return 0;
      throw new Error(getErrorMessage(error));
    }
    const batch = data ?? [];
    for (const row of batch) {
      total += Math.max(
        0,
        Number((row as { latest_day_so_units: unknown }).latest_day_so_units ?? 0),
      );
    }
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return total;
}

async function sumMayMtdFromLatestUploadMetrics(
  marketplace: Marketplace,
  meta: LatestSelloutUploadMeta,
  metricProductCodes: string[],
): Promise<number> {
  const { id: uploadId, snapshotDate } = meta;
  if (!uploadId || !snapshotDate || metricProductCodes.length === 0) return 0;

  let total = 0;
  for (const chunk of chunkArray(metricProductCodes, 150)) {
    const { data, error } = await supabase
      .from("computed_metrics")
      .select("may_mtd_units")
      .eq("marketplace", marketplace)
      .eq("as_of_date", snapshotDate)
      .eq("upload_id", uploadId)
      .in("product_code", chunk);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of data ?? []) {
      total += Math.max(0, Number((row as { may_mtd_units: unknown }).may_mtd_units ?? 0));
    }
  }
  return total;
}

export type SumLatestColumnSelloutOptions = {
  /** QCom: sum every SKU on the channel tab for that date (Excel total row), not only rows in view. */
  qcomChannelTotal?: boolean;
};

/** Sum units in the latest sheet date column across the given SKUs (dashboard KPI). */
export async function sumSelloutOnMostRecentSheetDate(
  marketplace: Marketplace,
  lookupRows: SelloutLookupRow[],
  options?: SumLatestColumnSelloutOptions,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<LatestSheetColumnSelloutSummary> {
  if (lookupRows.length === 0) {
    return { saleDate: null, totalUnits: 0 };
  }

  const meta = await enrichLatestSelloutUploadMeta(
    marketplace,
    await getLatestSelloutUploadMeta(marketplace, catalogWorkspace),
    lookupRows,
  );
  if (!meta.id) {
    return { saleDate: null, totalUnits: 0 };
  }
  const saleDate = resolveKpiSaleDate(
    marketplace,
    meta,
    await resolveMostRecentSheetSaleDate(marketplace, meta),
  );
  if (!saleDate) {
    return { saleDate: null, totalUnits: 0 };
  }

  const lookupCodes = await expandDashboardSelloutLookupCodes(marketplace, lookupRows);
  const metricProductCodes = [
    ...new Set(
      lookupRows
        .map((row) => row.product_code?.trim())
        .filter((code): code is string => Boolean(code)),
    ),
  ];

  let totalUnits = 0;

  if (isQcomSelloutMarketplace(marketplace) && options?.qcomChannelTotal !== false) {
    totalUnits = await sumLatestDaySoFromUploadMetrics(marketplace, meta);
    if (totalUnits === 0) {
      totalUnits = await sumAllChannelDailySelloutForDate(marketplace, saleDate, meta.id);
    }
    if (totalUnits === 0 && meta.id) {
      totalUnits = await sumAllChannelDailySelloutForDate(marketplace, saleDate, null);
    }
    if (totalUnits === 0 && meta.id) {
      const maxDate = await maxDailySaleDateForUpload(
        marketplace,
        meta.id,
        meta.snapshotDate ?? saleDate,
      );
      if (maxDate && maxDate !== saleDate) {
        totalUnits = await sumAllChannelDailySelloutForDate(marketplace, maxDate, meta.id);
        if (totalUnits > 0) {
          return { saleDate: maxDate, totalUnits };
        }
      }
    }
    if (totalUnits === 0 && meta.latestDayFromNotes) {
      return {
        saleDate: meta.latestDayFromNotes.saleDate,
        totalUnits: meta.latestDayFromNotes.totalUnits,
      };
    }
  }

  if (totalUnits === 0 && lookupCodes.length > 0) {
    totalUnits = await sumDailySelloutForDate(
      marketplace,
      saleDate,
      lookupCodes,
      meta.id,
    );
  }

  if (totalUnits === 0 && meta.snapshotDate) {
    const reportMonthAnchor = `${meta.snapshotDate.slice(0, 7)}-01`;
    if (reportMonthAnchor !== saleDate && lookupCodes.length > 0) {
      totalUnits = await sumDailySelloutForDate(
        marketplace,
        reportMonthAnchor,
        lookupCodes,
        meta.id,
      );
    }
    if (totalUnits === 0 && isQcomMarketplace(marketplace)) {
      totalUnits = await sumAllChannelDailySelloutForDate(
        marketplace,
        reportMonthAnchor,
        meta.id,
      );
    }
  }

  if (totalUnits === 0 && !isQcomMarketplace(marketplace)) {
    totalUnits = await sumMayMtdFromLatestUploadMetrics(
      marketplace,
      meta,
      metricProductCodes,
    );
  }

  return { saleDate, totalUnits };
}

type UploadRowForBucket = {
  id: string;
  marketplace: Marketplace;
  upload_kind?: string | null;
  notes?: string | null;
  uploaded_at?: string;
};

export function resolveUploadKind(row: {
  upload_kind?: string | null;
  notes?: string | null;
}): UploadKind {
  const kind = row.upload_kind;
  if (
    kind === "sellout" ||
    kind === "bau" ||
    kind === "gms_plan" ||
    kind === "ho_stock" ||
    kind === "ratings_ranking"
  ) {
    return kind;
  }
  const notes = String(row.notes ?? "").toLowerCase();
  if (notes.includes("ho stock")) return "ho_stock";
  if (notes.includes("ratings")) return "ratings_ranking";
  if (notes.includes("gms plan")) return "gms_plan";
  if (notes.includes("bau")) return "bau";
  return "sellout";
}

export function uploadHistoryBucketKey(row: UploadRowForBucket): string {
  const kind = resolveUploadKind(row);
  if (kind === "sellout") {
    const ws = parseCatalogWorkspaceFromUploadRow(row);
    if (ws !== CATALOG_WORKSPACE_MONITOR) {
      return `sellout:${row.marketplace}:${ws}`;
    }
    return `sellout:${row.marketplace}`;
  }
  return kind;
}

async function fetchUploadRowsForBucket(
  bucket: { kind: UploadKind; marketplace?: Marketplace; bucketKey?: string },
): Promise<UploadRowForBucket[]> {
  const select = "id, marketplace, upload_kind, notes, uploaded_at";

  if (bucket.kind === "sellout" && bucket.marketplace) {
    const withKind = await supabase
      .from("uploads")
      .select(select)
      .eq("marketplace", bucket.marketplace)
      .eq("upload_kind", "sellout")
      .order("uploaded_at", { ascending: false })
      .limit(80);

    if (!withKind.error) {
      const rows = (withKind.data ?? []) as UploadRowForBucket[];
      if (bucket.bucketKey) {
        return rows.filter((row) => uploadHistoryBucketKey(row) === bucket.bucketKey);
      }
      return rows;
    }

    if (!isMissingUploadKindColumn(withKind.error)) {
      throw new Error(getErrorMessage(withKind.error));
    }

    const fallback = await supabase
      .from("uploads")
      .select(select)
      .eq("marketplace", bucket.marketplace)
      .order("uploaded_at", { ascending: false })
      .limit(80);
    if (fallback.error) throw new Error(getErrorMessage(fallback.error));
    const selloutRows = ((fallback.data ?? []) as UploadRowForBucket[]).filter(
      isSelloutUploadRow,
    );
    if (bucket.bucketKey) {
      return selloutRows.filter((row) => uploadHistoryBucketKey(row) === bucket.bucketKey);
    }
    return selloutRows;
  }

  const withKind = await supabase
    .from("uploads")
    .select(select)
    .eq("upload_kind", bucket.kind)
    .order("uploaded_at", { ascending: false })
    .limit(80);

  if (!withKind.error) return (withKind.data ?? []) as UploadRowForBucket[];

  if (!isMissingUploadKindColumn(withKind.error)) {
    throw new Error(getErrorMessage(withKind.error));
  }

  const fallback = await supabase
    .from("uploads")
    .select(select)
    .order("uploaded_at", { ascending: false })
    .limit(120);
  if (fallback.error) throw new Error(getErrorMessage(fallback.error));
  const key =
    bucket.kind === "sellout" && bucket.marketplace
      ? `sellout:${bucket.marketplace}`
      : bucket.kind;
  return ((fallback.data ?? []) as UploadRowForBucket[]).filter(
    (row) => uploadHistoryBucketKey(row) === key,
  );
}

/**
 * After a successful upload, delete older runs of the same type (e.g. prior Amazon sellout files).
 * Keeps only the upload identified by `keepUploadId`.
 */
export async function pruneOlderUploads(keepUploadId: string): Promise<number> {
  const { data: keep, error: keepErr } = await supabase
    .from("uploads")
    .select("id, marketplace, upload_kind, notes")
    .eq("id", keepUploadId)
    .maybeSingle();
  if (keepErr) throw new Error(getErrorMessage(keepErr));
  if (!keep) return 0;

  const bucketKey = uploadHistoryBucketKey(keep as UploadRowForBucket);
  const kind = resolveUploadKind(keep);
  const marketplace =
    kind === "sellout" ? (keep.marketplace as Marketplace) : undefined;

  const rows = await fetchUploadRowsForBucket({ kind, marketplace, bucketKey });
  const staleIds = rows
    .map((row) => row.id)
    .filter((id) => id !== keepUploadId);

  let removed = 0;
  for (const id of staleIds) {
    await deleteUploadRecord(id);
    removed += 1;
  }
  if (removed > 0) {
    console.log(`[upload] pruned ${removed} stale upload(s) for bucket ${bucketKey}`);
  }
  return removed;
}

/** One-time trim: keep only the newest file per channel / sheet type. */
export async function retainLatestUploadsOnly(): Promise<number> {
  const buckets: Array<{ kind: UploadKind; marketplace?: Marketplace }> = [
    { kind: "sellout", marketplace: "amazon" },
    { kind: "sellout", marketplace: "flipkart" },
    { kind: "bau" },
    { kind: "gms_plan" },
    { kind: "ho_stock" },
    { kind: "ratings_ranking" },
  ];

  let removed = 0;
  for (const bucket of buckets) {
    const rows = await fetchUploadRowsForBucket(bucket);
    const latest = rows[0];
    if (!latest?.id) continue;
    removed += await pruneOlderUploads(latest.id);
  }
  return removed;
}

export async function getUploadHistory(scope?: UploadHistoryScope) {
  const { data, error } = await supabase
    .from("uploads")
    .select("*")
    .order("uploaded_at", { ascending: false })
    .limit(scope ? 120 : 80);
  if (error) throw new Error(getErrorMessage(error));

  const seen = new Set<string>();
  return (data ?? []).filter((row) => {
    const bucketRow = row as UploadRowForBucket;
    if (scope && !uploadRowMatchesHistoryScope(bucketRow, scope)) {
      return false;
    }
    const key = uploadHistoryBucketKey(bucketRow);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type LatestUploadContext = {
  id: string;
  snapshotDate: string;
};

function isMissingUploadKindColumn(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes("upload_kind") && msg.includes("does not exist");
}

function isSelloutUploadRow(row: {
  upload_kind?: string | null;
  notes?: string | null;
}): boolean {
  const kind = row.upload_kind;
  if (
    kind === "bau" ||
    kind === "gms_plan" ||
    kind === "ho_stock" ||
    kind === "ratings_ranking"
  ) {
    return false;
  }
  if (kind === "sellout") return true;
  const notes = String(row.notes ?? "").toLowerCase();
  if (notes.includes("ratings")) return false;
  if (notes.includes("ho stock")) return false;
  return !notes.includes("bau") && !notes.includes("gms plan");
}

/** Latest completed sellout upload per marketplace (id + sheet as-on date). */
export async function getLatestUploadContextByMarketplace(
  scope: UploadContextScope = CATALOG_WORKSPACE_MONITOR,
): Promise<{
  amazon: LatestUploadContext | null;
  flipkart: LatestUploadContext | null;
}> {
  const dawgScope = isDawgUploadContextScope(scope);

  async function fetchOne(marketplace: Marketplace): Promise<LatestUploadContext | null> {
    const baseQuery = () => {
      let q = supabase
        .from("uploads")
        .select("id, snapshot_date, upload_kind, notes, data_scope, catalog_workspace")
        .eq("marketplace", marketplace)
        .eq("status", "completed")
        .not("snapshot_date", "is", null)
        .order("uploaded_at", { ascending: false })
        .limit(24);
      if (dawgScope) {
        q = q.eq("data_scope", "dawg");
      }
      return q;
    };

    let rows: Array<{
      id: string;
      snapshot_date: string;
      upload_kind?: string | null;
      notes?: string | null;
      data_scope?: string | null;
      catalog_workspace?: string | null;
    }> = [];

    const withKind = await baseQuery().eq("upload_kind", "sellout");
    if (withKind.error) {
      if (!isMissingUploadKindColumn(withKind.error)) {
        throw new Error(getErrorMessage(withKind.error));
      }
      let fallback = supabase
        .from("uploads")
        .select("id, snapshot_date, notes, data_scope, catalog_workspace")
        .eq("marketplace", marketplace)
        .eq("status", "completed")
        .not("snapshot_date", "is", null)
        .order("uploaded_at", { ascending: false })
        .limit(24);
      if (dawgScope) {
        fallback = fallback.eq("data_scope", "dawg");
      }
      const fallbackRes = await fallback;
      if (fallbackRes.error) throw new Error(getErrorMessage(fallbackRes.error));
      rows = (fallbackRes.data ?? []) as typeof rows;
    } else {
      rows = (withKind.data ?? []) as typeof rows;
    }

    const selloutRows = rows.filter(isSelloutUploadRow);
    const scoped = dawgScope
      ? selloutRows
      : selloutRows.filter((row) =>
          uploadRowBelongsToCatalogWorkspace(row, scope as CatalogWorkspace),
        );
    const pick = scoped[0];
    if (!pick?.id || !pick.snapshot_date) return null;
    return {
      id: String(pick.id),
      snapshotDate: String(pick.snapshot_date),
    };
  }

  const [amazon, flipkart] = await Promise.all([
    fetchOne("amazon"),
    fetchOne("flipkart"),
  ]);
  return { amazon, flipkart };
}

/** Recent completed sellout uploads for one channel + workspace (newest first). */
export async function listWorkspaceSelloutUploadIds(
  marketplace: Marketplace,
  catalogWorkspace: CatalogWorkspace,
  limit = 12,
): Promise<Array<{ id: string; snapshotDate: string }>> {
  const dawgScope = getActiveDataScope() === "dawg";
  let query = supabase
    .from("uploads")
    .select("id, snapshot_date, upload_kind, notes, data_scope, catalog_workspace")
    .eq("marketplace", marketplace)
    .eq("status", "completed")
    .not("snapshot_date", "is", null)
    .order("uploaded_at", { ascending: false })
    .limit(Math.max(limit, 1) * 3);
  if (dawgScope) {
    query = query.eq("data_scope", "dawg");
  }
  const { data, error } = await query;
  if (error) throw new Error(getErrorMessage(error));

  const out: Array<{ id: string; snapshotDate: string }> = [];
  for (const row of (data ?? []) as Array<{
    id: string;
    snapshot_date: string;
    upload_kind?: string | null;
    notes?: string | null;
    catalog_workspace?: string | null;
  }>) {
    if (!isSelloutUploadRow(row)) continue;
    if (
      !dawgScope &&
      !uploadRowBelongsToCatalogWorkspace(row, catalogWorkspace)
    ) {
      continue;
    }
    out.push({ id: String(row.id), snapshotDate: String(row.snapshot_date) });
    if (out.length >= limit) break;
  }
  return out;
}

/** Latest sheet coverage date per channel from the most recent upload that stored `snapshot_date`. */
export async function getLatestUploadSheetCoverageByMarketplace(
  scope: UploadContextScope = CATALOG_WORKSPACE_MONITOR,
): Promise<{
  amazon: string | null;
  flipkart: string | null;
}> {
  const ctx = await getLatestUploadContextByMarketplace(scope);
  return {
    amazon: ctx.amazon?.snapshotDate ?? null,
    flipkart: ctx.flipkart?.snapshotDate ?? null,
  };
}

/**
 * Removes an upload and the data that was saved with it:
 * - `computed_metrics` rows with `upload_id` = this upload (precise)
 * - legacy `computed_metrics` with null `upload_id` for same marketplace + snapshot date
 * - `daily_sales` and `inventory_snapshots` rows linked to this upload
 * - the upload row (and cascaded `ingestion_errors`)
 *
 * `product_master` rows are kept so images and names are not lost.
 */
function isMissingAuxTableError(error: unknown, table: string): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes(table.toLowerCase()) && msg.includes("does not exist");
}

export async function deleteUploadRecord(uploadId: string) {
  const { data: row, error: fetchError } = await supabase
    .from("uploads")
    .select("id, marketplace, snapshot_date, upload_kind, notes")
    .eq("id", uploadId)
    .maybeSingle();
  if (fetchError) throw new Error(getErrorMessage(fetchError));
  if (!row) throw new Error("Upload not found.");

  const marketplace = row.marketplace as Marketplace;
  const snapshotDate = row.snapshot_date as string | null;
  const kind = resolveUploadKind(row);

  if (kind === "bau") {
    const { error: bauErr } = await supabase
      .from("product_bau_benchmark")
      .delete()
      .eq("upload_id", uploadId);
    if (bauErr && !isMissingAuxTableError(bauErr, "product_bau_benchmark")) {
      throw new Error(getErrorMessage(bauErr));
    }
  }

  if (kind === "gms_plan") {
    const { error: planErr } = await supabase
      .from("gms_plan_monthly")
      .delete()
      .eq("upload_id", uploadId);
    if (planErr && !isMissingAuxTableError(planErr, "gms_plan_monthly")) {
      throw new Error(getErrorMessage(planErr));
    }
  }

  if (kind === "ratings_ranking") {
    const { error: ratingsErr } = await supabase
      .from("product_ratings_snapshot")
      .delete()
      .eq("upload_id", uploadId);
    if (ratingsErr && !isMissingAuxTableError(ratingsErr, "product_ratings_snapshot")) {
      throw new Error(getErrorMessage(ratingsErr));
    }
  }

  if (kind === "sellout") {
    const { error: byUploadError } = await supabase
      .from("computed_metrics")
      .delete()
      .eq("upload_id", uploadId);
    if (byUploadError) throw new Error(getErrorMessage(byUploadError));

    if (snapshotDate) {
      const { error: legacyError } = await supabase
        .from("computed_metrics")
        .delete()
        .eq("marketplace", marketplace)
        .eq("as_of_date", snapshotDate)
        .is("upload_id", null);
      if (legacyError) throw new Error(getErrorMessage(legacyError));
    }

    const { error: dailyError } = await supabase
      .from("daily_sales")
      .delete()
      .eq("upload_id", uploadId);
    if (dailyError) throw new Error(getErrorMessage(dailyError));

    const { error: invError } = await supabase
      .from("inventory_snapshots")
      .delete()
      .eq("upload_id", uploadId);
    if (invError) throw new Error(getErrorMessage(invError));

    const { error: catErr } = await supabase
      .from("category_monthly_sellout")
      .delete()
      .eq("upload_id", uploadId);
    if (catErr && !isMissingCategoryMonthlyTableError(catErr)) {
      throw new Error(getErrorMessage(catErr));
    }
  }

  const { error } = await supabase.from("uploads").delete().eq("id", uploadId);
  if (error) throw new Error(getErrorMessage(error));
}

export async function getProductMaster(
  marketplace: Marketplace,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
) {
  const { data, error } = await supabase
    .from("product_master")
    .select("*")
    .eq("marketplace", marketplace)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(getErrorMessage(error));
  return (data as ProductMaster[]).filter((row) =>
    productMasterBelongsToWorkspace(row, catalogWorkspace),
  );
}

export async function updateProductImage(
  marketplace: Marketplace,
  productCode: string,
  imageUrl: string,
) {
  const { error } = await supabase
    .from("product_master")
    .update({ image_url: imageUrl || null })
    .eq("marketplace", marketplace)
    .eq("product_code", productCode);
  if (error) throw new Error(getErrorMessage(error));
}

const PRODUCT_IMAGE_BUCKET = "product-images";

export async function uploadProductImageFile(
  marketplace: Marketplace,
  productCode: string,
  file: File,
): Promise<string> {
  const fallbackExt = file.type.split("/").pop() || "jpg";
  const ext = (file.name.split(".").pop() || fallbackExt).toLowerCase();
  const safeCode = productCode.replace(/[^A-Za-z0-9_-]/g, "_");
  const path = `${marketplace}/${safeCode}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, file, {
      upsert: true,
      cacheControl: "3600",
      contentType: file.type || `image/${ext}`,
    });
  if (uploadError) throw new Error(getErrorMessage(uploadError));

  const {
    data: { publicUrl },
  } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);

  return publicUrl;
}

function withFlipkartDisplayName(product: ProductMaster): ProductMaster {
  if (product.marketplace !== "flipkart") return product;
  const enriched = enrichFlipkartProductName(product.product_code, product.product_name);
  if (enriched === product.product_name) return product;
  return { ...product, product_name: enriched };
}

/** After Flipkart upload, align DB model names with Madel Name / catalog (fixes lookup search). */
export async function backfillFlipkartProductNamesFromCatalog(): Promise<void> {
  const entries = Object.entries(FLIPKART_FSN_MODEL_NAMES);
  for (const chunk of chunkArray(entries, 80)) {
    await Promise.all(
      chunk.map(async ([fsn, modelName]) => {
        const { error } = await supabase
          .from("product_master")
          .update({ product_name: modelName })
          .eq("marketplace", "flipkart")
          .eq("product_code", fsn);
        if (error) throw new Error(getErrorMessage(error));
      }),
    );
  }
}

export async function findProductWithMetrics(
  marketplace: Marketplace,
  lookupText: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
) {
  const normalized = lookupText.trim();
  if (!normalized) return null;

  const codeLookup =
    marketplace === "flipkart" ? normalized.toUpperCase() : normalized;

  const { data: exactCodeRows, error: exactCodeError } = await supabase
    .from("product_master")
    .select("*")
    .eq("marketplace", marketplace)
    .eq("product_code", codeLookup)
    .limit(1);
  if (exactCodeError) throw new Error(getErrorMessage(exactCodeError));
  const exactCodeProduct = (exactCodeRows?.[0] ?? null) as ProductMaster | null;

  let product = exactCodeProduct;
  if (!product) {
    const { data: exactModelRows, error: exactModelError } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", marketplace)
      .ilike("product_name", normalized)
      .limit(1);
    if (exactModelError) throw new Error(getErrorMessage(exactModelError));
    product = (exactModelRows?.[0] ?? null) as ProductMaster | null;
  }

  if (!product) {
    const { data: partialRows, error: partialError } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", marketplace)
      .or(`product_code.ilike.%${normalized}%,product_name.ilike.%${normalized}%`)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (partialError) throw new Error(getErrorMessage(partialError));
    product = (partialRows?.[0] ?? null) as ProductMaster | null;
  }

  if (!product && marketplace === "flipkart") {
    const catalogHits = findFlipkartFsnsByModelQuery(normalized, 8);
    for (const hit of catalogHits) {
      const { data: row, error: catErr } = await supabase
        .from("product_master")
        .select("*")
        .eq("marketplace", "flipkart")
        .eq("product_code", hit.fsn)
        .maybeSingle();
      if (catErr) throw new Error(getErrorMessage(catErr));
      if (row) {
        product = row as ProductMaster;
        break;
      }
    }
  }

  if (!product) return null;
  if (!productMasterBelongsToWorkspace(product, catalogWorkspace)) {
    return null;
  }

  product = withFlipkartDisplayName(product);

  const selloutMeta = await getLatestSelloutUploadMeta(marketplace, catalogWorkspace);
  if (!selloutMeta.id) {
    return { product, metric: null };
  }

  const { data: metricsRows, error: metricsError } = await supabase
    .from("computed_metrics")
    .select("*")
    .eq("marketplace", marketplace)
    .eq("product_code", product.product_code)
    .eq("upload_id", selloutMeta.id)
    .limit(1);
  if (metricsError) throw new Error(getErrorMessage(metricsError));

  const metric = (metricsRows?.[0] ?? null) as ComputedMetric | null;
  return { product, metric };
}

export type GlobalProductLookupMatch = {
  marketplace: Marketplace;
  product: ProductMaster;
  metric: ComputedMetric | null;
};

/** Resolve ASIN, FSN, or model name without picking a marketplace first. */
export async function findProductGlobally(
  lookupText: string,
): Promise<GlobalProductLookupMatch | null> {
  const trimmed = lookupText.trim();
  if (!trimmed) return null;

  if (/^B0[A-Z0-9]{8}$/i.test(trimmed)) {
    const amazonOnly = await findProductWithMetrics("amazon", trimmed);
    if (amazonOnly) {
      return {
        marketplace: "amazon",
        product: amazonOnly.product,
        metric: amazonOnly.metric,
      };
    }
  }

  if (looksLikeProductSku(trimmed) && !/^B0/i.test(trimmed)) {
    const flipkartOnly = await findProductWithMetrics("flipkart", trimmed);
    if (flipkartOnly) {
      return {
        marketplace: "flipkart",
        product: flipkartOnly.product,
        metric: flipkartOnly.metric,
      };
    }
  }

  if (/^\d+$/.test(trimmed)) {
    const idMap = await loadProductIdMap();
    const entry = idMap ? lookupCodesByErpProductId(idMap, trimmed) : null;
    if (entry) {
      if (entry.asin) {
        const amazonHit = await findProductWithMetrics("amazon", entry.asin);
        if (amazonHit) {
          return {
            marketplace: "amazon",
            product: amazonHit.product,
            metric: amazonHit.metric,
          };
        }
      }
      const fsn = pickFlipkartFsn(entry.fsns);
      if (fsn) {
        const flipkartHit = await findProductWithMetrics("flipkart", fsn);
        if (flipkartHit) {
          return {
            marketplace: "flipkart",
            product: flipkartHit.product,
            metric: flipkartHit.metric,
          };
        }
      }
    }
  }

  const [amazonResult, flipkartResult] = await Promise.all([
    findProductWithMetrics("amazon", trimmed),
    findProductWithMetrics("flipkart", trimmed),
  ]);

  if (amazonResult && flipkartResult) {
    const norm = trimmed.toLowerCase();
    const amazonName = amazonResult.product.product_name.trim().toLowerCase();
    const flipkartName = flipkartResult.product.product_name.trim().toLowerCase();
    const pick =
      amazonName === norm && flipkartName !== norm
        ? "amazon"
        : flipkartName === norm && amazonName !== norm
          ? "flipkart"
          : "amazon";
    const chosen = pick === "amazon" ? amazonResult : flipkartResult;
    return {
      marketplace: pick,
      product: chosen.product,
      metric: chosen.metric,
    };
  }

  if (amazonResult) {
    return {
      marketplace: "amazon",
      product: amazonResult.product,
      metric: amazonResult.metric,
    };
  }
  if (flipkartResult) {
    return {
      marketplace: "flipkart",
      product: flipkartResult.product,
      metric: flipkartResult.metric,
    };
  }
  return null;
}

export type GlobalProductSuggestion = {
  marketplace: Marketplace;
  productCode: string;
  productName: string;
};

export type UnifiedProductSuggestion = {
  key: string;
  erpProductId: string | null;
  modelName: string;
  asin: string | null;
  fsn: string | null;
  subtitle: string;
};

export type ProductScopeRow = {
  category?: string | null;
  sub_category?: string | null;
};

export type ProductScopeFilter = (row: ProductScopeRow) => boolean;

export type ProductContext = {
  erpProductId: string;
  modelName: string;
  amazon: ProductMaster | null;
  flipkart: ProductMaster | null;
  defaultMarketplace: Marketplace;
};

function channelListingLabel(asin: string | null, fsn: string | null): string {
  const parts: string[] = [];
  if (asin) parts.push(`ASIN ${asin}`);
  if (fsn) parts.push(`FSN ${fsn}`);
  return parts.join(" · ");
}

/** Workspace product_master rows by model fragment (not limited to latest-upload metric codes). */
async function searchWorkspaceCatalogForLookup(
  lookupText: string,
  catalogWorkspace: CatalogWorkspace,
): Promise<Array<{ marketplace: Marketplace; productCode: string; productName: string }>> {
  const normalized = lookupText.trim();
  if (normalized.length < 2) return [];

  const out: Array<{ marketplace: Marketplace; productCode: string; productName: string }> =
    [];
  const seen = new Set<string>();

  for (const marketplace of ["amazon", "flipkart"] as const) {
    const scopeCtx = resolveManagerDashboardScopeContext({
      catalogWorkspace,
      marketplace,
    });
    const codeFilter =
      marketplace === "flipkart" ? normalized.toUpperCase() : normalized;

    const { data, error } = await supabase
      .from("product_master")
      .select("product_code, product_name, category, sub_category, catalog_workspace")
      .eq("marketplace", marketplace)
      .or(`product_name.ilike.%${normalized}%,product_code.ilike.%${codeFilter}%`)
      .order("updated_at", { ascending: false })
      .limit(40);
    if (error) throw new Error(getErrorMessage(error));

    for (const row of (data ?? []) as Array<{
      product_code: string;
      product_name: string;
      category?: string | null;
      sub_category?: string | null;
      catalog_workspace?: string | null;
    }>) {
      if (!rowBelongsToManagerDashboard(row, scopeCtx)) continue;

      const productCode = row.product_code.trim();
      const key = `${marketplace}:${productCode.toUpperCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const productName =
        marketplace === "flipkart"
          ? enrichFlipkartProductName(productCode, row.product_name)
          : row.product_name;
      out.push({ marketplace, productCode, productName });
    }
  }

  return out;
}

/** One row per ERP product ID (Amazon + Flipkart merged). */
export async function lookupProductMasterByCode(
  marketplace: Marketplace,
  productCode: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<ProductMaster | null> {
  const trimmed = productCode.trim();
  if (!trimmed) return null;
  const direct = await getProductByCode(marketplace, trimmed, catalogWorkspace);
  if (direct) return direct;
  const folded = marketplace === "flipkart" ? trimmed.toUpperCase() : trimmed;
  if (folded !== trimmed) {
    const alt = await getProductByCode(marketplace, folded, catalogWorkspace);
    if (alt) return alt;
  }
  const { data, error } = await supabase
    .from("product_master")
    .select("*")
    .eq("marketplace", marketplace)
    .ilike("product_code", trimmed)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(getErrorMessage(error));
  const row = (data ?? null) as ProductMaster | null;
  if (
    row &&
    !productRowVisibleInCatalogWorkspace(row, marketplace, catalogWorkspace)
  ) {
    return null;
  }
  return row;
}

async function unifiedSuggestionMatchesScope(
  row: UnifiedProductSuggestion,
  scopeFilter: ProductScopeFilter,
): Promise<boolean> {
  const uploadScope = resolveSelloutUploadScope();
  const channels: Array<{ marketplace: Marketplace; code: string | null }> = [
    { marketplace: "amazon", code: row.asin },
    { marketplace: "flipkart", code: row.fsn },
  ];
  for (const { marketplace, code } of channels) {
    if (!code) continue;
    const product = await lookupProductMasterByCode(marketplace, code);
    if (!product || !scopeFilter(product)) continue;
    const allowed = await getLatestSelloutProductCodeSet(marketplace, uploadScope);
    if (allowed.has(code.trim().toUpperCase())) return true;
  }
  return false;
}

async function unifiedSuggestionFromSelloutCode(
  marketplace: Marketplace,
  productCode: string,
  scopeFilter?: ProductScopeFilter,
): Promise<UnifiedProductSuggestion | null> {
  const trimmed = productCode.trim();
  if (!trimmed) return null;
  const catalogWorkspace = getActiveCatalogWorkspace();
  const uploadScope = resolveSelloutUploadScope(catalogWorkspace);
  const allowed = await getLatestSelloutProductCodeSet(marketplace, uploadScope);
  const codeKey = trimmed.toUpperCase();
  if (!allowed.has(codeKey) && !isManagerCatalogWorkspace(catalogWorkspace)) {
    return null;
  }

  const product = await lookupProductMasterByCode(marketplace, trimmed, catalogWorkspace);
  if (!product) return null;
  if (scopeFilter && !scopeFilter(product)) return null;

  const idMap = await loadProductIdMap();
  const pid = idMap
    ? lookupErpProductId(idMap, marketplace, product.product_code)
    : null;
  const catalog =
    catalogProductName(product.product_name, product.product_code) || product.product_name;
  return {
    key: pid ? `pid:${pid}` : `name:${normalizeKey(catalog)}`,
    erpProductId: pid,
    modelName: catalog,
    asin: marketplace === "amazon" ? product.product_code : null,
    fsn: marketplace === "flipkart" ? product.product_code : null,
    subtitle: "",
  };
}

export async function searchUnifiedProducts(
  lookupText: string,
  options?: { scopeFilter?: ProductScopeFilter },
): Promise<UnifiedProductSuggestion[]> {
  const trimmed = lookupText.trim();
  if (trimmed.length < 2) return [];

  const idMap = await loadProductIdMap();
  const byKey = new Map<string, UnifiedProductSuggestion>();
  const scopeFilter = options?.scopeFilter;
  const catalogWorkspace = getActiveCatalogWorkspace();
  const codeQuery = isDirectListingCodeQuery(trimmed);

  const upsert = (row: UnifiedProductSuggestion) => {
    const existing = byKey.get(row.key);
    if (!existing) {
      byKey.set(row.key, { ...row });
      return;
    }
    if (row.asin && !existing.asin) existing.asin = row.asin;
    if (row.fsn && !existing.fsn) existing.fsn = row.fsn;
    if (row.erpProductId && !existing.erpProductId) existing.erpProductId = row.erpProductId;
    if (row.modelName.length > existing.modelName.length) existing.modelName = row.modelName;
  };

  if (/^B0[A-Z0-9]{8}$/i.test(trimmed)) {
    const hit = await unifiedSuggestionFromSelloutCode("amazon", trimmed, scopeFilter);
    if (hit) upsert(hit);
  } else if (looksLikeProductSku(trimmed) && !/^B0/i.test(trimmed)) {
    const hit = await unifiedSuggestionFromSelloutCode("flipkart", trimmed, scopeFilter);
    if (hit) upsert(hit);
  }

  if (!codeQuery) {
    for (const hit of findFlipkartFsnsByModelQuery(trimmed, 20)) {
      const pid = idMap ? lookupErpProductId(idMap, "flipkart", hit.fsn) : null;
      const linked = pid ? lookupCodesByErpProductId(idMap!, pid) : null;
      upsert({
        key: pid ? `pid:${pid}` : `fk:${hit.fsn}`,
        erpProductId: pid,
        modelName: unifiedLookupModelName({
          flipkartName: hit.modelName,
          flipkartCode: hit.fsn,
          amazonCode: linked?.asin,
        }),
        asin: linked?.asin ?? null,
        fsn: hit.fsn,
        subtitle: "",
      });
    }
  }

  if (idMap) {
    for (const entry of searchProductIdMap(idMap, trimmed, 15)) {
      const candidate: UnifiedProductSuggestion = {
        key: `pid:${entry.erpProductId}`,
        erpProductId: entry.erpProductId,
        modelName: entry.modelName || entry.asin || pickFlipkartFsn(entry.fsns) || entry.erpProductId,
        asin: entry.asin || null,
        fsn: pickFlipkartFsn(entry.fsns),
        subtitle: "",
      };
      if (scopeFilter && !(await unifiedSuggestionMatchesScope(candidate, scopeFilter))) {
        continue;
      }
      upsert(candidate);
    }
  }

  if (isManagerCatalogWorkspace(catalogWorkspace)) {
    for (const row of await searchWorkspaceCatalogForLookup(trimmed, catalogWorkspace)) {
      const pid = idMap
        ? lookupErpProductId(idMap, row.marketplace, row.productCode)
        : null;
      const linked = pid ? lookupCodesByErpProductId(idMap!, pid) : null;
      const displayName =
        catalogProductName(row.productName, row.productCode) ||
        unifiedLookupModelName({
          amazonName: row.marketplace === "amazon" ? row.productName : undefined,
          amazonCode: row.marketplace === "amazon" ? row.productCode : linked?.asin,
          flipkartName: row.marketplace === "flipkart" ? row.productName : undefined,
          flipkartCode:
            row.marketplace === "flipkart"
              ? row.productCode
              : linked
                ? pickFlipkartFsn(linked.fsns)
                : null,
        });
      upsert({
        key: pid
          ? `pid:${pid}`
          : `${row.marketplace}:${normalizeKey(row.productCode)}`,
        erpProductId: pid,
        modelName:
          displayName !== "—" && displayName.trim()
            ? displayName
            : row.productName.trim() || row.productCode,
        asin: row.marketplace === "amazon" ? row.productCode : linked?.asin ?? null,
        fsn:
          row.marketplace === "flipkart"
            ? row.productCode
            : linked
              ? pickFlipkartFsn(linked.fsns)
              : null,
        subtitle: "",
      });
    }
  }

  const uploadScope = resolveSelloutUploadScope(catalogWorkspace);
  const [amazon, flipkart] = await Promise.all([
    searchProductSuggestions("amazon", trimmed, catalogWorkspace, scopeFilter, uploadScope),
    searchProductSuggestions("flipkart", trimmed, catalogWorkspace, scopeFilter, uploadScope),
  ]);

  for (const row of amazon) {
    const pid = idMap ? lookupErpProductId(idMap, "amazon", row.productCode) : null;
    const catalog = catalogProductName(row.productName, row.productCode) || row.productName;
    upsert({
      key: pid ? `pid:${pid}` : `name:${normalizeKey(catalog)}`,
      erpProductId: pid,
      modelName: catalog,
      asin: row.productCode,
      fsn: null,
      subtitle: "",
    });
  }

  for (const row of flipkart) {
    const pid = idMap ? lookupErpProductId(idMap, "flipkart", row.productCode) : null;
    const catalog = catalogProductName(row.productName, row.productCode) || row.productName;
    upsert({
      key: pid ? `pid:${pid}` : `name:${normalizeKey(catalog)}`,
      erpProductId: pid,
      modelName: catalog,
      asin: null,
      fsn: row.productCode,
      subtitle: "",
    });
  }

  const results = [...byKey.values()].map((row) => {
    const codes = channelListingLabel(row.asin, row.fsn);
    row.subtitle = row.erpProductId
      ? codes
        ? `ID ${row.erpProductId} · ${codes}`
        : `ID ${row.erpProductId}`
      : codes;
    return row;
  });

  return results.slice(0, 10);
}

/** Browse latest sellout catalogue (no search text) — merged Amazon + Flipkart, up to `limit` SKUs. */
export async function browseUnifiedProducts(
  scopeFilter: ProductScopeFilter,
  limit = 10,
): Promise<UnifiedProductSuggestion[]> {
  const catalogWorkspace = getActiveCatalogWorkspace();
  const uploadScope = resolveSelloutUploadScope(catalogWorkspace);
  const [amazonCodes, flipkartCodes] = await Promise.all([
    getLatestSelloutProductCodeSet("amazon", uploadScope),
    getLatestSelloutProductCodeSet("flipkart", uploadScope),
  ]);
  if (amazonCodes.size === 0 && flipkartCodes.size === 0) return [];

  const idMap = await loadProductIdMap();
  const byKey = new Map<string, UnifiedProductSuggestion>();

  const mergeRow = (
    marketplace: Marketplace,
    productCode: string,
    productName: string,
    row: ProductScopeRow,
  ) => {
    if (!scopeFilter(row)) return;
    const pid = idMap ? lookupErpProductId(idMap, marketplace, productCode) : null;
    const catalog = catalogProductName(productName, productCode) || productName;
    const mapKey = pid ? `pid:${pid}` : `name:${normalizeKey(catalog)}`;
    const existing = byKey.get(mapKey);
    if (!existing) {
      byKey.set(mapKey, {
        key: mapKey,
        erpProductId: pid,
        modelName: catalog,
        asin: marketplace === "amazon" ? productCode : null,
        fsn: marketplace === "flipkart" ? productCode : null,
        subtitle: "",
      });
      return;
    }
    if (marketplace === "amazon") existing.asin = productCode;
    if (marketplace === "flipkart") existing.fsn = productCode;
    if (pid && !existing.erpProductId) existing.erpProductId = pid;
  };

  async function scanMarketplace(marketplace: Marketplace, codes: Set<string>) {
    for (const chunk of chunkArray([...codes], 150)) {
      if (byKey.size >= limit * 4) return;
      const { data, error } = await supabase
        .from("product_master")
        .select("product_code, product_name, category, sub_category, catalog_workspace")
        .eq("marketplace", marketplace)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of (data ?? []) as Array<{
        product_code: string;
        product_name: string;
        category?: string | null;
        sub_category?: string | null;
        catalog_workspace?: string | null;
      }>) {
        const code = row.product_code.trim().toUpperCase();
        if (!codes.has(code)) continue;
        if (!productMasterBelongsToWorkspace(row, catalogWorkspace)) continue;
        mergeRow(marketplace, row.product_code, row.product_name, row);
      }
    }
  }

  await Promise.all([
    scanMarketplace("amazon", amazonCodes),
    scanMarketplace("flipkart", flipkartCodes),
  ]);

  return [...byKey.values()]
    .sort((a, b) => a.modelName.localeCompare(b.modelName, undefined, { sensitivity: "base" }))
    .slice(0, limit)
    .map((row) => {
      const codes = channelListingLabel(row.asin, row.fsn);
      row.subtitle = row.erpProductId
        ? codes
          ? `ID ${row.erpProductId} · ${codes}`
          : `ID ${row.erpProductId}`
        : codes;
      return row;
    });
}

export async function findUnifiedProduct(
  lookupText: string,
  options?: { scopeFilter?: ProductScopeFilter },
): Promise<UnifiedProductSuggestion | null> {
  const trimmed = lookupText.trim();
  if (!trimmed) return null;

  const idMap = await loadProductIdMap();
  if (idMap && /^\d+$/.test(trimmed)) {
    const entry = lookupCodesByErpProductId(idMap, trimmed);
    if (entry) {
      return {
        key: `pid:${entry.erpProductId}`,
        erpProductId: entry.erpProductId,
        modelName: entry.modelName || entry.asin || pickFlipkartFsn(entry.fsns) || entry.erpProductId,
        asin: entry.asin || null,
        fsn: pickFlipkartFsn(entry.fsns),
        subtitle: "",
      };
    }
  }

  const scopeFilter = options?.scopeFilter;

  if (/^B0[A-Z0-9]{8}$/i.test(trimmed)) {
    const hit = await unifiedSuggestionFromSelloutCode("amazon", trimmed, scopeFilter);
    if (hit) return withSubtitle(hit);
  }

  if (looksLikeProductSku(trimmed) && !/^B0/i.test(trimmed)) {
    const hit = await unifiedSuggestionFromSelloutCode("flipkart", trimmed, scopeFilter);
    if (hit) return withSubtitle(hit);
  }

  if (idMap && /^B0[A-Z0-9]{8}$/i.test(trimmed)) {
    const pid = lookupErpProductId(idMap, "amazon", trimmed);
    if (pid) {
      const entry = lookupCodesByErpProductId(idMap, pid);
      if (entry) {
        const candidate = {
          key: `pid:${entry.erpProductId}`,
          erpProductId: entry.erpProductId,
          modelName: entry.modelName || entry.asin || entry.erpProductId,
          asin: entry.asin || null,
          fsn: pickFlipkartFsn(entry.fsns),
          subtitle: "",
        };
        if (!scopeFilter || (await unifiedSuggestionMatchesScope(candidate, scopeFilter))) {
          return withSubtitle(candidate);
        }
      }
    }
  }

  if (idMap && looksLikeProductSku(trimmed) && !/^B0/i.test(trimmed)) {
    const pid = lookupErpProductId(idMap, "flipkart", trimmed);
    if (pid) {
      const entry = lookupCodesByErpProductId(idMap, pid);
      if (entry) {
        const candidate = {
          key: `pid:${entry.erpProductId}`,
          erpProductId: entry.erpProductId,
          modelName: entry.modelName || pickFlipkartFsn(entry.fsns) || entry.erpProductId,
          asin: entry.asin || null,
          fsn: pickFlipkartFsn(entry.fsns),
          subtitle: "",
        };
        if (!scopeFilter || (await unifiedSuggestionMatchesScope(candidate, scopeFilter))) {
          return withSubtitle(candidate);
        }
      }
    }
  }

  const suggestions = await searchUnifiedProducts(trimmed, options);
  const norm = trimmed.toLowerCase();
  const exact = suggestions.find(
    (row) =>
      row.modelName.toLowerCase() === norm ||
      row.asin?.toLowerCase() === norm ||
      row.fsn?.toLowerCase() === norm ||
      row.erpProductId === trimmed,
  );
  const pick = exact ?? suggestions[0] ?? null;
  return pick ? withSubtitle(pick) : null;
}

function withSubtitle(row: UnifiedProductSuggestion): UnifiedProductSuggestion {
  const codes = channelListingLabel(row.asin, row.fsn);
  return {
    ...row,
    subtitle: row.erpProductId
      ? codes
        ? `ID ${row.erpProductId} · ${codes}`
        : `ID ${row.erpProductId}`
      : codes,
  };
}

export async function resolveErpProductIdFromListing(
  marketplace: Marketplace,
  productCode: string,
): Promise<string | null> {
  return resolveErpProductIdForListing(marketplace, productCode);
}

export async function resolveProductContextByErpId(
  erpProductId: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<ProductContext | null> {
  const idMap = await loadProductIdMap();
  if (!idMap) return null;
  const entry = lookupCodesByErpProductId(idMap, erpProductId);
  if (!entry) return null;

  const flipkartCode = pickFlipkartFsn(entry.fsns);
  const [amazon, flipkart] = await Promise.all([
    entry.asin ? getProductByCode("amazon", entry.asin, catalogWorkspace) : null,
    flipkartCode
      ? getProductByCode("flipkart", flipkartCode, catalogWorkspace)
      : null,
  ]);

  const defaultMarketplace = await resolveSelloutMarketplaceForListing(
    { asin: entry.asin || amazon?.product_code, fsn: flipkartCode || flipkart?.product_code },
    catalogWorkspace,
  );
  const modelName = unifiedLookupModelName({
    hoModelName: entry.modelName,
    amazonName: amazon?.product_name,
    amazonCode: amazon?.product_code ?? entry.asin,
    flipkartName: flipkart?.product_name,
    flipkartCode: flipkart?.product_code ?? flipkartCode,
    fallback: erpProductId,
  });

  return {
    erpProductId: entry.erpProductId,
    modelName,
    amazon,
    flipkart,
    defaultMarketplace,
  };
}

export async function searchProductSuggestionsGlobal(
  lookupText: string,
): Promise<GlobalProductSuggestion[]> {
  const trimmed = lookupText.trim();
  if (!trimmed) return [];

  const idMap = await loadProductIdMap();
  const fromIdMap: GlobalProductSuggestion[] = idMap
    ? searchProductIdMap(idMap, trimmed, 8).flatMap((entry) => {
        const out: GlobalProductSuggestion[] = [];
        if (entry.asin) {
          out.push({
            marketplace: "amazon",
            productCode: entry.asin,
            productName: entry.modelName || entry.asin,
          });
        }
        for (const fsn of entry.fsns) {
          out.push({
            marketplace: "flipkart",
            productCode: fsn,
            productName: entry.modelName || fsn,
          });
        }
        return out;
      })
    : [];

  const [amazon, flipkart] = await Promise.all([
    searchProductSuggestions("amazon", trimmed),
    searchProductSuggestions("flipkart", trimmed),
  ]);

  const merged: GlobalProductSuggestion[] = [
    ...fromIdMap,
    ...amazon.map((row) => ({ ...row, marketplace: "amazon" as const })),
    ...flipkart.map((row) => ({ ...row, marketplace: "flipkart" as const })),
  ];

  const seen = new Set<string>();
  const deduped: GlobalProductSuggestion[] = [];
  for (const row of merged) {
    const key = `${row.marketplace}:${row.productCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
    if (deduped.length >= 12) break;
  }
  return deduped;
}

/**
 * Channel toggle peers: match Amazon ↔ Flipkart via ERP product ID from the latest HO stock report,
 * then fall back to catalogue model name.
 */
export async function getPeersForSelloutChannel(
  marketplace: Marketplace,
  productCode: string,
  productName?: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<{
  amazon: ProductMaster | null;
  flipkart: ProductMaster | null;
  erpProductId: string | null;
}> {
  const code = productCode.trim();
  const idMap = await loadProductIdMap();

  if (idMap && code) {
    let pid = lookupErpProductId(idMap, marketplace, code);
    if (!pid && /^\d+$/.test(code) && lookupCodesByErpProductId(idMap, code)) {
      pid = code;
    }

    if (pid) {
      const entry = lookupCodesByErpProductId(idMap, pid);
      if (entry) {
        const flipkartCode = pickFlipkartFsn(
          entry.fsns,
          marketplace === "flipkart" ? code : undefined,
        );
        const [amazonRow, flipkartRow] = await Promise.all([
          entry.asin
            ? getProductByCode("amazon", entry.asin, catalogWorkspace)
            : null,
          flipkartCode
            ? getProductByCode("flipkart", flipkartCode, catalogWorkspace)
            : null,
        ]);

        if (marketplace === "amazon") {
          const current = await getProductByCode("amazon", code, catalogWorkspace);
          return {
            amazon: current ?? amazonRow,
            flipkart: flipkartRow,
            erpProductId: entry.erpProductId,
          };
        }
        const current = await getProductByCode("flipkart", code, catalogWorkspace);
        return {
          amazon: amazonRow,
          flipkart: current ?? flipkartRow,
          erpProductId: entry.erpProductId,
        };
      }
    }
  }

  const canonical =
    catalogProductName(productName, productCode)?.trim() || productName?.trim() || "";
  if (!canonical) {
    const current = code
      ? await getProductByCode(marketplace, code, catalogWorkspace)
      : null;
    return {
      amazon: marketplace === "amazon" ? current : null,
      flipkart: marketplace === "flipkart" ? current : null,
      erpProductId: null,
    };
  }
  const catalogNorm = normalizeKey(canonical);

  const fetchLatestByName = async (
    mp: Marketplace,
    name: string,
  ): Promise<ProductMaster | null> => {
    const { data, error } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", mp)
      .eq("product_name", name)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(getErrorMessage(error));
    return ((data ?? [])[0] ?? null) as ProductMaster | null;
  };

  const resolveChannel = async (mp: Marketplace): Promise<ProductMaster | null> => {
    const exact = await fetchLatestByName(mp, canonical);
    if (exact) return exact;

    const probe = canonical.length > 24 ? canonical.slice(0, 24) : canonical;
    const { data, error } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", mp)
      .ilike("product_name", `%${probe}%`)
      .order("updated_at", { ascending: false })
      .limit(40);
    if (error) throw new Error(getErrorMessage(error));

    for (const row of (data ?? []) as ProductMaster[]) {
      const key = normalizeKey(catalogProductName(row.product_name, row.product_code));
      if (key && key === catalogNorm) return row;
    }
    return null;
  };

  const [amazon, flipkart] = await Promise.all([
    resolveChannel("amazon"),
    resolveChannel("flipkart"),
  ]);

  if (marketplace === "amazon" && code) {
    const current = await getProductByCode("amazon", code, catalogWorkspace);
    return { amazon: current ?? amazon, flipkart, erpProductId: null };
  }
  if (marketplace === "flipkart" && code) {
    const current = await getProductByCode("flipkart", code, catalogWorkspace);
    return { amazon, flipkart: current ?? flipkart, erpProductId: null };
  }

  return { amazon, flipkart, erpProductId: null };
}

function productRowVisibleInCatalogWorkspace(
  row: ProductMaster,
  marketplace: Marketplace,
  catalogWorkspace: CatalogWorkspace,
): boolean {
  if (productMasterBelongsToWorkspace(row, catalogWorkspace)) return true;
  if (!isManagerCatalogWorkspace(catalogWorkspace)) return false;
  const legacyMp =
    marketplace === "amazon" || marketplace === "flipkart" ? marketplace : "amazon";
  return rowBelongsToManagerDashboard(
    {
      category: row.category,
      sub_category: row.sub_category,
      product_name: row.product_name,
      catalog_workspace: row.catalog_workspace,
    },
    resolveManagerDashboardScopeContext({
      catalogWorkspace,
      marketplace: legacyMp,
    }),
  );
}

export async function getProductByCode(
  marketplace: Marketplace,
  productCode: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<ProductMaster | null> {
  const normalized = normalizeMarketplaceProductCode(marketplace, productCode);
  if (!normalized) return null;
  const { data, error } = await supabase
    .from("product_master")
    .select("*")
    .eq("marketplace", marketplace)
    .eq("product_code", normalized)
    .maybeSingle();
  if (error) throw new Error(getErrorMessage(error));
  const row = (data ?? null) as ProductMaster | null;
  if (row && !productRowVisibleInCatalogWorkspace(row, marketplace, catalogWorkspace)) {
    return null;
  }
  return row;
}

export async function getLatestMetricForProduct(
  marketplace: Marketplace,
  productCode: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<ComputedMetric | null> {
  const normalized = normalizeMarketplaceProductCode(marketplace, productCode);
  if (!normalized) return null;

  async function fetchMetricForUpload(uploadId: string | null): Promise<ComputedMetric | null> {
    if (!uploadId) return null;
    const { data, error } = await supabase
      .from("computed_metrics")
      .select("*")
      .eq("marketplace", marketplace)
      .eq("product_code", normalized)
      .eq("upload_id", uploadId)
      .limit(1);
    if (error) throw new Error(getErrorMessage(error));
    const exact = ((data ?? [])[0] ?? null) as ComputedMetric | null;
    if (exact || marketplace !== "flipkart") return exact;

    const { data: ciRows, error: ciError } = await supabase
      .from("computed_metrics")
      .select("*")
      .eq("marketplace", marketplace)
      .eq("upload_id", uploadId)
      .ilike("product_code", normalized)
      .limit(1);
    if (ciError) throw new Error(getErrorMessage(ciError));
    return ((ciRows ?? [])[0] ?? null) as ComputedMetric | null;
  }

  const selloutMeta = await getLatestSelloutUploadMeta(marketplace, catalogWorkspace);
  let metric = await fetchMetricForUpload(selloutMeta.id);

  if (!metric) {
    const recentUploads = await listWorkspaceSelloutUploadIds(
      marketplace,
      catalogWorkspace,
      12,
    );
    for (const upload of recentUploads) {
      if (upload.id === selloutMeta.id) continue;
      metric = await fetchMetricForUpload(upload.id);
      if (metric) break;
    }
  }

  let result: ComputedMetric | null = metric;

  if (marketplace === "flipkart") {
    const monthly = await getProductMonthlySellout(marketplace, normalized, catalogWorkspace);
    const monthlyMap = buildSheetMonthUnitsMap(monthly);
    if (result) {
      result = repairFlipkartComputedMetric(result, monthlyMap);
    } else if (monthly.length === 0) {
      return null;
    } else {
      result = repairFlipkartComputedMetric(
        buildSyntheticMetricFromMonthly(
          marketplace,
          normalized,
          monthly,
          selloutMeta.snapshotDate,
        ),
        monthlyMap,
      );
    }
  }

  if (!result) return null;

  if (
    !isQcomMarketplace(marketplace) &&
    usesHoStockNetworkPattern(getActiveDataScope()) &&
    (marketplace === "amazon" || marketplace === "flipkart")
  ) {
    const hoCtx = await loadHoStockNetworkContext(catalogWorkspace);
    const withNetwork = attachHoStockNetworkFields(result, hoCtx, {
      marketplace,
      productCode: normalized,
      dataScope: getActiveDataScope(),
    });
    return applyHoStockNetworkToMetricRow(withNetwork, { hoNetworkActive: hoCtx !== null });
  }

  return result;
}

function previousCalendarMonthYmFromSnapshot(snapshotDate: string): string {
  const d = new Date(`${snapshotDate}T12:00:00`);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** When computed_metrics is missing but daily_sales month columns exist (e.g. partial ingest). */
function buildSyntheticMetricFromMonthly(
  marketplace: Marketplace,
  productCode: string,
  monthly: DailySale[],
  snapshotDate: string | null,
): ComputedMetric {
  const monthlyMap = buildSheetMonthUnitsMap(monthly);
  const asOf =
    snapshotDate?.trim() ||
    monthly[monthly.length - 1]?.sale_date?.slice(0, 10) ||
    new Date().toISOString().slice(0, 10);
  const snapYm = asOf.slice(0, 7);
  const prevYm = previousCalendarMonthYmFromSnapshot(asOf);
  const mayMtd = monthlyMap.get(snapYm) ?? 0;
  const aprSo =
    marketplace === "flipkart"
      ? flipkartAprilUnitsFromMonthMap(monthlyMap, asOf)
      : Math.max(monthlyMap.get(prevYm) ?? 0, 0);

  return buildComputedMetric({
    marketplace,
    product_code: productCode,
    as_of_date: asOf,
    inventory_units: 0,
    total_so_units: 0,
    may_mtd_units: mayMtd,
    apr_so_units: aprSo,
    prior_year_mtd_units: 0,
    prior_fy_so_units: 0,
    drr_units: 0,
    drr_28d_avg_units: 0,
    doc_days_excel: null,
  });
}

/**
 * Product + KPI + monthly history for Sellout & Growth — aligns with dashboard upload scope,
 * case-insensitive Flipkart FSN, and month-column fallback when KPI rows are absent.
 */
/** Why a listing exists in product_master but not this manager workspace (e.g. wrong Category column). */
export function productWorkspaceMismatchHint(
  row: Pick<ProductMaster, "category" | "sub_category" | "catalog_workspace" | "product_name">,
  marketplace: Marketplace,
  catalogWorkspace: CatalogWorkspace,
): string | null {
  if (productRowVisibleInCatalogWorkspace(row as ProductMaster, marketplace, catalogWorkspace)) {
    return null;
  }
  const cat = String(row.category ?? "").trim() || "—";
  const sub = String(row.sub_category ?? "").trim() || "—";
  const codeLabel = marketplace === "amazon" ? "ASIN" : "FSN";
  if (catalogWorkspace === CATALOG_WORKSPACE_HOME_AUDIO) {
    return (
      `This ${codeLabel} is in the database as Category “${cat}” (${sub}), not Home Audio, so it is not part of /app/ha. ` +
      `On your sellout sheet, check the Category column for this row — IT Accessories / speakers belong under Rithika (/app/ri), not Home Audio.`
    );
  }
  if (catalogWorkspace === CATALOG_WORKSPACE_RITHIKA) {
    return `This ${codeLabel} is Category “${cat}” (${sub}), which is outside the Rithika IT/gaming scope for /app/ri.`;
  }
  return `This ${codeLabel} is Category “${cat}” (${sub}) and is not in scope for this workspace.`;
}

export async function loadProductSelloutContext(
  marketplace: Marketplace,
  productCode: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<{
  product: ProductMaster | null;
  latestMetric: ComputedMetric | null;
  monthlyRows: DailySale[];
  mismatchHint: string | null;
}> {
  const normalized = normalizeMarketplaceProductCode(marketplace, productCode);
  if (!normalized) {
    return { product: null, latestMetric: null, monthlyRows: [], mismatchHint: null };
  }

  let mismatchHint: string | null = null;
  let product = await getProductByCode(marketplace, normalized, catalogWorkspace);
  if (!product) {
    const { data, error } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", marketplace)
      .eq("product_code", normalized)
      .maybeSingle();
    if (error) throw new Error(getErrorMessage(error));
    const row = (data ?? null) as ProductMaster | null;
    if (row) {
      if (productRowVisibleInCatalogWorkspace(row, marketplace, catalogWorkspace)) {
        product = row;
      } else {
        mismatchHint = productWorkspaceMismatchHint(row, marketplace, catalogWorkspace);
      }
    }
  }

  let monthlyRows = await getProductMonthlySellout(
    marketplace,
    normalized,
    catalogWorkspace,
  );
  let latestMetric = await getLatestMetricForProduct(
    marketplace,
    normalized,
    catalogWorkspace,
  );

  if (!latestMetric && monthlyRows.length > 0) {
    const selloutMeta = await getLatestSelloutUploadMeta(marketplace, catalogWorkspace);
    if (selloutMeta.id) {
      const { data, error } = await supabase
        .from("computed_metrics")
        .select("*")
        .eq("marketplace", marketplace)
        .eq("upload_id", selloutMeta.id)
        .eq("product_code", normalized)
        .limit(1);
      if (error) throw new Error(getErrorMessage(error));
      let row = ((data ?? [])[0] ?? null) as ComputedMetric | null;
      if (!row && marketplace === "flipkart") {
        const ci = await supabase
          .from("computed_metrics")
          .select("*")
          .eq("marketplace", marketplace)
          .eq("upload_id", selloutMeta.id)
          .ilike("product_code", normalized)
          .limit(1);
        if (ci.error) throw new Error(getErrorMessage(ci.error));
        row = ((ci.data ?? [])[0] ?? null) as ComputedMetric | null;
      }
      if (row) latestMetric = row;
    }
  }

  if (marketplace === "flipkart") {
    const monthlyMap = buildSheetMonthUnitsMap(monthlyRows);
    if (latestMetric) {
      latestMetric = repairFlipkartComputedMetric(latestMetric, monthlyMap);
    } else if (monthlyRows.length > 0) {
      const selloutMeta = await getLatestSelloutUploadMeta(marketplace, catalogWorkspace);
      latestMetric = repairFlipkartComputedMetric(
        buildSyntheticMetricFromMonthly(
          marketplace,
          normalized,
          monthlyRows,
          selloutMeta.snapshotDate,
        ),
        monthlyMap,
      );
    }
  }

  return { product, latestMetric, monthlyRows, mismatchHint };
}

export async function searchProductSuggestions(
  marketplace: Marketplace,
  lookupText: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
  scopeFilter?: ProductScopeFilter,
  uploadScope: UploadContextScope = resolveSelloutUploadScope(catalogWorkspace),
): Promise<Array<{ productCode: string; productName: string }>> {
  const normalized = lookupText.trim();
  if (normalized.length < 2) return [];

  const legacyMp =
    marketplace === "amazon" || marketplace === "flipkart" ? marketplace : "amazon";
  const scopeCtx = resolveManagerDashboardScopeContext({
    catalogWorkspace,
    marketplace: legacyMp,
  });
  const allowedCodes = await getLatestSelloutProductCodeSet(marketplace, uploadScope);
  const requireUploadMetric = !isManagerCatalogWorkspace(catalogWorkspace);
  if (requireUploadMetric && allowedCodes.size === 0) return [];

  const codeFilter =
    marketplace === "flipkart" ? normalized.toUpperCase() : normalized;

  const { data, error } = await supabase
    .from("product_master")
    .select("product_code, product_name, category, sub_category, catalog_workspace")
    .eq("marketplace", marketplace)
    .or(`product_code.ilike.%${codeFilter}%,product_name.ilike.%${normalized}%`)
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(getErrorMessage(error));

  const seen = new Set<string>();
  const results: Array<{ productCode: string; productName: string }> = [];

  const pushRow = (productCode: string, productName: string) => {
    const display =
      marketplace === "flipkart"
        ? enrichFlipkartProductName(productCode, productName)
        : productName;
    const key = productCode.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ productCode, productName: display });
  };

  for (const row of (data ?? []) as Array<{
    product_code: string;
    product_name: string;
    category?: string | null;
    sub_category?: string | null;
    catalog_workspace?: string | null;
  }>) {
    const code = row.product_code.trim().toUpperCase();
    if (requireUploadMetric && !allowedCodes.has(code)) continue;
    if (!rowBelongsToManagerDashboard(row, scopeCtx)) continue;
    if (
      !isManagerCatalogWorkspace(catalogWorkspace) &&
      !productMasterBelongsToWorkspace(row, catalogWorkspace)
    ) {
      continue;
    }
    if (scopeFilter && !scopeFilter(row)) continue;
    pushRow(row.product_code, row.product_name);
  }

  if (marketplace === "flipkart" && results.length < 15) {
    const catalogHits = findFlipkartFsnsByModelQuery(normalized, 20);
    const missingFsns = catalogHits
      .map((h) => h.fsn)
      .filter((fsn) => !seen.has(fsn));
    if (missingFsns.length > 0) {
      const { data: catalogRows, error: catErr } = await supabase
        .from("product_master")
        .select("product_code, product_name, category, sub_category, catalog_workspace")
        .eq("marketplace", "flipkart")
        .in("product_code", missingFsns.slice(0, 30));
      if (catErr) throw new Error(getErrorMessage(catErr));
      const nameByFsn = new Map(catalogHits.map((h) => [h.fsn, h.modelName]));
      for (const row of (catalogRows ?? []) as Array<{
        product_code: string;
        product_name: string;
        category?: string | null;
        sub_category?: string | null;
        catalog_workspace?: string | null;
      }>) {
        const code = row.product_code.trim().toUpperCase();
        if (requireUploadMetric && !allowedCodes.has(code)) continue;
        if (!productMasterBelongsToWorkspace(row, catalogWorkspace)) continue;
        if (scopeFilter && !scopeFilter(row)) continue;
        if (!rowBelongsToManagerDashboard(row, scopeCtx)) continue;
        pushRow(
          row.product_code,
          nameByFsn.get(row.product_code.toUpperCase()) ?? row.product_name,
        );
      }
    }
  }

  return results.slice(0, 15);
}

export async function getProductSelloutHistory(
  marketplace: Marketplace,
  productCode: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<{
  product: ProductMaster | null;
  history: ComputedMetric[];
}> {
  const normalized = productCode.trim();
  if (!normalized) return { product: null, history: [] };

  const { data: product, error: productError } = await supabase
    .from("product_master")
    .select("*")
    .eq("marketplace", marketplace)
    .eq("product_code", normalized)
    .maybeSingle();
  if (productError) throw new Error(getErrorMessage(productError));
  const master = (product ?? null) as ProductMaster | null;
  if (master && !productMasterBelongsToWorkspace(master, catalogWorkspace)) {
    return { product: null, history: [] };
  }

  const selloutMeta = await getLatestSelloutUploadMeta(marketplace, catalogWorkspace);
  if (!selloutMeta.id) {
    return { product: master, history: [] };
  }

  const { data: history, error: historyError } = await supabase
    .from("computed_metrics")
    .select("*")
    .eq("marketplace", marketplace)
    .eq("product_code", normalized)
    .eq("upload_id", selloutMeta.id)
    .order("as_of_date", { ascending: true });
  if (historyError) throw new Error(getErrorMessage(historyError));

  return {
    product: master,
    history: (history ?? []) as ComputedMetric[],
  };
}

function mergeDailySalesToMonthAnchors(
  marketplace: Marketplace,
  normalized: string,
  rows: Array<DailySale & { upload_id?: string | null }>,
  uploadOrder: string[],
): DailySale[] {
  const rankByUpload = new Map<string, number>();
  uploadOrder.forEach((id, idx) => rankByUpload.set(id, idx));
  const byYm = new Map<string, { units: number; rank: number }>();
  for (const row of rows) {
    const ym = String(row.sale_date ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const units = Math.max(0, Number(row.units_sold ?? 0));
    if (units <= 0) continue;
    const uploadId = String(row.upload_id ?? "");
    const rank = rankByUpload.has(uploadId) ? (rankByUpload.get(uploadId) as number) : Number.MAX_SAFE_INTEGER;
    const prev = byYm.get(ym);
    if (!prev || rank < prev.rank || (rank === prev.rank && units > prev.units)) {
      byYm.set(ym, { units, rank });
    }
  }
  return [...byYm.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, rec]) => ({
      marketplace,
      product_code: normalized,
      sale_date: `${ym}-01`,
      units_sold: rec.units,
    }));
}

async function fetchProductMonthlySelloutRows(
  marketplace: Marketplace,
  normalized: string,
  uploadIds: string[],
): Promise<Array<DailySale & { upload_id?: string | null }>> {
  if (uploadIds.length === 0) return [];

  const select = "marketplace, product_code, sale_date, units_sold, upload_id";
  const { data, error } = await supabase
    .from("daily_sales")
    .select(select)
    .eq("marketplace", marketplace)
    .eq("product_code", normalized)
    .in("upload_id", uploadIds)
    .order("sale_date", { ascending: true });
  if (error) throw new Error(getErrorMessage(error));
  let rows = (data ?? []) as Array<DailySale & { upload_id?: string | null }>;

  if (marketplace === "flipkart") {
    const { data: ciData, error: ciError } = await supabase
      .from("daily_sales")
      .select(select)
      .eq("marketplace", marketplace)
      .ilike("product_code", normalized)
      .in("upload_id", uploadIds)
      .order("sale_date", { ascending: true });
    if (ciError) throw new Error(getErrorMessage(ciError));
    const byKey = new Map<string, DailySale & { upload_id?: string | null }>();
    for (const row of [...rows, ...((ciData ?? []) as DailySale[])]) {
      const ym = String(row.sale_date ?? "").slice(0, 7);
      const key = `${ym}:${row.product_code}`;
      const prev = byKey.get(key);
      const units = Math.max(0, Number(row.units_sold ?? 0));
      if (!prev || units > Number(prev.units_sold ?? 0)) {
        byKey.set(key, { ...row, units_sold: units });
      }
    }
    rows = [...byKey.values()].sort((a, b) =>
      String(a.sale_date).localeCompare(String(b.sale_date)),
    );
  }

  return rows;
}

/**
 * Event SO month columns (Apr-25, …) merged across recent workspace uploads — max units per
 * calendar month so prior-FY history survives when the latest file only refreshes Apr/May MTD.
 */
export async function getProductMonthlySellout(
  marketplace: Marketplace,
  productCode: string,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
): Promise<DailySale[]> {
  const normalized = normalizeMarketplaceProductCode(marketplace, productCode);
  if (!normalized) return [];

  const selloutMeta = await getLatestSelloutUploadMeta(marketplace, catalogWorkspace);
  const uploadIds = selloutMeta.id
    ? [
        selloutMeta.id,
        ...(await listWorkspaceSelloutUploadIds(marketplace, catalogWorkspace, 12))
          .map((u) => u.id)
          .filter((id) => id !== selloutMeta.id),
      ]
    : (await listWorkspaceSelloutUploadIds(marketplace, catalogWorkspace, 12)).map(
        (u) => u.id,
      );

  const rows = await fetchProductMonthlySelloutRows(marketplace, normalized, uploadIds);
  return mergeDailySalesToMonthAnchors(marketplace, normalized, rows, uploadIds);
}

export async function getProductMonthlySelloutByModel(
  marketplace: Marketplace,
  productName: string,
): Promise<DailySale[]> {
  const model = productName.trim();
  if (!model) return [];

  const { data: modelRows, error: modelError } = await supabase
    .from("product_master")
    .select("product_code, product_name")
    .eq("marketplace", marketplace)
    .ilike("product_name", model);
  if (modelError) throw new Error(getErrorMessage(modelError));

  const exactCodes = ((modelRows ?? []) as Array<{ product_code: string }>).map(
    (row) => row.product_code,
  );

  const { data: partialRows, error: partialError } = await supabase
    .from("product_master")
    .select("product_code, product_name")
    .eq("marketplace", marketplace)
    .ilike("product_name", `%${model}%`)
    .limit(20);
  if (partialError) throw new Error(getErrorMessage(partialError));

  const allCodes = new Set<string>(exactCodes);
  for (const row of (partialRows ?? []) as Array<{ product_code: string }>) {
    allCodes.add(row.product_code);
  }
  if (allCodes.size === 0) return [];

  const codeList = [...allCodes]
    .map((code) => `"${code.replace(/"/g, '\\"')}"`)
    .join(",");

  const { data, error } = await supabase
    .from("daily_sales")
    .select("marketplace, product_code, sale_date, units_sold")
    .eq("marketplace", marketplace)
    .filter("product_code", "in", `(${codeList})`)
    .order("sale_date", { ascending: true });
  if (error) throw new Error(getErrorMessage(error));
  return (data ?? []) as DailySale[];
}

function matchesTrackedSubCategory(
  rowSubCategory: string | null | undefined,
  subCategory: SubCategory,
): boolean {
  const rowKey = normalizeKey(rowSubCategory ?? "");
  const target = normalizeKey(subCategory);
  if (rowKey === target) return true;
  if (subCategory === "monitor" && rowKey === "monitors") return true;
  if (subCategory === "projector" && rowKey === "projectors") return true;
  if (subCategory === "cartridge" && rowKey === "cartridge") return true;
  return false;
}

/**
 * Amazon / Flipkart sellout masters put monitors under **Category "Monitor & Acc."** (wording may vary).
 * Excel roll-up for **Monitors** = that category + **Sub Category = Monitor** only (excludes Monitor Arm, etc.).
 */
export function isMonitorAccessorySheetCategory(category: string | null | undefined): boolean {
  const c = normalizeKey(category ?? "");
  if (!c) return false;
  return c.includes("monitor") && (c.includes("acc") || c.includes("accessor"));
}

/** Ratings / sellout masters: **Projector & Acc.** category (wording may vary). */
export function isProjectorAccessorySheetCategory(category: string | null | undefined): boolean {
  const c = normalizeKey(category ?? "");
  if (!c) return false;
  return c.includes("projector") && (c.includes("acc") || c.includes("accessor"));
}

/** Sheet Category values for Hari / Monitor+Projector workspace (Ecom Sellout). */
export function isMarketplaceDashboardSheetCategory(
  category: string | null | undefined,
): boolean {
  const c = normalizeKey(category ?? "");
  if (!c) return false;
  if (isCartridgeSheetCategory(category)) return true;
  if (isMonitorAccessorySheetCategory(category)) return true;
  if (isProjectorAccessorySheetCategory(category)) return true;
  return false;
}

/**
 * Amazon / Flipkart dashboard rows: core M/P ingest plus Cartridge (Hari).
 * Does not apply to QCom or other tenants.
 */
export function productMatchesMarketplaceDashboardScope(
  row: Pick<ProductMaster, "category" | "sub_category"> & {
    product_name?: string | null;
  },
): boolean {
  if (productMatchesAnyCoreSelloutCategory(row)) return true;
  if (
    isCartridgeSheetCategory(row.category) ||
    normalizeKey(row.sub_category ?? "") === "cartridge"
  ) {
    return true;
  }
  const cat = String(row.category ?? "").trim();
  if (!isMarketplaceDashboardSheetCategory(cat)) return false;
  return true;
}

export function productMatchesWorkspaceDashboardScope(
  row: Pick<ProductMaster, "category" | "sub_category"> & {
    product_name?: string | null;
  },
  dataScope: DataScope = "default",
): boolean {
  if (dataScope === "dawg") return productMatchesDawgScope(row);
  return productMatchesMarketplaceDashboardScope(row);
}

/** True when a row belongs to any of the four core sellout categories (strict rules). */
export function productMatchesAnyCoreSelloutCategory(
  row: Pick<ProductMaster, "category" | "sub_category"> & {
    product_name?: string | null;
  },
): boolean {
  return CORE_SELL_OUT_SUB_CATEGORIES.some((subCategory) =>
    productMatchesCategoryRollup(subCategory, row),
  );
}

/** Same rules as the Ecom Sellout / FK master row filters for category analysis. */
export function productMatchesCategoryRollup(
  subCategory: SubCategory,
  row: Pick<ProductMaster, "category" | "sub_category"> & {
    product_name?: string | null;
  },
): boolean {
  if (subCategory === "cartridge") {
    return (
      isCartridgeSheetCategory(row.category) ||
      normalizeKey(row.sub_category ?? "") === "cartridge"
    );
  }

  if (!CORE_SELL_OUT_SUB_CATEGORIES.includes(subCategory as (typeof CORE_SELL_OUT_SUB_CATEGORIES)[number])) {
    return false;
  }

  const productName = String(row.product_name ?? "");
  const hay = buildSelloutClassificationHaystack(
    String(row.category ?? ""),
    String(row.sub_category ?? ""),
    productName,
  );

  if (isExcludedNonDisplaySelloutProduct(hay)) return false;

  if (
    (subCategory === "monitor" || subCategory === "monitor_arm") &&
    isWearableProductName(productName)
  ) {
    return false;
  }

  const inferred = inferSubCategoryFromProductFields(
    productName,
    String(row.category ?? ""),
    String(row.sub_category ?? ""),
  );
  if (inferred) return inferred === subCategory;

  if (!matchesTrackedSubCategory(row.sub_category, subCategory)) return false;

  if (subCategory === "monitor" || subCategory === "monitor_arm") {
    const cat = String(row.category ?? "").trim();
    if (!cat) return true;
    return isMonitorAccessorySheetCategory(row.category);
  }

  if (subCategory === "projector") {
    const sub = normalizeKey(row.sub_category ?? "");
    if (sub !== "projector" && sub !== "projectors") return false;
    const cat = String(row.category ?? "").trim();
    if (!cat) return true;
    return (
      isProjectorAccessorySheetCategory(row.category) ||
      normalizeKey(cat).includes("projector")
    );
  }

  if (subCategory === "projector_screen") {
    const cat = String(row.category ?? "").trim();
    if (!cat) return true;
    return (
      isProjectorAccessorySheetCategory(row.category) ||
      normalizeKey(cat).includes("projector")
    );
  }

  return true;
}

/** ASINs / FSNs on the latest completed sellout upload for this marketplace. */
/** One daWg workbook → Amazon + Flipkart sellout uploads (data_scope = dawg). */
export async function ingestDawgCombinedSelloutUpload({
  file,
  fileName,
  uploadedBy,
  snapshotDate,
  onProgress,
}: {
  file: File;
  fileName: string;
  uploadedBy: string;
  snapshotDate: string;
  onProgress?: (update: IngestProgressUpdate) => void;
}): Promise<{ amazonValid: number; flipkartValid: number }> {
  onProgress?.({ message: "Reading Amazon and Flipkart tabs from workbook…" });
  const { amazon, flipkart } = await parseDawgCombinedSelloutFile(file, snapshotDate);

  let amazonValid = 0;
  let flipkartValid = 0;

  if (amazon.validCount > 0) {
    onProgress?.({ message: `Saving Amazon (${amazon.validCount} SKUs)…`, percent: 35 });
    await ingestParsedUpload({
      payload: amazon,
      marketplace: "amazon",
      fileName: `${fileName} · Amazon`,
      uploadedBy,
      snapshotDate,
      dataScope: "dawg",
      deferPrune: true,
      onProgress,
    });
    amazonValid = amazon.validCount;
  }

  if (flipkart.validCount > 0) {
    onProgress?.({ message: `Saving Flipkart (${flipkart.validCount} SKUs)…`, percent: 70 });
    await ingestParsedUpload({
      payload: flipkart,
      marketplace: "flipkart",
      fileName: `${fileName} · Flipkart`,
      uploadedBy,
      snapshotDate,
      dataScope: "dawg",
      onProgress,
    });
    flipkartValid = flipkart.validCount;
  }

  if (amazonValid === 0 && flipkartValid === 0) {
    throw new Error(
      "No daWg sellout rows were saved — check that Amazon and Flipkart tabs have Gaming - daWg or Personal Audio categories.",
    );
  }

  return { amazonValid, flipkartValid };
}

export async function getLatestSelloutProductCodeSet(
  marketplace: Marketplace,
  scope?: UploadContextScope,
): Promise<Set<string>> {
  const resolvedScope =
    scope ??
    (getActiveDataScope() === "dawg" ? "dawg" : getActiveCatalogWorkspace());
  const ctx = await getLatestUploadContextByMarketplace(resolvedScope);
  const uploadId = marketplace === "amazon" ? ctx.amazon?.id : ctx.flipkart?.id;
  if (!uploadId) return new Set();

  const codes = new Set<string>();
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("computed_metrics")
      .select("product_code")
      .eq("marketplace", marketplace)
      .eq("upload_id", uploadId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(getErrorMessage(error));
    const batch = data ?? [];
    for (const row of batch) {
      const code = String((row as { product_code: string }).product_code ?? "")
        .trim()
        .toUpperCase();
      if (code) codes.add(code);
    }
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return codes;
}

/** True when the latest workspace sellout upload includes this listing code. */
export async function listingInLatestSelloutUpload(
  marketplace: Marketplace,
  productCode: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<boolean> {
  const normalized = normalizeMarketplaceProductCode(marketplace, productCode);
  if (!normalized) return false;
  const codes = await getLatestSelloutProductCodeSet(marketplace, catalogWorkspace);
  const key =
    marketplace === "flipkart" ? normalized.toUpperCase() : normalized;
  return codes.has(key);
}

/**
 * Pick Amazon vs Flipkart for sellout navigation — prefers the channel that has a
 * completed sellout upload for this workspace (not “has ASIN in HO stock”).
 */
export async function resolveSelloutMarketplaceForListing(
  row: { asin?: string | null; fsn?: string | null },
  catalogWorkspace: CatalogWorkspace,
  options?: { queryHint?: string; preferred?: Marketplace },
): Promise<Marketplace> {
  const ctx = await getLatestUploadContextByMarketplace(catalogWorkspace);
  const amazonLive = Boolean(ctx.amazon?.id);
  const flipkartLive = Boolean(ctx.flipkart?.id);

  const asin = row.asin?.trim().toUpperCase() ?? "";
  const fsn = row.fsn?.trim().toUpperCase() ?? "";
  const hint = options?.queryHint?.trim() ?? "";
  const hintUpper = hint.toUpperCase();

  if (/^B0[A-Z0-9]{8}$/i.test(hint) && asin && hintUpper === asin) return "amazon";
  if (looksLikeProductSku(hint) && !/^B0/i.test(hint) && fsn && hintUpper === fsn) {
    return "flipkart";
  }

  const [amazonCodes, flipkartCodes] = await Promise.all([
    amazonLive && asin
      ? getLatestSelloutProductCodeSet("amazon", catalogWorkspace)
      : Promise.resolve(new Set<string>()),
    flipkartLive && fsn
      ? getLatestSelloutProductCodeSet("flipkart", catalogWorkspace)
      : Promise.resolve(new Set<string>()),
  ]);

  const inAmazon = Boolean(asin && amazonCodes.has(asin));
  const inFlipkart = Boolean(fsn && flipkartCodes.has(fsn));

  if (inFlipkart && !inAmazon) return "flipkart";
  if (inAmazon && !inFlipkart) return "amazon";

  if (options?.preferred === "amazon" && inAmazon) return "amazon";
  if (options?.preferred === "flipkart" && inFlipkart) return "flipkart";

  if (inFlipkart && inAmazon) {
    if (flipkartLive && !amazonLive) return "flipkart";
    if (amazonLive && !flipkartLive) return "amazon";
    return options?.preferred ?? "amazon";
  }

  if (flipkartLive && fsn && !amazonLive) return "flipkart";
  if (amazonLive && asin && !flipkartLive) return "amazon";
  if (fsn && !asin) return "flipkart";
  if (asin && !fsn) return "amazon";
  return "amazon";
}

export function selloutBundleHasChartData(bundle: {
  latestMetric: ComputedMetric | null;
  monthlyRows: DailySale[];
}): boolean {
  if (bundle.monthlyRows.length > 0) return true;
  const m = bundle.latestMetric;
  if (!m) return false;
  return (
    Boolean(m.as_of_date?.trim()) ||
    Number(m.may_mtd_units ?? 0) > 0 ||
    Number(m.apr_so_units ?? 0) > 0 ||
    Number(m.prior_fy_so_units ?? 0) > 0 ||
    Number(m.inventory_units ?? 0) > 0 ||
    Number(m.total_so_units ?? 0) > 0
  );
}

/** When the requested channel has no sellout upload data, return the sibling channel that does. */
export async function resolveSelloutRedirectForListing(
  marketplace: Marketplace,
  productCode: string,
  catalogWorkspace: CatalogWorkspace,
): Promise<{
  marketplace: Marketplace;
  productCode: string;
  erpProductId: string | null;
} | null> {
  const normalized = normalizeMarketplaceProductCode(marketplace, productCode);
  if (!normalized) return null;

  const primary = await loadProductSelloutContext(
    marketplace,
    normalized,
    catalogWorkspace,
  );
  if (selloutBundleHasChartData(primary)) return null;

  const peers = await getPeersForSelloutChannel(
    marketplace,
    normalized,
    primary.product?.product_name,
    catalogWorkspace,
  );
  const alt: Marketplace = marketplace === "amazon" ? "flipkart" : "amazon";
  const altCode =
    alt === "flipkart" ? peers.flipkart?.product_code : peers.amazon?.product_code;
  if (!altCode) return null;

  const altNorm = normalizeMarketplaceProductCode(alt, altCode);
  const secondary = await loadProductSelloutContext(alt, altNorm, catalogWorkspace);
  if (!selloutBundleHasChartData(secondary)) return null;

  return {
    marketplace: alt,
    productCode: altNorm,
    erpProductId: peers.erpProductId,
  };
}

/** All SKUs in product_master for this marketplace & tracked sub-category. */
export function productMatchesSubCategoryForWorkspace(
  subCategory: string,
  row: Pick<ProductMaster, "product_code" | "sub_category" | "category" | "product_name">,
  marketplace: Marketplace,
  catalogWorkspace: CatalogWorkspace,
): boolean {
  if (catalogWorkspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) {
    if (marketplace !== "amazon" && marketplace !== "flipkart") return false;
    return productMatchesKaranCategoryRollup(
      subCategory as KaranSubCategory,
      row,
      marketplace,
    );
  }
  if (catalogWorkspace === CATALOG_WORKSPACE_PRAVIN) {
    return productMatchesPravinCategoryRollup(subCategory, row);
  }
  if (catalogWorkspace === CATALOG_WORKSPACE_RITHIKA) {
    if (marketplace !== "amazon" && marketplace !== "flipkart") return false;
    return productMatchesRithikaCategoryRollup(subCategory, row, marketplace);
  }
  if (catalogWorkspace === CATALOG_WORKSPACE_HOME_AUDIO) {
    return productMatchesRishabhCategoryRollup(subCategory, row);
  }
  return productMatchesCategoryRollup(subCategory as SubCategory, row);
}

export async function getProductCodesForSubCategory(
  marketplace: Marketplace,
  subCategory: SubCategory | KaranSubCategory,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("product_master")
    .select("product_code, sub_category, category, product_name, catalog_workspace")
    .eq("marketplace", marketplace);
  if (error) throw new Error(getErrorMessage(error));
  return ((data ?? []) as Pick<
    ProductMaster,
    "product_code" | "sub_category" | "category" | "product_name"
  >[])
    .filter(
      (row) =>
        productMasterBelongsToWorkspace(
          row as Pick<ProductMaster, "catalog_workspace">,
          catalogWorkspace,
        ) &&
        productMatchesSubCategoryForWorkspace(subCategory, row, marketplace, catalogWorkspace),
    )
    .map((row) => row.product_code);
}

/**
 * SKUs whose **Event SO** (`daily_sales`) history rolls into category FY / MoM / YoY charts.
 * Extends {@link getProductCodesForSubCategory} with:
 * - **Flipkart EOL models** (`flipkart_eol_models`): any `product_master` row on this marketplace whose
 *   normalized model name matches a persisted EOL key and still passes the same category rules.
 * - **Amazon hardcoded EOL ASINs** (monitor / monitor_arm / projector only): ingest skips them, but
 *   prior months may still exist in `daily_sales` and belong in prior‑FY category totals.
 */
export async function getProductCodesForCategoryHistoryRollup(
  marketplace: Marketplace,
  subCategory: WorkspaceSubCategory,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
): Promise<string[]> {
  const base = await getProductCodesForSubCategory(
    marketplace,
    subCategory as SubCategory | KaranSubCategory,
    catalogWorkspace,
  );
  const codes = new Set(base.map((c) => c.trim()));

  const eolNames = await getFlipkartEolModelNames();
  if (eolNames.size > 0) {
    const { data, error } = await supabase
      .from("product_master")
      .select("product_code, product_name, category, sub_category, catalog_workspace")
      .eq("marketplace", marketplace);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of (data ?? []) as Pick<
      ProductMaster,
      "product_code" | "product_name" | "category" | "sub_category" | "catalog_workspace"
    >[]) {
      if (!productMasterBelongsToWorkspace(row, catalogWorkspace)) continue;
      if (!productMatchesSubCategoryForWorkspace(subCategory, row, marketplace, catalogWorkspace)) {
        continue;
      }
      const nm = normalizeKey(row.product_name ?? "");
      if (nm && eolNames.has(nm)) {
        codes.add(String(row.product_code).trim());
      }
    }
  }

  if (
    catalogWorkspace === CATALOG_WORKSPACE_MONITOR &&
    marketplace === "amazon" &&
    (subCategory === "monitor" || subCategory === "monitor_arm" || subCategory === "projector")
  ) {
    const eolAsins = listAmazonHardcodedEolAsins();
    if (eolAsins.length > 0) {
      const { data: eolRows, error: eolErr } = await supabase
        .from("product_master")
        .select("product_code, product_name, category, sub_category")
        .eq("marketplace", "amazon")
        .in("product_code", [...eolAsins]);
      if (eolErr) throw new Error(getErrorMessage(eolErr));
      const byCode = new Map(
        (eolRows ?? []).map((row) => [
          String(row.product_code).trim().toUpperCase(),
          row as Pick<
            ProductMaster,
            "product_code" | "product_name" | "category" | "sub_category"
          >,
        ]),
      );
      for (const asin of eolAsins) {
        const key = asin.trim().toUpperCase();
        const row = byCode.get(key);
        if (
          row &&
          productMatchesSubCategoryForWorkspace(subCategory, row, marketplace, catalogWorkspace)
        ) {
          codes.add(key);
        }
      }
    }
  }

  return [...codes];
}

export function productMatchesCategoryAnalysisSelection(
  category: string,
  subCategory: string,
  row: {
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
  },
  opts: { catalogWorkspace: CatalogWorkspace; dataScope: DataScope },
): boolean {
  if (opts.dataScope === "dawg") {
    return productMatchesDawgCategoryAnalysis(category, subCategory, row);
  }

  if (opts.catalogWorkspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) {
    if (!productMatchesKaranDashboardScope(row)) return false;
    if (isAnalysisCategoryAll(category)) {
      if (isAnalysisSubCategoryAll(subCategory)) return true;
      return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
    }
    if (normalizeKey(row.category ?? "") !== normalizeKey(category)) return false;
    if (isAnalysisSubCategoryAll(subCategory)) return true;
    return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
  }

  if (opts.catalogWorkspace === CATALOG_WORKSPACE_HOME_AUDIO) {
    if (
      !productMatchesRishabhDashboardScopeForMarketplace(row, "amazon") &&
      !productMatchesRishabhDashboardScopeForMarketplace(row, "flipkart")
    ) {
      return false;
    }
    if (isAnalysisCategoryAll(category)) {
      if (isAnalysisSubCategoryAll(subCategory)) return true;
      return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
    }
    if (normalizeKey(row.category ?? "") !== normalizeKey(category)) return false;
    if (isAnalysisSubCategoryAll(subCategory)) return true;
    return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
  }

  if (opts.catalogWorkspace === CATALOG_WORKSPACE_PRAVIN) {
    if (!productMatchesPravinDashboardScope(row)) return false;
    if (isAnalysisCategoryAll(category)) {
      if (isAnalysisSubCategoryAll(subCategory)) return true;
      return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
    }
    if (
      !productMatchesPravinTopCategory(category, {
        category: row.category ?? null,
        sub_category: row.sub_category ?? null,
        product_name: row.product_name ?? null,
      })
    ) {
      return false;
    }
    if (isAnalysisSubCategoryAll(subCategory)) return true;
    return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
  }

  if (
    !productMatchesMarketplaceDashboardScope({
      category: row.category ?? null,
      sub_category: row.sub_category ?? null,
      product_name: row.product_name ?? null,
    })
  ) {
    return false;
  }

  const rollupRow = {
    category: row.category ?? null,
    sub_category: row.sub_category ?? null,
    product_name: row.product_name ?? null,
  };

  if (isAnalysisCategoryAll(category)) {
    if (isAnalysisSubCategoryAll(subCategory)) return true;
    if (TRACKED_SUB_CATEGORIES.includes(subCategory as SubCategory)) {
      return productMatchesCategoryRollup(subCategory as SubCategory, rollupRow);
    }
    return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
  }

  if (normalizeKey(row.category ?? "") !== normalizeKey(category)) return false;
  if (isAnalysisSubCategoryAll(subCategory)) return true;
  if (TRACKED_SUB_CATEGORIES.includes(subCategory as SubCategory)) {
    return productMatchesCategoryRollup(subCategory as SubCategory, rollupRow);
  }
  return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
}

function selloutCodeOnUpload(
  code: string,
  allowed: Set<string>,
): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;
  return allowed.has(trimmed) || allowed.has(trimmed.toUpperCase());
}

/** SKUs on the latest sellout upload for category + sub-category selection. */
export async function getProductCodesForCategoryAnalysis(
  marketplace: Marketplace,
  category: string,
  subCategory: string,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
  dataScope: DataScope = getActiveDataScope(),
): Promise<string[]> {
  const uploadScope: UploadContextScope =
    dataScope === "dawg" ? "dawg" : catalogWorkspace;
  const allowed = await getLatestSelloutProductCodeSet(marketplace, uploadScope);
  const requireLatestUploadCode = !isManagerCatalogWorkspace(catalogWorkspace);
  if (requireLatestUploadCode && allowed.size === 0) return [];

  const { data, error } = await supabase
    .from("product_master")
    .select("product_code, sub_category, category, product_name, catalog_workspace")
    .eq("marketplace", marketplace);
  if (error) throw new Error(getErrorMessage(error));

  const opts = { catalogWorkspace, dataScope };
  const rows = ((data ?? []) as Pick<
    ProductMaster,
    "product_code" | "sub_category" | "category" | "product_name" | "catalog_workspace"
  >[])
    .filter((row) => {
      if (
        dataScope !== "dawg" &&
        !isManagerCatalogWorkspace(catalogWorkspace) &&
        !productMasterBelongsToWorkspace(row, catalogWorkspace)
      ) {
        return false;
      }
      const code = String(row.product_code ?? "").trim();
      if (requireLatestUploadCode && !selloutCodeOnUpload(code, allowed)) return false;
      return productMatchesCategoryAnalysisSelection(category, subCategory, row, opts);
    })
    .map((row) => String(row.product_code).trim())
    .filter(Boolean);

  /** Avoid double counting when product_master has duplicate historical rows for same SKU. */
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const code of rows) {
    const key = normalizeMarketplaceProductCode(marketplace, code);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(code);
  }
  return unique;
}

export async function listAnalysisCategoryTree(
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
  dataScope: DataScope = getActiveDataScope(),
): Promise<AnalysisCategoryTree> {
  const uploadScope: UploadContextScope =
    dataScope === "dawg" ? "dawg" : catalogWorkspace;

  if (catalogWorkspace === CATALOG_WORKSPACE_PRAVIN) {
    const subs = await listDistinctPravinSheetSubCategories(catalogWorkspace);
    return buildPravinAnalysisCategoryTree(subs);
  }
  if (catalogWorkspace === CATALOG_WORKSPACE_HOME_AUDIO) {
    const subs = await listDistinctRishabhSheetSubCategories(catalogWorkspace);
    return {
      categories: [ANALYSIS_CATEGORY_ALL, "Home Audio"],
      subCategoriesByCategory: {
        [ANALYSIS_CATEGORY_ALL]: subs,
        "Home Audio": subs,
      },
    };
  }

  if (dataScope === "dawg") {
    const staticTree = buildDawgAnalysisCategoryTree();
    const [allowedAmazon, allowedFlipkart] = await Promise.all([
      getLatestSelloutProductCodeSet("amazon", uploadScope),
      getLatestSelloutProductCodeSet("flipkart", uploadScope),
    ]);
    const { data, error } = await supabase
      .from("product_master")
      .select("marketplace, product_code, category, sub_category, product_name");
    if (error) throw new Error(getErrorMessage(error));
    const opts = { catalogWorkspace, dataScope };
    const dynamic = treeFromProductMasterRows(
      ((data ?? []) as Array<{
        marketplace: string;
        product_code: string;
        category?: string | null;
        sub_category?: string | null;
        product_name?: string | null;
      }>).filter((row) =>
        productMatchesCategoryAnalysisSelection(
          ANALYSIS_CATEGORY_ALL,
          ANALYSIS_SUB_CATEGORY_ALL,
          row,
          opts,
        ),
      ),
      { amazon: allowedAmazon, flipkart: allowedFlipkart },
      (row) =>
        productMatchesCategoryAnalysisSelection(
          ANALYSIS_CATEGORY_ALL,
          ANALYSIS_SUB_CATEGORY_ALL,
          row,
          opts,
        ),
    );
    return mergeAnalysisCategoryTree(staticTree, dynamic);
  }
  const [allowedAmazon, allowedFlipkart] = await Promise.all([
    getLatestSelloutProductCodeSet("amazon", uploadScope),
    getLatestSelloutProductCodeSet("flipkart", uploadScope),
  ]);

  const { data, error } = await supabase
    .from("product_master")
    .select("marketplace, product_code, category, sub_category, product_name, catalog_workspace");
  if (error) throw new Error(getErrorMessage(error));

  const opts = { catalogWorkspace, dataScope };
  const rows = (data ?? []) as Array<{
    marketplace: string;
    product_code: string;
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
    catalog_workspace?: string | null;
  }>;

  return treeFromProductMasterRows(
    rows.filter((row) => {
      if (
        !isManagerCatalogWorkspace(catalogWorkspace) &&
        !productMasterBelongsToWorkspace(row, catalogWorkspace)
      ) {
        return false;
      }
      return productMatchesCategoryAnalysisSelection(
        ANALYSIS_CATEGORY_ALL,
        ANALYSIS_SUB_CATEGORY_ALL,
        row,
        opts,
      );
    }),
    { amazon: allowedAmazon, flipkart: allowedFlipkart },
    (row) =>
      productMatchesCategoryAnalysisSelection(
        ANALYSIS_CATEGORY_ALL,
        ANALYSIS_SUB_CATEGORY_ALL,
        row,
        opts,
      ),
  );
}

async function categoryRollupProductCodes(
  marketplace: Marketplace,
  category: string,
  subCategory: string,
  catalogWorkspace: CatalogWorkspace,
  dataScope: DataScope,
): Promise<string[]> {
  if (
    dataScope !== "dawg" &&
    isAnalysisCategoryAll(category) &&
    !isAnalysisSubCategoryAll(subCategory) &&
    catalogWorkspace !== CATALOG_WORKSPACE_PERSONAL_AUDIO &&
    TRACKED_SUB_CATEGORIES.includes(subCategory as SubCategory)
  ) {
    return getProductCodesForCategoryHistoryRollup(
      marketplace,
      subCategory as SubCategory,
      catalogWorkspace,
    );
  }
  return getProductCodesForCategoryAnalysis(
    marketplace,
    category,
    subCategory,
    catalogWorkspace,
    dataScope,
  );
}

/** Sum daily_sales by calendar day for many SKUs (category roll-up). */
export async function aggregateDailySalesForProductCodes(
  marketplace: Marketplace,
  codes: string[],
  syntheticProductCode: string,
  uploadId?: string | null,
): Promise<DailySale[]> {
  if (codes.length === 0) return [];

  const dateTotals = new Map<string, number>();

  for (const chunk of chunkArray(codes, 150)) {
    let query = supabase
      .from("daily_sales")
      .select("sale_date, units_sold")
      .eq("marketplace", marketplace)
      .in("product_code", chunk);
    if (uploadId) {
      query = query.eq("upload_id", uploadId);
    }
    const { data, error } = await query;
    if (error) throw new Error(getErrorMessage(error));
    for (const row of data ?? []) {
      const r = row as { sale_date: string; units_sold: unknown };
      const date = String(r.sale_date);
      const units = Number(r.units_sold ?? 0);
      dateTotals.set(date, (dateTotals.get(date) ?? 0) + units);
    }
  }

  return [...dateTotals.entries()]
    .map(([sale_date, units_sold]) => ({
      marketplace,
      product_code: syntheticProductCode,
      sale_date,
      units_sold,
    }))
    .sort((a, b) => a.sale_date.localeCompare(b.sale_date));
}

/**
 * Sums units sold per calendar day across every SKU in the category — same shape as per-product
 * daily_sales so FY / MoM math matches individual Sellout & Growth.
 */
export async function getCategoryAggregatedDailySales(
  marketplace: Marketplace,
  subCategory: SubCategory,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<DailySale[]> {
  const codes = await getProductCodesForCategoryHistoryRollup(
    marketplace,
    subCategory,
    catalogWorkspace,
  );
  const selloutMeta = await getLatestSelloutUploadMeta(marketplace, catalogWorkspace);
  return aggregateDailySalesForProductCodes(
    marketplace,
    codes,
    `category:${subCategory}`,
    selloutMeta.id,
  );
}

export async function loadCategorySelloutAnalysis(
  marketplace: Marketplace,
  subCategory: SubCategory,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<{ skuCount: number; dailySales: DailySale[] }> {
  const codes = await getProductCodesForCategoryHistoryRollup(
    marketplace,
    subCategory,
    catalogWorkspace,
  );
  const selloutMeta = await getLatestSelloutUploadMeta(marketplace, catalogWorkspace);
  const dailySales = await aggregateDailySalesForProductCodes(
    marketplace,
    codes,
    `category:${subCategory}`,
    selloutMeta.id,
  );
  return { skuCount: codes.length, dailySales };
}

/** Distinct sheet sub-categories for Rithika workspace (from product master). */
export async function listDistinctPravinSheetSubCategories(
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_PRAVIN,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("product_master")
    .select("sub_category, category, product_name")
    .eq("catalog_workspace", catalogWorkspace);
  if (error) throw new Error(getErrorMessage(error));
  const set = new Set<string>();
  for (const row of (data ?? []) as Pick<
    ProductMaster,
    "sub_category" | "category" | "product_name"
  >[]) {
    const sub = String(row.sub_category ?? "").trim();
    if (!sub) continue;
    if (
      rowPassesPravinCategoryScope(
        String(row.category ?? ""),
        sub,
        String(row.product_name ?? ""),
      )
    ) {
      set.add(sub);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function listDistinctRishabhSheetSubCategories(
  _catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_HOME_AUDIO,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("product_master")
    .select("sub_category, category, product_name")
    .eq("marketplace", "amazon");
  const flipkartRes = await supabase
    .from("product_master")
    .select("sub_category, category, product_name")
    .eq("marketplace", "flipkart");
  if (error) throw new Error(getErrorMessage(error));
  if (flipkartRes.error) throw new Error(getErrorMessage(flipkartRes.error));
  const set = new Set<string>();
  for (const row of [...(data ?? []), ...(flipkartRes.data ?? [])] as Pick<
    ProductMaster,
    "sub_category" | "category" | "product_name"
  >[]) {
    const sub = String(row.sub_category ?? "").trim();
    if (!sub) continue;
    if (
      rowPassesRishabhCategoryScope(
        String(row.category ?? ""),
        sub,
        String(row.product_name ?? ""),
      )
    ) {
      set.add(sub);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export async function listDistinctRithikaSheetSubCategories(
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_RITHIKA,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("product_master")
    .select("sub_category, category, product_name")
    .eq("catalog_workspace", catalogWorkspace);
  if (error) throw new Error(getErrorMessage(error));
  const set = new Set<string>();
  for (const row of (data ?? []) as Pick<
    ProductMaster,
    "sub_category" | "category" | "product_name"
  >[]) {
    const sub = String(row.sub_category ?? "").trim();
    if (!sub || isLegacyRithikaStoredSubCategory(sub)) continue;
    const fields = {
      category: row.category ?? null,
      sub_category: row.sub_category ?? null,
      product_name: row.product_name ?? null,
    };
    if (
      inferRithikaSubCategory(fields, "amazon") ||
      inferRithikaSubCategory(fields, "flipkart")
    ) {
      set.add(sub);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * Category analysis: sum each master **month column** (Apr-25, May-25, …) for all SKUs in the
 * sub-category from the latest completed upload per channel.
 */
export async function loadCategorySheetMonthlySellout(
  category: string,
  subCategory: string,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
  dataScope: DataScope = getActiveDataScope(),
): Promise<CategorySheetMonthlySellout> {
  const cat = category.trim() || ANALYSIS_CATEGORY_ALL;
  const sub = subCategory.trim() || ANALYSIS_SUB_CATEGORY_ALL;

  if (isAnalysisCategoryAll(cat) && isAnalysisSubCategoryAll(sub)) {
    if (dataScope === "dawg") {
      const parts = await Promise.all(
        ["Gaming - daWg", "Personal Audio"].map((sheetCat) =>
          loadCategorySheetMonthlySelloutForSelection(
            sheetCat,
            ANALYSIS_SUB_CATEGORY_ALL,
            catalogWorkspace,
            dataScope,
          ),
        ),
      );
      return mergeCategorySheetMonthlySellout(parts);
    }
    /**
     * IMPORTANT: compute "All categories" from one direct selection, not by summing each
     * sub-category roll-up. A SKU can appear under multiple historical sub-category labels;
     * summing per-sub-category paths double-counts those SKUs and inflates totals.
     */
    return loadCategorySheetMonthlySelloutForSelection(
      ANALYSIS_CATEGORY_ALL,
      ANALYSIS_SUB_CATEGORY_ALL,
      catalogWorkspace,
      dataScope,
    );
  }

  return loadCategorySheetMonthlySelloutForSelection(
    cat,
    sub,
    catalogWorkspace,
    dataScope,
  );
}

async function loadCategorySheetMonthlySelloutForSelection(
  category: string,
  subCategory: string,
  catalogWorkspace: CatalogWorkspace,
  dataScope: DataScope,
): Promise<CategorySheetMonthlySellout> {
  const uploadScope: UploadContextScope =
    dataScope === "dawg" ? "dawg" : catalogWorkspace;
  const uploadCtx = await getLatestUploadContextByMarketplace(uploadScope);
  const isDawgRollup = dataScope === "dawg";
  const channelsActive = {
    amazon: uploadCtx.amazon != null,
    flipkart: uploadCtx.flipkart != null,
  };

  const monthlyAmazon = new Map<string, number>();
  const monthlyFlipkart = new Map<string, number>();
  const monthlyCombined = new Map<string, number>();

  async function loadFromCategoryMonthlyTable(
    marketplace: Marketplace,
    uploadId: string,
    target: Map<string, number>,
  ): Promise<void> {
    if (isDawgRollup || isAnalysisSubCategoryAll(subCategory)) {
      return;
    }
    const { data, error } = await supabase
      .from("category_monthly_sellout")
      .select("month_ym, units_sold")
      .eq("marketplace", marketplace)
      .eq("upload_id", uploadId)
      .eq("sub_category", subCategory);
    if (error) {
      if (isMissingCategoryMonthlyTableError(error)) return;
      throw new Error(getErrorMessage(error));
    }
    for (const row of data ?? []) {
      const r = row as { month_ym: string; units_sold: unknown };
      const ym = String(r.month_ym);
      const units = Number(r.units_sold ?? 0);
      target.set(ym, units);
    }
  }

  async function sumMonthColumnsFallback(
    marketplace: Marketplace,
    codes: string[],
    uploadIds: string[],
    target: Map<string, number>,
  ) {
    if (codes.length === 0 || uploadIds.length === 0) return;
    for (const chunk of chunkArray(codes, 150)) {
      const { data, error } = await supabase
        .from("daily_sales")
        .select("sale_date, units_sold")
        .eq("marketplace", marketplace)
        .in("upload_id", uploadIds)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of data ?? []) {
        const r = row as { sale_date: string; units_sold: unknown };
        const ym = String(r.sale_date).slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(ym)) continue;
        const units = Number(r.units_sold ?? 0);
        target.set(ym, (target.get(ym) ?? 0) + units);
      }
    }
  }

  const [codesAmazon, codesFlipkart] = await Promise.all([
    channelsActive.amazon
      ? categoryRollupProductCodes(
          "amazon",
          category,
          subCategory,
          catalogWorkspace,
          dataScope,
        )
      : Promise.resolve([] as string[]),
    channelsActive.flipkart
      ? categoryRollupProductCodes(
          "flipkart",
          category,
          subCategory,
          catalogWorkspace,
          dataScope,
        )
      : Promise.resolve([] as string[]),
  ]);

  const amazonFromTable = new Map<string, number>();
  const flipkartFromTable = new Map<string, number>();
  if (!isDawgRollup) {
    await Promise.all([
      uploadCtx.amazon?.id
        ? loadFromCategoryMonthlyTable("amazon", uploadCtx.amazon.id, amazonFromTable)
        : Promise.resolve(),
      uploadCtx.flipkart?.id
        ? loadFromCategoryMonthlyTable("flipkart", uploadCtx.flipkart.id, flipkartFromTable)
        : Promise.resolve(),
    ]);
  }

  const amazonUploadIds = uploadCtx.amazon?.id
    ? [
        uploadCtx.amazon.id,
        ...(await listWorkspaceSelloutUploadIds("amazon", catalogWorkspace, 12))
          .map((u) => u.id)
          .filter((id) => id !== uploadCtx.amazon!.id),
      ]
    : [];
  const flipkartUploadIds = uploadCtx.flipkart?.id
    ? [
        uploadCtx.flipkart.id,
        ...(await listWorkspaceSelloutUploadIds("flipkart", catalogWorkspace, 12))
          .map((u) => u.id)
          .filter((id) => id !== uploadCtx.flipkart!.id),
      ]
    : [];

  const amazonFromDaily = new Map<string, number>();
  const flipkartFromDaily = new Map<string, number>();
  await Promise.all([
    sumMonthColumnsFallback("amazon", codesAmazon, amazonUploadIds, amazonFromDaily),
    sumMonthColumnsFallback("flipkart", codesFlipkart, flipkartUploadIds, flipkartFromDaily),
  ]);

  const mergedAmazon = mergeCategoryMonthlyFromTableAndDaily(
    amazonFromTable,
    amazonFromDaily,
  );
  const mergedFlipkart = mergeCategoryMonthlyFromTableAndDaily(
    flipkartFromTable,
    flipkartFromDaily,
  );
  monthlyAmazon.clear();
  monthlyFlipkart.clear();
  monthlyCombined.clear();
  for (const [ym, units] of mergedAmazon) monthlyAmazon.set(ym, units);
  for (const [ym, units] of mergedFlipkart) monthlyFlipkart.set(ym, units);
  for (const [ym, units] of rebuildMonthlyCombined(mergedAmazon, mergedFlipkart)) {
    monthlyCombined.set(ym, units);
  }

  const reportSnapshotDate = [
    channelsActive.amazon ? uploadCtx.amazon?.snapshotDate : null,
    channelsActive.flipkart ? uploadCtx.flipkart?.snapshotDate : null,
  ]
    .filter(Boolean)
    .sort((a, b) => String(b).localeCompare(String(a)))[0] ?? null;

  const previousMonthYm = reportSnapshotDate
    ? previousMonthYmFromSnapshot(reportSnapshotDate)
    : null;
  const previousMonthFromMonthly =
    previousMonthYm != null
      ? {
          monthYm: previousMonthYm,
          amazon: monthlyAmazon.get(previousMonthYm) ?? 0,
          flipkart: monthlyFlipkart.get(previousMonthYm) ?? 0,
        }
      : null;

  const [ongoingMonthMtd, previousMonthFallback, priorFySo] = await Promise.all([
    loadCategoryOngoingMonthMtd(
      category,
      subCategory,
      uploadCtx,
      channelsActive,
      catalogWorkspace,
      dataScope,
    ),
    loadCategoryPreviousMonthSo(
      category,
      subCategory,
      uploadCtx,
      channelsActive,
      catalogWorkspace,
      dataScope,
    ),
    loadCategoryPriorFySoTotals(
      category,
      subCategory,
      uploadCtx,
      channelsActive,
      catalogWorkspace,
      dataScope,
    ),
  ]);

  const previousMonthSo =
    previousMonthFromMonthly &&
    (previousMonthFromMonthly.amazon > 0 || previousMonthFromMonthly.flipkart > 0)
      ? previousMonthFromMonthly
      : previousMonthFallback;

  /**
   * Category analysis must follow sheet month columns directly:
   * per-month roll-up = Amazon month units + Flipkart month units.
   * Do not clear/reshape prior-FY months here.
   */

  return {
    skuCountAmazon: codesAmazon.length,
    skuCountFlipkart: codesFlipkart.length,
    skuCount: codesAmazon.length + codesFlipkart.length,
    channelsActive,
    monthlyAmazon,
    monthlyFlipkart,
    monthlyCombined,
    ongoingMonthMtd,
    previousMonthSo,
    priorFySoUnits: priorFySo.total,
    priorFySoUnitsAmazon: priorFySo.amazon,
    priorFySoUnitsFlipkart: priorFySo.flipkart,
    reportSnapshotDate,
  };
}

/** Sum **FY … SO** column totals from latest upload metrics (per channel). */
async function loadCategoryPriorFySoTotals(
  category: string,
  subCategory: string,
  uploadCtx: Awaited<ReturnType<typeof getLatestUploadContextByMarketplace>>,
  channelsActive: { amazon: boolean; flipkart: boolean },
  catalogWorkspace: CatalogWorkspace,
  dataScope: DataScope,
): Promise<{ total: number; amazon: number; flipkart: number }> {
  async function sumPriorFy(
    marketplace: Marketplace,
    snapshotDate: string | null,
    uploadId: string | null,
  ): Promise<number> {
    if (!snapshotDate || !uploadId) return 0;
    const codes = await categoryRollupProductCodes(
      marketplace,
      category,
      subCategory,
      catalogWorkspace,
      dataScope,
    );
    let total = 0;
    for (const chunk of chunkArray(codes, 150)) {
      if (chunk.length === 0) continue;
      const { data, error } = await supabase
        .from("computed_metrics")
        .select("prior_fy_so_units")
        .eq("marketplace", marketplace)
        .eq("as_of_date", snapshotDate)
        .eq("upload_id", uploadId)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of (data ?? []) as Pick<ComputedMetric, "prior_fy_so_units">[]) {
        total += Number(row.prior_fy_so_units ?? 0);
      }
    }
    return total;
  }

  const [amazon, flipkart] = await Promise.all([
    channelsActive.amazon
      ? sumPriorFy("amazon", uploadCtx.amazon?.snapshotDate ?? null, uploadCtx.amazon?.id ?? null)
      : Promise.resolve(0),
    channelsActive.flipkart
      ? sumPriorFy(
          "flipkart",
          uploadCtx.flipkart?.snapshotDate ?? null,
          uploadCtx.flipkart?.id ?? null,
        )
      : Promise.resolve(0),
  ]);

  return { amazon, flipkart, total: amazon + flipkart };
}

/** Sum **May MTD** (report month) from latest upload `computed_metrics` for category charts. */
async function loadCategoryOngoingMonthMtd(
  category: string,
  subCategory: string,
  uploadCtx: Awaited<ReturnType<typeof getLatestUploadContextByMarketplace>>,
  channelsActive: { amazon: boolean; flipkart: boolean },
  catalogWorkspace: CatalogWorkspace,
  dataScope: DataScope,
): Promise<CategoryOngoingMonthMtd | null> {
  async function sumMtd(
    marketplace: Marketplace,
    snapshotDate: string | null,
    uploadId: string | null,
  ): Promise<number> {
    if (!snapshotDate || !uploadId) return 0;
    const codes = await categoryRollupProductCodes(
      marketplace,
      category,
      subCategory,
      catalogWorkspace,
      dataScope,
    );
    let total = 0;
    for (const chunk of chunkArray(codes, 150)) {
      if (chunk.length === 0) continue;
      const { data, error } = await supabase
        .from("computed_metrics")
        .select("may_mtd_units")
        .eq("marketplace", marketplace)
        .eq("as_of_date", snapshotDate)
        .eq("upload_id", uploadId)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of (data ?? []) as Pick<ComputedMetric, "may_mtd_units">[]) {
        total += Number(row.may_mtd_units ?? 0);
      }
    }
    return total;
  }

  const snapshotDates = [
    channelsActive.amazon ? uploadCtx.amazon?.snapshotDate : null,
    channelsActive.flipkart ? uploadCtx.flipkart?.snapshotDate : null,
  ].filter(Boolean) as string[];
  if (snapshotDates.length === 0) return null;

  const reportSnapshot = snapshotDates.sort((a, b) => b.localeCompare(a))[0];
  const reportYm = reportSnapshot.slice(0, 7);

  const [amazon, flipkart] = await Promise.all([
    channelsActive.amazon
      ? sumMtd("amazon", uploadCtx.amazon?.snapshotDate ?? null, uploadCtx.amazon?.id ?? null)
      : Promise.resolve(0),
    channelsActive.flipkart
      ? sumMtd("flipkart", uploadCtx.flipkart?.snapshotDate ?? null, uploadCtx.flipkart?.id ?? null)
      : Promise.resolve(0),
  ]);

  if (amazon === 0 && flipkart === 0) return null;
  return { monthYm: reportYm, amazon, flipkart };
}

/** FK **Apr-25** month anchors in `category_monthly_sellout` (when KPI used 26-Apr). */
async function sumCategoryFlipkartAprilFromMonthlyTable(
  subCategory: WorkspaceSubCategory,
  uploadId: string,
  snapshotDate: string,
): Promise<number> {
  const fyStart = getCurrentFyStart(new Date(`${snapshotDate}T12:00:00`));
  let total = 0;
  for (const ym of flipkartAprilMonthCandidates(fyStart)) {
    const { data, error } = await supabase
      .from("category_monthly_sellout")
      .select("units_sold")
      .eq("marketplace", "flipkart")
      .eq("upload_id", uploadId)
      .eq("sub_category", subCategory)
      .eq("month_ym", ym);
    if (error) {
      if (isMissingCategoryMonthlyTableError(error)) return 0;
      throw new Error(getErrorMessage(error));
    }
    for (const row of (data ?? []) as Array<{ units_sold: unknown }>) {
      total += Number(row.units_sold ?? 0);
    }
  }
  return total;
}

/** Sum **Apr SO** (previous month on the master) when Event SO month columns were not stored. */
async function loadCategoryPreviousMonthSo(
  category: string,
  subCategory: string,
  uploadCtx: Awaited<ReturnType<typeof getLatestUploadContextByMarketplace>>,
  channelsActive: { amazon: boolean; flipkart: boolean },
  catalogWorkspace: CatalogWorkspace,
  dataScope: DataScope,
): Promise<CategoryPreviousMonthSo | null> {
  async function sumPreviousMonthFromDaily(
    marketplace: Marketplace,
    uploadId: string | null,
    monthYm: string,
  ): Promise<number> {
    if (!uploadId) return 0;
    const codes = await categoryRollupProductCodes(
      marketplace,
      category,
      subCategory,
      catalogWorkspace,
      dataScope,
    );
    let total = 0;
    for (const chunk of chunkArray(codes, 150)) {
      if (chunk.length === 0) continue;
      const { data, error } = await supabase
        .from("daily_sales")
        .select("sale_date, units_sold")
        .eq("marketplace", marketplace)
        .eq("upload_id", uploadId)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of data ?? []) {
        const r = row as { sale_date: string; units_sold: unknown };
        const ym = String(r.sale_date).slice(0, 7);
        if (ym !== monthYm) continue;
        total += Number(r.units_sold ?? 0);
      }
    }
    return total;
  }

  async function sumAprSo(
    marketplace: Marketplace,
    snapshotDate: string | null,
    uploadId: string | null,
  ): Promise<number> {
    if (!snapshotDate || !uploadId) return 0;
    const codes = await categoryRollupProductCodes(
      marketplace,
      category,
      subCategory,
      catalogWorkspace,
      dataScope,
    );
    let total = 0;
    for (const chunk of chunkArray(codes, 150)) {
      if (chunk.length === 0) continue;
      const { data, error } = await supabase
        .from("computed_metrics")
        .select("apr_so_units")
        .eq("marketplace", marketplace)
        .eq("as_of_date", snapshotDate)
        .eq("upload_id", uploadId)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of (data ?? []) as Pick<ComputedMetric, "apr_so_units">[]) {
        total += Number(row.apr_so_units ?? 0);
      }
    }
    return total;
  }

  const snapshotDates = [
    channelsActive.amazon ? uploadCtx.amazon?.snapshotDate : null,
    channelsActive.flipkart ? uploadCtx.flipkart?.snapshotDate : null,
  ].filter(Boolean) as string[];
  if (snapshotDates.length === 0) return null;

  const reportSnapshot = snapshotDates.sort((a, b) => b.localeCompare(a))[0];
  const monthYm = previousMonthYmFromSnapshot(reportSnapshot);

  let flipkartApr = 0;
  if (channelsActive.flipkart && uploadCtx.flipkart?.id && uploadCtx.flipkart.snapshotDate) {
    const [fromDaily, fromMetrics, fromMonthly] = await Promise.all([
      sumPreviousMonthFromDaily("flipkart", uploadCtx.flipkart.id, monthYm),
      sumAprSo(
        "flipkart",
        uploadCtx.flipkart.snapshotDate,
        uploadCtx.flipkart.id,
      ),
      sumCategoryFlipkartAprilFromMonthlyTable(
        subCategory,
        uploadCtx.flipkart.id,
        uploadCtx.flipkart.snapshotDate,
      ),
    ]);
    /**
     * Prefer sheet month-column totals (daily_sales), which are the source of truth
     * for Category analysis. Keep metrics/monthly as guardrail fallback.
     */
    flipkartApr = fromDaily > 0 ? fromDaily : Math.max(fromMetrics, fromMonthly);
  }

  const amazon = channelsActive.amazon
    ? await (async () => {
        const fromDaily = await sumPreviousMonthFromDaily(
          "amazon",
          uploadCtx.amazon?.id ?? null,
          monthYm,
        );
        if (fromDaily > 0) return fromDaily;
        return sumAprSo(
          "amazon",
          uploadCtx.amazon?.snapshotDate ?? null,
          uploadCtx.amazon?.id ?? null,
        );
      })()
    : 0;

  if (amazon === 0 && flipkartApr === 0) return null;
  return { monthYm, amazon, flipkart: flipkartApr };
}
