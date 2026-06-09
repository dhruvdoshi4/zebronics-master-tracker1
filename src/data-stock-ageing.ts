import { listKnownErpProductIds } from "./erp-product-link";
import type { ParsedStockAgeingPayload } from "./parsers-stock-ageing";
import {
  emptyStockAgeingBuckets,
  stockAgeingBucketsFromDbRow,
  type StockAgeingBuckets,
} from "./stock-ageing";
import { pruneOlderUploads } from "./data";
import { supabase } from "./supabase";
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

export type StockAgeingByPrdcode = StockAgeingBuckets & {
  prdcode: string;
  model_name: string;
  total_qty: number;
};

export async function getLatestStockAgeingUpload(): Promise<{
  id: string;
  snapshot_date: string | null;
  file_name: string;
} | null> {
  const { data, error } = await supabase
    .from("uploads")
    .select("id, snapshot_date, file_name")
    .eq("upload_kind", "stock_ageing")
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error, "upload_kind")) return null;
    throw new Error(getErrorMessage(error));
  }
  if (!data?.id) return null;
  return {
    id: String(data.id),
    snapshot_date: data.snapshot_date ? String(data.snapshot_date) : null,
    file_name: String(data.file_name ?? ""),
  };
}

export async function getStockAgeingMapByPrdcode(): Promise<
  Map<string, StockAgeingByPrdcode>
> {
  const upload = await getLatestStockAgeingUpload();
  const map = new Map<string, StockAgeingByPrdcode>();
  if (!upload) return map;

  const { data, error } = await supabase.from("stock_ageing_snapshot").select("*").eq("upload_id", upload.id);

  if (error) {
    if (isMissingSchemaError(error, "stock_ageing_snapshot")) return map;
    throw new Error(getErrorMessage(error));
  }

  for (const row of data ?? []) {
    const raw = row as Record<string, unknown>;
    const prdcode = String(raw.prdcode ?? "").trim();
    if (!prdcode) continue;
    const buckets = stockAgeingBucketsFromDbRow(raw);
    map.set(prdcode, {
      prdcode,
      model_name: String(raw.model_name ?? ""),
      total_qty: Number(raw.total_qty ?? 0),
      ...buckets,
    });
  }
  return map;
}

export function stockAgeingForProductId(
  map: Map<string, StockAgeingByPrdcode>,
  erpProductId: string,
): StockAgeingByPrdcode | null {
  const key = String(erpProductId ?? "").trim();
  if (!key) return null;
  return map.get(key) ?? null;
}


export async function ingestStockAgeingUpload({
  payload,
  fileName,
  uploadedBy,
  snapshotDate,
}: {
  payload: ParsedStockAgeingPayload;
  fileName: string;
  uploadedBy: string;
  snapshotDate: string;
}): Promise<{ uploadId: string; matchedCount: number; skippedCount: number }> {
  const knownIds = await listKnownErpProductIds();
  const matched = payload.rows.filter((row) => knownIds.has(row.prdcode));
  const skippedCount = payload.rows.length - matched.length;

  if (matched.length === 0) {
    throw new Error(
      "No Prdcode values matched product IDs in the app. Upload HO stock or sellout first, then re-upload ageing.",
    );
  }

  const { data: uploadRow, error: uploadErr } = await supabase
    .from("uploads")
    .insert({
      marketplace: "amazon",
      file_name: fileName,
      uploaded_by: uploadedBy,
      snapshot_date: snapshotDate,
      status: "processing",
      upload_kind: "stock_ageing",
      data_scope: "default",
      raw_row_count: payload.rows.length,
      valid_row_count: matched.length,
      rejected_row_count: payload.errors.length + skippedCount,
      notes: `Stock ageing — ${payload.sheetName}`,
    })
    .select("id")
    .single();

  if (uploadErr) {
    if (
      getErrorMessage(uploadErr).toLowerCase().includes("upload_kind") ||
      isMissingSchemaError(uploadErr, "stock_ageing")
    ) {
      throw new Error(
        "Stock ageing is not enabled in the database. Run supabase/run-stock-ageing.sql in Supabase SQL Editor, then retry.",
      );
    }
    throw new Error(getErrorMessage(uploadErr));
  }

  const uploadId = String(uploadRow!.id);

  try {
    const { upsertSupabaseParallel } = await import("./xlsx-fast");
    await upsertSupabaseParallel(
      "stock_ageing_snapshot",
      matched.map((row) => ({
        upload_id: uploadId,
        prdcode: row.prdcode,
        model_name: row.model_name,
        total_qty: row.total_qty,
        qty_0_90: row.qty_0_90,
        qty_91_180: row.qty_91_180,
        qty_181_365: row.qty_181_365,
        qty_365_plus: row.qty_365_plus,
      })),
      "upload_id,prdcode",
      { batchSize: 500, concurrency: 4 },
    );
  } catch (e) {
    await supabase.from("uploads").delete().eq("id", uploadId);
    throw e;
  }

  await supabase
    .from("uploads")
    .update({
      status: "completed",
      notes: `Stock ageing: ${matched.length} matched Prdcode(s) from ${payload.sheetName} (${skippedCount} not in app)`,
    })
    .eq("id", uploadId);

  await pruneOlderUploads(uploadId);
  return { uploadId, matchedCount: matched.length, skippedCount };
}

export { emptyStockAgeingBuckets };
