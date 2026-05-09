import { buildComputedMetric } from "./metrics";
import { supabase } from "./supabase";
import type {
  ComputedMetric,
  DashboardRecord,
  DailySale,
  Marketplace,
  ParsedUploadPayload,
  ProductMaster,
} from "./types";
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
