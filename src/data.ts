import {
  type CategoryOngoingMonthMtd,
  type CategorySheetMonthlySellout,
  sheetMonthSaleDateToKey,
} from "./category-sellout-insights";
import { buildComputedMetric } from "./metrics";
import { supabase } from "./supabase";
import type {
  ComputedMetric,
  DashboardRecord,
  DailySale,
  Marketplace,
  ParsedUploadPayload,
  ProductMaster,
  SubCategory,
} from "./types";
import { isExcludedFromActiveDashboard, listAmazonHardcodedEolAsins } from "./eol";
import { normalizeKey } from "./utils";

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
    map.set(key, { ...(map.get(key) ?? {}), ...row });
  }

  return [...map.values()];
}

const FLIPKART_EOL_MODELS_TABLE = "flipkart_eol_models";

function isMissingFlipkartEolTableError(error: unknown): boolean {
  const msg = getErrorMessage(error);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  return (
    code === "PGRST205" ||
    /flipkart_eol_models|schema cache|does not exist|could not find.*table/i.test(
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

/**
 * Removes all Event SO history and legacy metrics for a channel.
 * Use before a fresh upload so partial bad ingests (e.g. Apr-25 = 216) cannot linger in charts.
 */
function isMissingCategoryMonthlyTableError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes("category_monthly_sellout") && msg.includes("does not exist");
}

export async function purgeMarketplaceSelloutHistory(
  marketplace: Marketplace,
): Promise<void> {
  const { error: salesError } = await supabase
    .from("daily_sales")
    .delete()
    .eq("marketplace", marketplace);
  if (salesError) throw new Error(getErrorMessage(salesError));

  const { error: categoryMonthlyError } = await supabase
    .from("category_monthly_sellout")
    .delete()
    .eq("marketplace", marketplace);
  if (categoryMonthlyError && !isMissingCategoryMonthlyTableError(categoryMonthlyError)) {
    throw new Error(getErrorMessage(categoryMonthlyError));
  }

  const { error: legacyMetricsError } = await supabase
    .from("computed_metrics")
    .delete()
    .eq("marketplace", marketplace)
    .is("upload_id", null);
  if (legacyMetricsError) throw new Error(getErrorMessage(legacyMetricsError));
}

/** Wipe both channels — clears phantom Amazon/Flipkart totals on category charts. */
export async function purgeAllStaleSelloutHistory(): Promise<void> {
  await purgeMarketplaceSelloutHistory("amazon");
  await purgeMarketplaceSelloutHistory("flipkart");
}

async function upsertInBatches(
  table: string,
  rows: unknown[],
  onConflict: string,
) {
  const overallStart = performance.now();
  const dedupeStart = performance.now();
  const dedupedRows = dedupeRowsByConflict(rows, onConflict);
  console.log(
    `[upload] dedupe ${table}: ${rows.length} -> ${dedupedRows.length} rows in ${(performance.now() - dedupeStart).toFixed(0)}ms`,
  );

  const chunks = chunkArray(dedupedRows);
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
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
  }
  console.log(
    `[upload] upsert ${table} total: ${(performance.now() - overallStart).toFixed(0)}ms`,
  );
}

export async function ingestParsedUpload({
  payload,
  marketplace,
  fileName,
  uploadedBy,
  snapshotDate,
}: {
  payload: ParsedUploadPayload;
  marketplace: Marketplace;
  fileName: string;
  uploadedBy: string;
  snapshotDate: string;
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
    throw new Error(getErrorMessage(uploadCreateError));
  }

  try {
    const uploadId = upload.id as string;

    /** Full channel reset so old broken Event SO rows (e.g. partial Apr-25 = 216) are gone before insert. */
    await purgeMarketplaceSelloutHistory(marketplace);

    const products = payload.products.map((product) => ({
      ...product,
      sub_category: product.sub_category ?? "",
      category: product.category ?? "",
      brand: product.brand ?? "",
    }));

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
      const dailySalesWithUpload = payload.dailySales.map((row) => ({
        ...row,
        upload_id: uploadId,
      }));
      await upsertInBatches(
        "daily_sales",
        dailySalesWithUpload,
        "marketplace,product_code,sale_date",
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

    const finalizeStart = performance.now();
    const { error: completedError } = await supabase
      .from("uploads")
      .update({
        status: "completed",
        notes: `Processed ${payload.validCount} tracked rows.`,
      })
      .eq("id", uploadId);
    console.log(
      `[upload] finalize uploads row: ${(performance.now() - finalizeStart).toFixed(0)}ms`,
    );

    if (completedError) throw new Error(getErrorMessage(completedError));
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

export async function getDashboardRecords(
  marketplace: Marketplace,
): Promise<DashboardRecord[]> {
  const flipkartEolModelNames = await getFlipkartEolModelNames();

  const { data: metricsRows, error: metricsError } = await supabase
    .from("computed_metrics")
    .select("*")
    .eq("marketplace", marketplace)
    .order("as_of_date", { ascending: false });
  if (metricsError) throw new Error(getErrorMessage(metricsError));

  const latestByCode = new Map<string, ComputedMetric>();
  (metricsRows as ComputedMetric[]).forEach((metric) => {
    if (!latestByCode.has(metric.product_code)) {
      latestByCode.set(metric.product_code, metric);
    }
  });

  const { data: productRows, error: productError } = await supabase
    .from("product_master")
    .select("*")
    .eq("marketplace", marketplace);
  if (productError) throw new Error(getErrorMessage(productError));

  const productMap = new Map(
    (productRows as ProductMaster[]).map((product) => [
      product.product_code,
      product,
    ]),
  );

  return [...latestByCode.values()]
    .map((metric) => {
      const product = productMap.get(metric.product_code);
      const computedPo = Math.max(
        0,
        Number((metric.drr_units * 45 - metric.inventory_units).toFixed(2)),
      );
      return {
        ...metric,
        purchase_order_units: computedPo,
        product_name: product?.product_name ?? metric.product_code,
        category: product?.category ?? null,
        sub_category: product?.sub_category ?? null,
        brand: product?.brand ?? null,
        image_url: product?.image_url ?? null,
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

export async function getUploadHistory() {
  const { data, error } = await supabase
    .from("uploads")
    .select("*")
    .order("uploaded_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(getErrorMessage(error));
  return data;
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
export async function getLatestUploadContextByMarketplace(): Promise<{
  amazon: LatestUploadContext | null;
  flipkart: LatestUploadContext | null;
}> {
  async function fetchOne(marketplace: Marketplace): Promise<LatestUploadContext | null> {
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
      const fallback = await supabase
        .from("uploads")
        .select("id, snapshot_date, notes")
        .eq("marketplace", marketplace)
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
export async function deleteUploadRecord(uploadId: string) {
  const { data: row, error: fetchError } = await supabase
    .from("uploads")
    .select("id, marketplace, snapshot_date")
    .eq("id", uploadId)
    .maybeSingle();
  if (fetchError) throw new Error(getErrorMessage(fetchError));
  if (!row) throw new Error("Upload not found.");

  const marketplace = row.marketplace as Marketplace;
  const snapshotDate = row.snapshot_date as string | null;

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

export async function findProductWithMetrics(
  marketplace: Marketplace,
  lookupText: string,
) {
  const normalized = lookupText.trim();
  if (!normalized) return null;

  const { data: exactCodeRows, error: exactCodeError } = await supabase
    .from("product_master")
    .select("*")
    .eq("marketplace", marketplace)
    .eq("product_code", normalized)
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

  if (!product) return null;

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

/**
 * For Sellout & Growth channel pick: find one Amazon and one Flipkart row in product_master
 * that share the same model name (exact match on product_name). When multiple codes exist,
 * the most recently updated row wins.
 */
export async function getPeersForSelloutChannel(
  productName: string,
): Promise<{ amazon: ProductMaster | null; flipkart: ProductMaster | null }> {
  const name = productName.trim();
  if (!name) return { amazon: null, flipkart: null };

  const fetchLatestByName = async (
    marketplace: Marketplace,
  ): Promise<ProductMaster | null> => {
    const { data, error } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", marketplace)
      .eq("product_name", name)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(getErrorMessage(error));
    return ((data ?? [])[0] ?? null) as ProductMaster | null;
  };

  const [amazon, flipkart] = await Promise.all([
    fetchLatestByName("amazon"),
    fetchLatestByName("flipkart"),
  ]);
  return { amazon, flipkart };
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

  const { data, error } = await supabase
    .from("product_master")
    .select("product_code, product_name")
    .eq("marketplace", marketplace)
    .or(`product_code.ilike.%${normalized}%,product_name.ilike.%${normalized}%`)
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(getErrorMessage(error));

  const seen = new Set<string>();
  return ((data ?? []) as Array<{ product_code: string; product_name: string }>).flatMap(
    (row) => {
      const key = `${row.product_code}::${row.product_name}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ productCode: row.product_code, productName: row.product_name }];
    },
  );
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
  return false;
}

/**
 * Amazon / Flipkart sellout masters put monitors under **Category "Monitor & Acc."** (wording may vary).
 * Excel roll-up for **Monitors** = that category + **Sub Category = Monitor** only (excludes Monitor Arm, etc.).
 */
function isMonitorAccessorySheetCategory(category: string | null | undefined): boolean {
  const c = normalizeKey(category ?? "");
  if (!c) return false;
  return c.includes("monitor") && (c.includes("acc") || c.includes("accessor"));
}

/** Same rules as the Ecom Sellout / FK master row filters for category analysis. */
function rowMatchesCategoryRollup(
  subCategory: SubCategory,
  row: Pick<ProductMaster, "category" | "sub_category">,
): boolean {
  if (!matchesTrackedSubCategory(row.sub_category, subCategory)) return false;

  if (subCategory === "monitor" || subCategory === "monitor_arm") {
    const cat = String(row.category ?? "").trim();
    if (!cat) return true;
    return isMonitorAccessorySheetCategory(row.category);
  }

  return true;
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
    .filter((row) => rowMatchesCategoryRollup(subCategory, row))
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
      if (!rowMatchesCategoryRollup(subCategory, row)) continue;
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
    for (const asin of listAmazonHardcodedEolAsins()) {
      codes.add(asin.trim().toUpperCase());
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

  const ongoingMonthMtd = await loadCategoryOngoingMonthMtd(
    subCategory,
    uploadCtx,
    channelsActive,
  );

  return {
    skuCountAmazon: codesAmazon.length,
    skuCountFlipkart: codesFlipkart.length,
    skuCount: codesAmazon.length + codesFlipkart.length,
    channelsActive,
    monthlyAmazon,
    monthlyFlipkart,
    monthlyCombined,
    ongoingMonthMtd,
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
