import { splitFsnCell } from "./parsers-ho-stock";
import { supabase } from "./supabase";
import type { Marketplace } from "./types";

const PAGE_SIZE = 1000;

export type ErpProductLinkRow = {
  erp_product_id: string;
  asin: string;
  fsn: string;
  model_name: string;
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

export function isMissingErpProductLinkTableError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes("erp_product_link") && msg.includes("does not exist");
}

export function normalizeProductId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return String(Math.trunc(asNumber));
  }
  return value;
}

export type HoStockLinkInput = {
  asin: string;
  fsn: string;
  erp_product_id: string;
  model_name: string;
};

/** Upsert ASIN / FSN ↔ product ID links from an HO stock ingest (persists across upload pruning). */
export async function syncErpProductLinksFromHoStockRows(
  rows: HoStockLinkInput[],
  uploadId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const byPid = new Map<string, ErpProductLinkRow>();

  for (const row of rows) {
    const erpProductId = normalizeProductId(row.erp_product_id);
    if (!erpProductId) continue;

    const asin = String(row.asin ?? "").trim().toUpperCase();
    const fsn = String(row.fsn ?? "").trim();
    const modelName = String(row.model_name ?? "").trim();

    const existing = byPid.get(erpProductId);
    if (!existing) {
      byPid.set(erpProductId, {
        erp_product_id: erpProductId,
        asin,
        fsn,
        model_name: modelName,
      });
      continue;
    }
    if (asin) existing.asin = asin;
    if (fsn) existing.fsn = fsn;
    if (modelName) existing.model_name = modelName;
  }

  const payload = [...byPid.values()].map((row) => ({
    ...row,
    last_upload_id: uploadId,
    updated_at: now,
  }));

  if (payload.length === 0) return;

  const { upsertSupabaseParallel } = await import("./xlsx-fast");
  try {
    await upsertSupabaseParallel("erp_product_link", payload, "erp_product_id", {
      batchSize: 500,
      concurrency: 4,
    });
  } catch (error) {
    if (isMissingErpProductLinkTableError(error)) {
      console.warn(
        "[ho-stock] erp_product_link table missing — run supabase/run-erp-product-link.sql. Product IDs will not persist across uploads.",
      );
      return;
    }
    throw error;
  }
}

/** Product IDs known from ERP links and latest HO stock (for ageing ingest match). */
export async function listKnownErpProductIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const row of await fetchAllErpProductLinks()) {
    const id = normalizeProductId(row.erp_product_id);
    if (id) ids.add(id);
  }
  if (ids.size > 0) return ids;

  try {
    const { getLatestGlobalHoStockUpload } = await import("./ho-stock-snapshot-query");
    const upload = await getLatestGlobalHoStockUpload();
    if (!upload) return ids;
    const { fetchAllHoStockSnapshotRows } = await import("./ho-stock-snapshot-query");
    const rows = await fetchAllHoStockSnapshotRows(upload.id, "erp_product_id");
    for (const row of rows) {
      const id = normalizeProductId((row as { erp_product_id?: string }).erp_product_id);
      if (id) ids.add(id);
    }
  } catch {
    // optional fallback
  }
  return ids;
}

export async function fetchAllErpProductLinks(): Promise<ErpProductLinkRow[]> {
  const all: ErpProductLinkRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("erp_product_link")
      .select("erp_product_id, asin, fsn, model_name")
      .order("erp_product_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      if (isMissingErpProductLinkTableError(error)) return [];
      throw new Error(getErrorMessage(error));
    }

    const batch = (data ?? []) as ErpProductLinkRow[];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

export async function fetchErpProductLinkByListing(
  marketplace: Marketplace,
  productCode: string,
): Promise<ErpProductLinkRow | null> {
  if (marketplace !== "amazon" && marketplace !== "flipkart") {
    if (!/^B0/i.test(productCode.trim())) return null;
    return fetchErpProductLinkByListing("amazon", productCode);
  }

  const code = productCode.trim().toUpperCase();
  if (!code) return null;

  if (marketplace === "amazon") {
    const { data, error } = await supabase
      .from("erp_product_link")
      .select("erp_product_id, asin, fsn, model_name")
      .eq("asin", code)
      .limit(1)
      .maybeSingle();
    if (error) {
      if (isMissingErpProductLinkTableError(error)) return null;
      throw new Error(getErrorMessage(error));
    }
    return (data as ErpProductLinkRow | null) ?? null;
  }

  const { data, error } = await supabase
    .from("erp_product_link")
    .select("erp_product_id, asin, fsn, model_name")
    .eq("fsn", code)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingErpProductLinkTableError(error)) return null;
    throw new Error(getErrorMessage(error));
  }
  if (data) return data as ErpProductLinkRow;

  const { data: ilikeRows, error: ilikeErr } = await supabase
    .from("erp_product_link")
    .select("erp_product_id, asin, fsn, model_name")
    .ilike("fsn", `%${code}%`)
    .limit(8);
  if (ilikeErr) {
    if (isMissingErpProductLinkTableError(ilikeErr)) return null;
    throw new Error(getErrorMessage(ilikeErr));
  }

  for (const row of (ilikeRows ?? []) as ErpProductLinkRow[]) {
    const fsns = splitFsnCell(row.fsn);
    if (fsns.some((fsn) => fsn.toUpperCase() === code)) return row;
  }
  return null;
}
