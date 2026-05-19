import { splitFsnCell } from "./parsers-ho-stock";
import {
  fetchAllHoStockSnapshotRows,
  fetchHoStockRowByListingCode,
} from "./ho-stock-snapshot-query";
import { supabase } from "./supabase";
import type { Marketplace } from "./types";

export type ProductIdEntry = {
  erpProductId: string;
  asin: string;
  fsns: string[];
  modelName: string;
};

export type ProductIdMap = {
  uploadId: string;
  snapshotDate: string | null;
  fileName: string | null;
  byProductId: Map<string, ProductIdEntry>;
  asinToProductId: Map<string, string>;
  fsnToProductId: Map<string, string>;
};

let cached: ProductIdMap | null = null;

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

async function getLatestHoStockUpload(): Promise<{
  id: string;
  snapshot_date: string | null;
  file_name: string;
} | null> {
  const { data, error } = await supabase
    .from("uploads")
    .select("id, snapshot_date, file_name")
    .eq("upload_kind", "ho_stock")
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error, "upload_kind") || isMissingSchemaError(error, "ho_stock_snapshot")) {
      return null;
    }
    throw new Error(getErrorMessage(error));
  }
  return data as { id: string; snapshot_date: string | null; file_name: string } | null;
}

function normalizeProductId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return String(Math.trunc(asNumber));
  }
  return value;
}

function mergeSnapshotRow(
  map: ProductIdMap,
  row: { asin: string; fsn: string; erp_product_id: string; model_name: string },
) {
  const erpProductId = normalizeProductId(row.erp_product_id);
  if (!erpProductId) return;

  const asin = String(row.asin ?? "").trim().toUpperCase();
  const fsns = splitFsnCell(String(row.fsn ?? ""));
  const modelName = String(row.model_name ?? "").trim();

  let entry = map.byProductId.get(erpProductId);
  if (!entry) {
    entry = { erpProductId, asin: "", fsns: [], modelName: "" };
    map.byProductId.set(erpProductId, entry);
  }

  if (asin) {
    entry.asin = asin;
    map.asinToProductId.set(asin, erpProductId);
  }
  for (const fsn of fsns) {
    if (!entry.fsns.includes(fsn)) entry.fsns.push(fsn);
    map.fsnToProductId.set(fsn, erpProductId);
  }
  if (modelName && !entry.modelName) entry.modelName = modelName;
}

/** Latest HO stock upload → ASIN / FSN ↔ ERP product ID index. */
export async function loadProductIdMap(force = false): Promise<ProductIdMap | null> {
  const upload = await getLatestHoStockUpload();
  if (!upload) {
    cached = null;
    return null;
  }
  if (!force && cached?.uploadId === upload.id) return cached;

  let data: Array<{
    asin: string;
    fsn: string;
    erp_product_id: string;
    model_name: string;
  }>;
  try {
    data = (await fetchAllHoStockSnapshotRows(
      upload.id,
      "asin, fsn, erp_product_id, model_name",
    )) as Array<{
      asin: string;
      fsn: string;
      erp_product_id: string;
      model_name: string;
    }>;
  } catch (error) {
    if (isMissingSchemaError(error, "ho_stock_snapshot")) return null;
    throw error;
  }

  const map: ProductIdMap = {
    uploadId: upload.id,
    snapshotDate: upload.snapshot_date,
    fileName: upload.file_name,
    byProductId: new Map(),
    asinToProductId: new Map(),
    fsnToProductId: new Map(),
  };

  for (const row of data) {
    mergeSnapshotRow(map, row);
  }

  cached = map;
  return map;
}

/** Resolve product ID for a listing, with a direct DB fallback past row 1000. */
export async function resolveErpProductIdForListing(
  marketplace: Marketplace,
  productCode: string,
): Promise<string | null> {
  const map = await loadProductIdMap(true);
  if (map) {
    const fromMap = lookupErpProductId(map, marketplace, productCode);
    if (fromMap) return fromMap;
  }

  const upload = await getLatestHoStockUpload();
  if (!upload) return null;

  try {
    const row = await fetchHoStockRowByListingCode(upload.id, marketplace, productCode);
    if (!row) return null;
    const pid = normalizeProductId(row.erp_product_id);
    return pid || null;
  } catch {
    return null;
  }
}

export function lookupErpProductId(
  map: ProductIdMap,
  marketplace: Marketplace,
  productCode: string,
): string | null {
  const code = productCode.trim();
  if (!code) return null;
  if (marketplace === "amazon") {
    return map.asinToProductId.get(code.toUpperCase()) ?? null;
  }
  return map.fsnToProductId.get(code.toUpperCase()) ?? null;
}

export function lookupCodesByErpProductId(
  map: ProductIdMap,
  erpProductId: string,
): ProductIdEntry | null {
  return map.byProductId.get(normalizeProductId(erpProductId)) ?? null;
}

export function pickFlipkartFsn(fsns: string[], currentCode?: string): string | null {
  if (fsns.length === 0) return null;
  const current = currentCode?.trim().toUpperCase();
  if (current) {
    const hit = fsns.find((fsn) => fsn.toUpperCase() === current);
    if (hit) return hit;
  }
  return fsns[0] ?? null;
}

export function searchProductIdMap(
  map: ProductIdMap,
  query: string,
  limit = 12,
): ProductIdEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const results: ProductIdEntry[] = [];
  const seen = new Set<string>();

  const push = (entry: ProductIdEntry) => {
    if (seen.has(entry.erpProductId)) return;
    seen.add(entry.erpProductId);
    results.push(entry);
  };

  if (/^\d+$/.test(trimmed)) {
    const exact = map.byProductId.get(trimmed);
    if (exact) push(exact);
  }

  const q = trimmed.toLowerCase();
  for (const entry of map.byProductId.values()) {
    if (results.length >= limit) break;
    if (entry.erpProductId.includes(trimmed)) {
      push(entry);
      continue;
    }
    if (entry.asin.toLowerCase().includes(q)) {
      push(entry);
      continue;
    }
    if (entry.fsns.some((fsn) => fsn.toLowerCase().includes(q))) {
      push(entry);
      continue;
    }
    if (entry.modelName.toLowerCase().includes(q)) {
      push(entry);
    }
  }

  return results.slice(0, limit);
}

/** Clear in-memory cache (e.g. after a new HO stock upload in the same session). */
export function invalidateProductIdMapCache() {
  cached = null;
}
