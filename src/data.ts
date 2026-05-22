import {
  type CategoryOngoingMonthMtd,
  type CategoryPreviousMonthSo,
  type CategorySheetMonthlySellout,
  mergeCategorySheetMonthlySellout,
  previousMonthYmFromSnapshot,
  sheetMonthSaleDateToKey,
} from "./category-sellout-insights";
import {
  buildComputedMetric,
  computeRecommendedPoUnits,
  poDrrForProjection,
} from "./metrics";
import type { DataScope } from "./types";
import { supabase } from "./supabase";
import {
  TRACKED_SUB_CATEGORIES,
  type ComputedMetric,
  type DashboardRecord,
  type DailySale,
  type Marketplace,
  type ParsedUploadPayload,
  type ProductMaster,
  type SubCategory,
  type SubCategoryFilter,
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
import { catalogProductName, looksLikeProductSku } from "./product-display";
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
import { type UploadHistoryScope, uploadRowMatchesHistoryScope } from "./tenants";
import { formatInteger, normalizeKey } from "./utils";

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
    const merged = { ...(map.get(key) ?? {}), ...row };
    const priorUploadId = map.get(key)?.upload_id;
    if (priorUploadId != null && row.upload_id == null) {
      merged.upload_id = priorUploadId;
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
  dataScope: DataScope = "default",
): Promise<void> {
  const { data: staleUploads, error: listError } = await supabase
    .from("uploads")
    .select("id")
    .eq("marketplace", marketplace)
    .eq("data_scope", dataScope)
    .neq("id", keepUploadId);
  if (listError) throw new Error(getErrorMessage(listError));

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
  dataScope = "default",
  skipPurge = false,
  deferPrune = false,
  onProgress,
}: {
  payload: ParsedUploadPayload;
  marketplace: Marketplace;
  fileName: string;
  uploadedBy: string;
  snapshotDate: string;
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
  const insertResponse = await supabase
    .from("uploads")
    .insert({
      marketplace,
      file_name: fileName,
      uploaded_by: uploadedBy,
      snapshot_date: snapshotDate,
      status: "processing",
      upload_kind: "sellout",
      data_scope: dataScope,
      raw_row_count: payload.rawCount,
      valid_row_count: payload.validCount,
      rejected_row_count: payload.errors.length + payload.ignoredCount,
      notes: null,
    })
    .select("*")
    .single();
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

    const usePostUploadCleanup = payload.dailySales.length > 0;
    if (!skipPurge) {
      if (!usePostUploadCleanup) {
        await purgeMarketplaceSelloutHistory(marketplace);
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
      })),
    );

    const metrics: ComputedMetric[] = payload.metricInputs.map((input) =>
      buildComputedMetric({ ...input, upload_id: uploadId }),
    );

    if (products.length) {
      await upsertInBatches(
        "product_master",
        products,
        "marketplace,product_code",
      );
    }

    if (metrics.length) {
      await upsertInBatches(
        "computed_metrics",
        metrics,
        "marketplace,product_code,as_of_date",
      );
    }

    if (payload.dailySales.length) {
      await assertUploadRecordExists(uploadId);
      const dailySalesWithUpload = payload.dailySales.map((row) => ({
        ...row,
        upload_id: uploadId,
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
    const { error: completedError } = await supabase
      .from("uploads")
      .update({
        status: "completed",
        notes: buildSelloutUploadNotes(payload),
      })
      .eq("id", uploadId);
    console.log(
      `[upload] finalize uploads row: ${(performance.now() - finalizeStart).toFixed(0)}ms`,
    );

    if (completedError) throw new Error(getErrorMessage(completedError));

    if (usePostUploadCleanup) {
      onProgress?.({ message: "Removing rows from previous uploads…" });
      await pruneStaleSelloutDataForMarketplace(marketplace, uploadId, dataScope);
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
  "marketplace, product_code, as_of_date, upload_id, inventory_units, total_so_units, may_mtd_units, apr_so_units, prior_fy_so_units, drr_units, drr_28d_avg_units, doc_days";

const DASHBOARD_PRODUCT_COLUMNS =
  "product_code, product_name, category, sub_category, brand, image_url, listing_code";

export async function getDashboardRecords(
  marketplace: Marketplace,
): Promise<DashboardRecord[]> {
  const [flipkartEolModelNames, selloutMeta] = await Promise.all([
    marketplace === "amazon" || marketplace === "flipkart"
      ? getFlipkartEolModelNames()
      : Promise.resolve(new Set<string>()),
    getLatestSelloutUploadMeta(marketplace),
  ]);

  let metricsQuery = supabase
    .from("computed_metrics")
    .select(DASHBOARD_METRIC_COLUMNS)
    .eq("marketplace", marketplace);
  if (selloutMeta.id) {
    metricsQuery = metricsQuery.eq("upload_id", selloutMeta.id);
  } else {
    metricsQuery = metricsQuery.order("as_of_date", { ascending: false });
  }
  const { data: metricsRows, error: metricsError } = await metricsQuery;
  if (metricsError) throw new Error(getErrorMessage(metricsError));

  const latestByCode = new Map<string, ComputedMetric>();
  (metricsRows as ComputedMetric[]).forEach((metric) => {
    if (!latestByCode.has(metric.product_code)) {
      latestByCode.set(metric.product_code, metric);
    }
  });

  const metricCodes = [...latestByCode.keys()];
  const productRows: ProductMaster[] = [];

  for (const codeChunk of chunkArray(metricCodes, 150)) {
    const { data, error: productError } = await supabase
      .from("product_master")
      .select(DASHBOARD_PRODUCT_COLUMNS)
      .eq("marketplace", marketplace)
      .in("product_code", codeChunk);
    if (productError) throw new Error(getErrorMessage(productError));
    productRows.push(...((data ?? []) as ProductMaster[]));
  }

  const { data: scopedExtras, error: scopedError } = await supabase
    .from("product_master")
    .select(DASHBOARD_PRODUCT_COLUMNS)
    .eq("marketplace", marketplace)
    .or(
      "category.ilike.%cartridge%,category.ilike.%monitor%,category.ilike.%projector%",
    );
  if (scopedError) throw new Error(getErrorMessage(scopedError));
  for (const row of (scopedExtras ?? []) as ProductMaster[]) {
    if (!productMatchesMarketplaceDashboardScope(row)) continue;
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
  for (const product of productRows as ProductMaster[]) {
    if (productMatchesMarketplaceDashboardScope(product)) {
      dashboardCodes.add(product.product_code);
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
      return {
        ...metric,
        purchase_order_units: computedPo,
        product_name: product?.product_name ?? "",
        category: product?.category ?? null,
        sub_category: product?.sub_category ?? null,
        brand: product?.brand ?? null,
        image_url: product?.image_url ?? null,
        listing_code: product?.listing_code ?? null,
      };
    })
    .filter((row) =>
      !isExcludedFromActiveDashboard(
        marketplace,
        row.product_code,
        row.product_name,
        flipkartEolModelNames,
      ),
    )
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

  const ctx = await getLatestUploadContextByMarketplace();
  const channel =
    marketplace === "amazon" ? ctx.amazon : marketplace === "flipkart" ? ctx.flipkart : null;
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
  marketplace: Marketplace,
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

  const { data, error } = await supabase
    .from("computed_metrics")
    .select("upload_id, as_of_date")
    .eq("marketplace", marketplace)
    .not("upload_id", "is", null)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(getErrorMessage(error));

  const metricRow = data as { upload_id?: string | null; as_of_date?: string } | null;
  const uploadId = meta.id ?? (metricRow?.upload_id?.trim() || null);
  if (uploadId && !notesLatestDay) {
    const { data: uploadRow, error: uploadErr } = await supabase
      .from("uploads")
      .select("notes")
      .eq("id", uploadId)
      .maybeSingle();
    if (uploadErr) throw new Error(getErrorMessage(uploadErr));
    notesLatestDay = parseLatestDaySelloutFromUploadNotes(
      (uploadRow as { notes?: string | null } | null)?.notes,
    );
  }

  return {
    id: uploadId,
    snapshotDate:
      meta.snapshotDate ??
      snapshotFromRows ??
      (metricRow?.as_of_date?.trim() || null),
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
): Promise<LatestSheetColumnSelloutSummary> {
  if (lookupRows.length === 0) {
    return { saleDate: null, totalUnits: 0 };
  }

  const meta = await enrichLatestSelloutUploadMeta(
    marketplace,
    await getLatestSelloutUploadMeta(marketplace),
    lookupRows,
  );
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
  if (kind === "sellout") return `sellout:${row.marketplace}`;
  return kind;
}

async function fetchUploadRowsForBucket(
  bucket: { kind: UploadKind; marketplace?: Marketplace },
  dataScope: DataScope = "default",
): Promise<UploadRowForBucket[]> {
  const select = "id, marketplace, upload_kind, notes, uploaded_at";

  if (bucket.kind === "sellout" && bucket.marketplace) {
    const withKind = await supabase
      .from("uploads")
      .select(select)
      .eq("marketplace", bucket.marketplace)
      .eq("data_scope", dataScope)
      .eq("upload_kind", "sellout")
      .order("uploaded_at", { ascending: false })
      .limit(80);

    if (!withKind.error) return (withKind.data ?? []) as UploadRowForBucket[];

    if (!isMissingUploadKindColumn(withKind.error)) {
      throw new Error(getErrorMessage(withKind.error));
    }

    const fallback = await supabase
      .from("uploads")
      .select(select)
      .eq("marketplace", bucket.marketplace)
      .eq("data_scope", dataScope)
      .order("uploaded_at", { ascending: false })
      .limit(80);
    if (fallback.error) throw new Error(getErrorMessage(fallback.error));
    return ((fallback.data ?? []) as UploadRowForBucket[]).filter(isSelloutUploadRow);
  }

  const withKind = await supabase
    .from("uploads")
    .select(select)
    .eq("data_scope", dataScope)
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
    .select("id, marketplace, upload_kind, notes, data_scope")
    .eq("id", keepUploadId)
    .maybeSingle();
  if (keepErr) throw new Error(getErrorMessage(keepErr));
  if (!keep) return 0;

  const bucketKey = uploadHistoryBucketKey(keep as UploadRowForBucket);
  const kind = resolveUploadKind(keep);
  const marketplace =
    kind === "sellout" ? (keep.marketplace as Marketplace) : undefined;
  const dataScope =
    (keep as { data_scope?: DataScope }).data_scope === "dawg" ? "dawg" : "default";

  const rows = await fetchUploadRowsForBucket({ kind, marketplace }, dataScope);
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

export async function getUploadHistory(
  scope?: UploadHistoryScope,
  dataScope: DataScope = "default",
) {
  const { data, error } = await supabase
    .from("uploads")
    .select("*")
    .eq("data_scope", dataScope)
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
  if (kind === "bau" || kind === "gms_plan") return false;
  if (kind === "sellout") return true;
  const notes = String(row.notes ?? "").toLowerCase();
  return !notes.includes("bau") && !notes.includes("gms plan");
}

/** Latest completed sellout upload per marketplace (id + sheet as-on date). */
export async function getLatestUploadContextByMarketplace(
  dataScope: DataScope = "default",
): Promise<{
  amazon: LatestUploadContext | null;
  flipkart: LatestUploadContext | null;
}> {
  async function fetchOne(marketplace: Marketplace): Promise<LatestUploadContext | null> {
    const baseQuery = () =>
      supabase
        .from("uploads")
        .select("id, snapshot_date, upload_kind, notes")
        .eq("marketplace", marketplace)
        .eq("data_scope", dataScope)
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
      const fallback = await supabase
        .from("uploads")
        .select("id, snapshot_date, notes")
        .eq("marketplace", marketplace)
        .eq("data_scope", dataScope)
        .eq("status", "completed")
        .not("snapshot_date", "is", null)
        .order("uploaded_at", { ascending: false })
        .limit(12);
      if (fallback.error) throw new Error(getErrorMessage(fallback.error));
      rows = (fallback.data ?? []) as typeof rows;
    } else {
      rows = (withKind.data ?? []) as typeof rows;
    }

    const pick = rows.find(isSelloutUploadRow) ?? rows[0];
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

/** Latest sheet coverage date per channel from the most recent upload that stored `snapshot_date`. */
export async function getLatestUploadSheetCoverageByMarketplace(): Promise<{
  amazon: string | null;
  flipkart: string | null;
}> {
  const ctx = await getLatestUploadContextByMarketplace();
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

export async function getProductMaster(marketplace: Marketplace) {
  const { data, error } = await supabase
    .from("product_master")
    .select("*")
    .eq("marketplace", marketplace)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(getErrorMessage(error));
  return data as ProductMaster[];
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

  product = withFlipkartDisplayName(product);

  const { data: metricsRows, error: metricsError } = await supabase
    .from("computed_metrics")
    .select("*")
    .eq("marketplace", marketplace)
    .eq("product_code", product.product_code)
    .order("as_of_date", { ascending: false })
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

/** One row per ERP product ID (Amazon + Flipkart merged). */
export async function searchUnifiedProducts(
  lookupText: string,
): Promise<UnifiedProductSuggestion[]> {
  const trimmed = lookupText.trim();
  if (trimmed.length < 2) return [];

  const idMap = await loadProductIdMap();
  const byKey = new Map<string, UnifiedProductSuggestion>();

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

  if (idMap) {
    for (const entry of searchProductIdMap(idMap, trimmed, 15)) {
      upsert({
        key: `pid:${entry.erpProductId}`,
        erpProductId: entry.erpProductId,
        modelName: entry.modelName || entry.asin || pickFlipkartFsn(entry.fsns) || entry.erpProductId,
        asin: entry.asin || null,
        fsn: pickFlipkartFsn(entry.fsns),
        subtitle: "",
      });
    }
  }

  const [amazon, flipkart] = await Promise.all([
    searchProductSuggestions("amazon", trimmed),
    searchProductSuggestions("flipkart", trimmed),
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

export async function findUnifiedProduct(
  lookupText: string,
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

  if (idMap && /^B0[A-Z0-9]{8}$/i.test(trimmed)) {
    const pid = lookupErpProductId(idMap, "amazon", trimmed);
    if (pid) {
      const entry = lookupCodesByErpProductId(idMap, pid);
      if (entry) {
        return {
          key: `pid:${entry.erpProductId}`,
          erpProductId: entry.erpProductId,
          modelName: entry.modelName || entry.asin || entry.erpProductId,
          asin: entry.asin || null,
          fsn: pickFlipkartFsn(entry.fsns),
          subtitle: "",
        };
      }
    }
  }

  if (idMap && looksLikeProductSku(trimmed) && !/^B0/i.test(trimmed)) {
    const pid = lookupErpProductId(idMap, "flipkart", trimmed);
    if (pid) {
      const entry = lookupCodesByErpProductId(idMap, pid);
      if (entry) {
        return {
          key: `pid:${entry.erpProductId}`,
          erpProductId: entry.erpProductId,
          modelName: entry.modelName || pickFlipkartFsn(entry.fsns) || entry.erpProductId,
          asin: entry.asin || null,
          fsn: pickFlipkartFsn(entry.fsns),
          subtitle: "",
        };
      }
    }
  }

  const suggestions = await searchUnifiedProducts(trimmed);
  const norm = trimmed.toLowerCase();
  const exact = suggestions.find(
    (row) =>
      row.modelName.toLowerCase() === norm ||
      row.asin?.toLowerCase() === norm ||
      row.fsn?.toLowerCase() === norm ||
      row.erpProductId === trimmed,
  );
  return exact ?? suggestions[0] ?? null;
}

export async function resolveErpProductIdFromListing(
  marketplace: Marketplace,
  productCode: string,
): Promise<string | null> {
  return resolveErpProductIdForListing(marketplace, productCode);
}

export async function resolveProductContextByErpId(
  erpProductId: string,
): Promise<ProductContext | null> {
  const idMap = await loadProductIdMap();
  if (!idMap) return null;
  const entry = lookupCodesByErpProductId(idMap, erpProductId);
  if (!entry) return null;

  const flipkartCode = pickFlipkartFsn(entry.fsns);
  const [amazon, flipkart] = await Promise.all([
    entry.asin ? getProductByCode("amazon", entry.asin) : null,
    flipkartCode ? getProductByCode("flipkart", flipkartCode) : null,
  ]);

  const defaultMarketplace: Marketplace = amazon ? "amazon" : "flipkart";
  const modelName =
    entry.modelName ||
    catalogProductName(amazon?.product_name, amazon?.product_code) ||
    catalogProductName(flipkart?.product_name, flipkart?.product_code) ||
    erpProductId;

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
          entry.asin ? getProductByCode("amazon", entry.asin) : null,
          flipkartCode ? getProductByCode("flipkart", flipkartCode) : null,
        ]);

        if (marketplace === "amazon") {
          const current = await getProductByCode("amazon", code);
          return {
            amazon: current ?? amazonRow,
            flipkart: flipkartRow,
            erpProductId: entry.erpProductId,
          };
        }
        const current = await getProductByCode("flipkart", code);
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
    const current = code ? await getProductByCode(marketplace, code) : null;
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
    const current = await getProductByCode("amazon", code);
    return { amazon: current ?? amazon, flipkart, erpProductId: null };
  }
  if (marketplace === "flipkart" && code) {
    const current = await getProductByCode("flipkart", code);
    return { amazon, flipkart: current ?? flipkart, erpProductId: null };
  }

  return { amazon, flipkart, erpProductId: null };
}

export async function getProductByCode(
  marketplace: Marketplace,
  productCode: string,
): Promise<ProductMaster | null> {
  const normalized = productCode.trim();
  if (!normalized) return null;
  const { data, error } = await supabase
    .from("product_master")
    .select("*")
    .eq("marketplace", marketplace)
    .eq("product_code", normalized)
    .maybeSingle();
  if (error) throw new Error(getErrorMessage(error));
  return (data ?? null) as ProductMaster | null;
}

export async function getLatestMetricForProduct(
  marketplace: Marketplace,
  productCode: string,
): Promise<ComputedMetric | null> {
  const normalized = productCode.trim();
  if (!normalized) return null;
  const { data, error } = await supabase
    .from("computed_metrics")
    .select("*")
    .eq("marketplace", marketplace)
    .eq("product_code", normalized)
    .order("as_of_date", { ascending: false })
    .limit(1);
  if (error) throw new Error(getErrorMessage(error));
  return ((data ?? [])[0] ?? null) as ComputedMetric | null;
}

export async function searchProductSuggestions(
  marketplace: Marketplace,
  lookupText: string,
): Promise<Array<{ productCode: string; productName: string }>> {
  const normalized = lookupText.trim();
  if (normalized.length < 2) return [];

  const codeFilter =
    marketplace === "flipkart" ? normalized.toUpperCase() : normalized;

  const { data, error } = await supabase
    .from("product_master")
    .select("product_code, product_name")
    .eq("marketplace", marketplace)
    .or(`product_code.ilike.%${codeFilter}%,product_name.ilike.%${normalized}%`)
    .order("updated_at", { ascending: false })
    .limit(10);
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

  for (const row of (data ?? []) as Array<{ product_code: string; product_name: string }>) {
    pushRow(row.product_code, row.product_name);
  }

  if (marketplace === "flipkart" && results.length < 10) {
    const catalogHits = findFlipkartFsnsByModelQuery(normalized, 20);
    const missingFsns = catalogHits
      .map((h) => h.fsn)
      .filter((fsn) => !seen.has(fsn));
    if (missingFsns.length > 0) {
      const { data: catalogRows, error: catErr } = await supabase
        .from("product_master")
        .select("product_code, product_name")
        .eq("marketplace", "flipkart")
        .in("product_code", missingFsns.slice(0, 30));
      if (catErr) throw new Error(getErrorMessage(catErr));
      const nameByFsn = new Map(catalogHits.map((h) => [h.fsn, h.modelName]));
      for (const row of (catalogRows ?? []) as Array<{
        product_code: string;
        product_name: string;
      }>) {
        pushRow(
          row.product_code,
          nameByFsn.get(row.product_code.toUpperCase()) ?? row.product_name,
        );
      }
    }
  }

  return results.slice(0, 10);
}

export async function getProductSelloutHistory(
  marketplace: Marketplace,
  productCode: string,
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

  const { data: history, error: historyError } = await supabase
    .from("computed_metrics")
    .select("*")
    .eq("marketplace", marketplace)
    .eq("product_code", normalized)
    .order("as_of_date", { ascending: true });
  if (historyError) throw new Error(getErrorMessage(historyError));

  return {
    product: (product ?? null) as ProductMaster | null,
    history: (history ?? []) as ComputedMetric[],
  };
}

export async function getProductMonthlySellout(
  marketplace: Marketplace,
  productCode: string,
): Promise<DailySale[]> {
  const normalized = productCode.trim();
  if (!normalized) return [];
  const { data, error } = await supabase
    .from("daily_sales")
    .select("marketplace, product_code, sale_date, units_sold")
    .eq("marketplace", marketplace)
    .eq("product_code", normalized)
    .order("sale_date", { ascending: true });
  if (error) throw new Error(getErrorMessage(error));
  return (data ?? []) as DailySale[];
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
export async function getLatestSelloutProductCodeSet(
  marketplace: Marketplace,
): Promise<Set<string>> {
  const ctx = await getLatestUploadContextByMarketplace();
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

/** All SKUs in product_master for this marketplace & tracked sub-category. */
export async function getProductCodesForSubCategory(
  marketplace: Marketplace,
  subCategory: SubCategory,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("product_master")
    .select("product_code, sub_category, category")
    .eq("marketplace", marketplace);
  if (error) throw new Error(getErrorMessage(error));
  return ((data ?? []) as Pick<ProductMaster, "product_code" | "sub_category" | "category">[])
    .filter((row) => productMatchesCategoryRollup(subCategory, row))
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
  subCategory: SubCategory,
): Promise<string[]> {
  const base = await getProductCodesForSubCategory(marketplace, subCategory);
  const codes = new Set(base.map((c) => c.trim()));

  const eolNames = await getFlipkartEolModelNames();
  if (eolNames.size > 0) {
    const { data, error } = await supabase
      .from("product_master")
      .select("product_code, product_name, category, sub_category")
      .eq("marketplace", marketplace);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of (data ?? []) as Pick<
      ProductMaster,
      "product_code" | "product_name" | "category" | "sub_category"
    >[]) {
      if (!productMatchesCategoryRollup(subCategory, row)) continue;
      const nm = normalizeKey(row.product_name ?? "");
      if (nm && eolNames.has(nm)) {
        codes.add(String(row.product_code).trim());
      }
    }
  }

  if (
    marketplace === "amazon" &&
    (subCategory === "monitor" || subCategory === "monitor_arm" || subCategory === "projector")
  ) {
    const eolAsins = listAmazonHardcodedEolAsins();
    if (eolAsins.length > 0) {
      const { data: eolRows, error: eolErr } = await supabase
        .from("product_master")
        .select("product_code, category, sub_category")
        .eq("marketplace", "amazon")
        .in("product_code", [...eolAsins]);
      if (eolErr) throw new Error(getErrorMessage(eolErr));
      const byCode = new Map(
        (eolRows ?? []).map((row) => [
          String(row.product_code).trim().toUpperCase(),
          row as Pick<ProductMaster, "product_code" | "category" | "sub_category">,
        ]),
      );
      for (const asin of eolAsins) {
        const key = asin.trim().toUpperCase();
        const row = byCode.get(key);
        if (row && productMatchesCategoryRollup(subCategory, row)) {
          codes.add(key);
        }
      }
    }
  }

  return [...codes];
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
): Promise<DailySale[]> {
  const codes = await getProductCodesForCategoryHistoryRollup(marketplace, subCategory);
  return aggregateDailySalesForProductCodes(
    marketplace,
    codes,
    `category:${subCategory}`,
  );
}

export async function loadCategorySelloutAnalysis(
  marketplace: Marketplace,
  subCategory: SubCategory,
): Promise<{ skuCount: number; dailySales: DailySale[] }> {
  const codes = await getProductCodesForCategoryHistoryRollup(marketplace, subCategory);
  const dailySales = await aggregateDailySalesForProductCodes(
    marketplace,
    codes,
    `category:${subCategory}`,
  );
  return { skuCount: codes.length, dailySales };
}

/**
 * Category analysis: sum each master **month column** (Apr-25, May-25, …) for all SKUs in the
 * sub-category from the latest completed upload per channel.
 */
export async function loadCategorySheetMonthlySellout(
  subCategory: SubCategoryFilter,
): Promise<CategorySheetMonthlySellout> {
  if (subCategory === "all") {
    const parts = await Promise.all(
      TRACKED_SUB_CATEGORIES.map((key) =>
        loadCategorySheetMonthlySelloutForOne(key),
      ),
    );
    return mergeCategorySheetMonthlySellout(parts);
  }
  return loadCategorySheetMonthlySelloutForOne(subCategory);
}

async function loadCategorySheetMonthlySelloutForOne(
  subCategory: SubCategory,
): Promise<CategorySheetMonthlySellout> {
  const uploadCtx = await getLatestUploadContextByMarketplace();
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
  ): Promise<boolean> {
    const { data, error } = await supabase
      .from("category_monthly_sellout")
      .select("month_ym, units_sold")
      .eq("marketplace", marketplace)
      .eq("upload_id", uploadId)
      .eq("sub_category", subCategory);
    if (error) {
      if (isMissingCategoryMonthlyTableError(error)) return false;
      throw new Error(getErrorMessage(error));
    }
    if (!data?.length) return false;
    for (const row of data) {
      const r = row as { month_ym: string; units_sold: unknown };
      const ym = String(r.month_ym);
      const units = Number(r.units_sold ?? 0);
      target.set(ym, units);
      monthlyCombined.set(ym, (monthlyCombined.get(ym) ?? 0) + units);
    }
    return true;
  }

  async function sumMonthColumnsFallback(
    marketplace: Marketplace,
    codes: string[],
    uploadId: string | null,
    target: Map<string, number>,
  ) {
    if (codes.length === 0 || !uploadId) return;
    for (const chunk of chunkArray(codes, 150)) {
      const { data, error } = await supabase
        .from("daily_sales")
        .select("sale_date, units_sold")
        .eq("marketplace", marketplace)
        .eq("upload_id", uploadId)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of data ?? []) {
        const r = row as { sale_date: string; units_sold: unknown };
        const saleDate = String(r.sale_date);
        if (!/^\d{4}-\d{2}-01$/.test(saleDate)) continue;
        const ym = sheetMonthSaleDateToKey(saleDate);
        const units = Number(r.units_sold ?? 0);
        target.set(ym, (target.get(ym) ?? 0) + units);
        monthlyCombined.set(ym, (monthlyCombined.get(ym) ?? 0) + units);
      }
    }
  }

  const [codesAmazon, codesFlipkart] = await Promise.all([
    channelsActive.amazon
      ? getProductCodesForCategoryHistoryRollup("amazon", subCategory)
      : Promise.resolve([] as string[]),
    channelsActive.flipkart
      ? getProductCodesForCategoryHistoryRollup("flipkart", subCategory)
      : Promise.resolve([] as string[]),
  ]);

  const [amazonFromTable, flipkartFromTable] = await Promise.all([
    uploadCtx.amazon?.id
      ? loadFromCategoryMonthlyTable("amazon", uploadCtx.amazon.id, monthlyAmazon)
      : Promise.resolve(false),
    uploadCtx.flipkart?.id
      ? loadFromCategoryMonthlyTable("flipkart", uploadCtx.flipkart.id, monthlyFlipkart)
      : Promise.resolve(false),
  ]);

  await Promise.all([
    !amazonFromTable
      ? sumMonthColumnsFallback(
          "amazon",
          codesAmazon,
          uploadCtx.amazon?.id ?? null,
          monthlyAmazon,
        )
      : Promise.resolve(),
    !flipkartFromTable
      ? sumMonthColumnsFallback(
          "flipkart",
          codesFlipkart,
          uploadCtx.flipkart?.id ?? null,
          monthlyFlipkart,
        )
      : Promise.resolve(),
  ]);

  const [ongoingMonthMtd, previousMonthSo] = await Promise.all([
    loadCategoryOngoingMonthMtd(subCategory, uploadCtx, channelsActive),
    loadCategoryPreviousMonthSo(subCategory, uploadCtx, channelsActive),
  ]);

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
  };
}

/** Sum **May MTD** (report month) from latest upload `computed_metrics` for category charts. */
async function loadCategoryOngoingMonthMtd(
  subCategory: SubCategory,
  uploadCtx: Awaited<ReturnType<typeof getLatestUploadContextByMarketplace>>,
  channelsActive: { amazon: boolean; flipkart: boolean },
): Promise<CategoryOngoingMonthMtd | null> {
  const nowYm = new Date().toISOString().slice(0, 7);

  async function sumMtd(
    marketplace: Marketplace,
    snapshotDate: string | null,
    uploadId: string | null,
  ): Promise<number> {
    if (!snapshotDate || !uploadId) return 0;
    const codes = await getProductCodesForCategoryHistoryRollup(marketplace, subCategory);
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

  const reportYm = snapshotDates.sort((a, b) => b.localeCompare(a))[0].slice(0, 7);
  if (reportYm !== nowYm) return null;

  const [amazon, flipkart] = await Promise.all([
    channelsActive.amazon
      ? sumMtd("amazon", uploadCtx.amazon?.snapshotDate ?? null, uploadCtx.amazon?.id ?? null)
      : Promise.resolve(0),
    channelsActive.flipkart
      ? sumMtd("flipkart", uploadCtx.flipkart?.snapshotDate ?? null, uploadCtx.flipkart?.id ?? null)
      : Promise.resolve(0),
  ]);

  return { monthYm: nowYm, amazon, flipkart };
}

/** Sum **Apr SO** (previous month on the master) when Event SO month columns were not stored. */
async function loadCategoryPreviousMonthSo(
  subCategory: SubCategory,
  uploadCtx: Awaited<ReturnType<typeof getLatestUploadContextByMarketplace>>,
  channelsActive: { amazon: boolean; flipkart: boolean },
): Promise<CategoryPreviousMonthSo | null> {
  async function sumAprSo(
    marketplace: Marketplace,
    snapshotDate: string | null,
    uploadId: string | null,
  ): Promise<number> {
    if (!snapshotDate || !uploadId) return 0;
    const codes = await getProductCodesForCategoryHistoryRollup(marketplace, subCategory);
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

  const [amazon, flipkart] = await Promise.all([
    channelsActive.amazon
      ? sumAprSo("amazon", uploadCtx.amazon?.snapshotDate ?? null, uploadCtx.amazon?.id ?? null)
      : Promise.resolve(0),
    channelsActive.flipkart
      ? sumAprSo("flipkart", uploadCtx.flipkart?.snapshotDate ?? null, uploadCtx.flipkart?.id ?? null)
      : Promise.resolve(0),
  ]);

  if (amazon === 0 && flipkart === 0) return null;
  return { monthYm, amazon, flipkart };
}
