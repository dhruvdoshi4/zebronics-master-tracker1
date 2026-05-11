import type { CategorySheetOverlay } from "./category-sellout-insights";
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
import { listAmazonHardcodedEolAsins } from "./eol";
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

function chunkArray<T>(items: T[], chunkSize = 500): T[][] {
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
      await upsertInBatches(
        "daily_sales",
        payload.dailySales,
        "marketplace,product_code,sale_date",
      );
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

/** Latest sheet coverage date per channel from the most recent upload that stored `snapshot_date`. */
export async function getLatestUploadSheetCoverageByMarketplace(): Promise<{
  amazon: string | null;
  flipkart: string | null;
}> {
  const [amazonRes, flipkartRes] = await Promise.all([
    supabase
      .from("uploads")
      .select("snapshot_date")
      .eq("marketplace", "amazon")
      .not("snapshot_date", "is", null)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("uploads")
      .select("snapshot_date")
      .eq("marketplace", "flipkart")
      .not("snapshot_date", "is", null)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (amazonRes.error) throw new Error(getErrorMessage(amazonRes.error));
  if (flipkartRes.error) throw new Error(getErrorMessage(flipkartRes.error));
  return {
    amazon: (amazonRes.data?.snapshot_date as string | null | undefined) ?? null,
    flipkart: (flipkartRes.data?.snapshot_date as string | null | undefined) ?? null,
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
): Promise<DailySale[]> {
  if (codes.length === 0) return [];

  const dateTotals = new Map<string, number>();

  for (const chunk of chunkArray(codes, 150)) {
    const { data, error } = await supabase
      .from("daily_sales")
      .select("sale_date, units_sold")
      .eq("marketplace", marketplace)
      .in("product_code", chunk);
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

/** Roll up daily_sales for all SKUs in a sub-category on both Amazon and Flipkart (same calendar day = combined units). */
export async function loadCombinedCategorySelloutAnalysis(subCategory: SubCategory): Promise<{
  skuCountAmazon: number;
  skuCountFlipkart: number;
  skuCount: number;
  dailySales: DailySale[];
  dailySalesAmazon: DailySale[];
  dailySalesFlipkart: DailySale[];
}> {
  const [codesAmazon, codesFlipkart] = await Promise.all([
    getProductCodesForCategoryHistoryRollup("amazon", subCategory),
    getProductCodesForCategoryHistoryRollup("flipkart", subCategory),
  ]);

  const dateTotals = new Map<string, number>();
  const dateTotalsAmazon = new Map<string, number>();
  const dateTotalsFlipkart = new Map<string, number>();

  const mergeMarketplace = async (marketplace: Marketplace, codes: string[]) => {
    if (codes.length === 0) return;
    const channelMap = marketplace === "amazon" ? dateTotalsAmazon : dateTotalsFlipkart;
    for (const chunk of chunkArray(codes, 150)) {
      const { data, error } = await supabase
        .from("daily_sales")
        .select("sale_date, units_sold")
        .eq("marketplace", marketplace)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of data ?? []) {
        const r = row as { sale_date: string; units_sold: unknown };
        const date = String(r.sale_date);
        const units = Number(r.units_sold ?? 0);
        channelMap.set(date, (channelMap.get(date) ?? 0) + units);
        dateTotals.set(date, (dateTotals.get(date) ?? 0) + units);
      }
    }
  };

  await mergeMarketplace("amazon", codesAmazon);
  await mergeMarketplace("flipkart", codesFlipkart);

  const syntheticCode = `category-combined:${subCategory}`;
  const toRows = (entries: [string, number][], m: Marketplace): DailySale[] =>
    entries
      .map(([sale_date, units_sold]) => ({
        marketplace: m,
        product_code: syntheticCode,
        sale_date,
        units_sold,
      }))
      .sort((a, b) => a.sale_date.localeCompare(b.sale_date));

  const dailySales = toRows([...dateTotals.entries()], "amazon");
  const dailySalesAmazon = toRows([...dateTotalsAmazon.entries()], "amazon");
  const dailySalesFlipkart = toRows([...dateTotalsFlipkart.entries()], "flipkart");

  return {
    skuCountAmazon: codesAmazon.length,
    skuCountFlipkart: codesFlipkart.length,
    skuCount: codesAmazon.length + codesFlipkart.length,
    dailySales,
    dailySalesAmazon,
    dailySalesFlipkart,
  };
}

/**
 * Map sheet columns **Apr SO** / **May MTD** to calendar month keys for chart overlay.
 * These are fixed April/May columns on the master — not “calendar month before as_of_date”
 * (e.g. as_of in early April must still patch `YYYY-04`, not March).
 */
function sheetAprMayOverlayMonthKeys(asOf: Date): { priorMonthYm: string; currentMonthYm: string } {
  const y = asOf.getFullYear();
  const m = asOf.getMonth();
  if (m >= 3) {
    return { priorMonthYm: `${y}-04`, currentMonthYm: `${y}-05` };
  }
  return { priorMonthYm: `${y - 1}-04`, currentMonthYm: `${y - 1}-05` };
}

/**
 * Sums the latest snapshot **Apr SO** and **May MTD** columns from `computed_metrics` (same cells as the
 * uploaded master) for all SKUs in a sub-category, split by marketplace — used to align category charts
 * with the sheet for those two months.
 */
export async function getCategorySheetSnapshotOverlay(
  subCategory: SubCategory,
): Promise<CategorySheetOverlay | null> {
  const [codesAmazon, codesFlipkart] = await Promise.all([
    getProductCodesForSubCategory("amazon", subCategory),
    getProductCodesForSubCategory("flipkart", subCategory),
  ]);

  async function fetchMetricsChunked(
    marketplace: Marketplace,
    codes: string[],
  ): Promise<ComputedMetric[]> {
    const out: ComputedMetric[] = [];
    for (const chunk of chunkArray(codes, 150)) {
      if (chunk.length === 0) continue;
      const { data, error } = await supabase
        .from("computed_metrics")
        .select("*")
        .eq("marketplace", marketplace)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      out.push(...((data ?? []) as ComputedMetric[]));
    }
    return out;
  }

  const [rowsAmazon, rowsFlipkart] = await Promise.all([
    fetchMetricsChunked("amazon", codesAmazon),
    fetchMetricsChunked("flipkart", codesFlipkart),
  ]);

  const latestByKey = new Map<string, ComputedMetric>();
  for (const row of [...rowsAmazon, ...rowsFlipkart]) {
    const k = `${row.marketplace}:${row.product_code}`;
    const existing = latestByKey.get(k);
    if (!existing || row.as_of_date > existing.as_of_date) latestByKey.set(k, row);
  }

  const latest = [...latestByKey.values()];
  if (latest.length === 0) return null;

  /** Latest row per SKU already picked — do not require the same as_of_date across channels (Amazon vs Flipkart uploads often differ by a few days). */
  let amazonApr = 0;
  let flipApr = 0;
  let amazonMay = 0;
  let flipMay = 0;
  for (const m of latest) {
    const apr = Number(m.apr_so_units ?? 0);
    const may = Number(m.may_mtd_units ?? 0);
    if (m.marketplace === "amazon") {
      amazonApr += apr;
      amazonMay += may;
    } else {
      flipApr += apr;
      flipMay += may;
    }
  }

  const asOfDate = latest.reduce(
    (max, r) => (r.as_of_date > max ? r.as_of_date : max),
    latest[0].as_of_date,
  );
  const asOf = new Date(`${asOfDate}T12:00:00`);
  const { priorMonthYm, currentMonthYm } = sheetAprMayOverlayMonthKeys(asOf);

  return {
    asOfDate,
    priorMonthYm,
    currentMonthYm,
    priorMonth: {
      total: amazonApr + flipApr,
      amazon: amazonApr,
      flipkart: flipApr,
    },
    currentMonth: {
      total: amazonMay + flipMay,
      amazon: amazonMay,
      flipkart: flipMay,
    },
  };
}
