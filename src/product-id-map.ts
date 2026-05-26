import {
  fetchAllErpProductLinks,
  fetchErpProductLinkByListing,
  syncErpProductLinksFromHoStockRows,
} from "./erp-product-link";
import {
  isDirectListingCodeQuery,
  modelNameMatchesLookupQuery,
  unifiedLookupModelName,
} from "./product-display";
import { splitFsnCell } from "./parsers-ho-stock";
import {
  fetchAllHoStockSnapshotRows,
  fetchHoStockRowByListingCode,
} from "./ho-stock-snapshot-query";
import { supabase } from "./supabase";
import type { Marketplace } from "./types";
import { normalizeKey } from "./utils";

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

function buildMapFromLinkRows(
  rows: Array<{ asin: string; fsn: string; erp_product_id: string; model_name: string }>,
  meta: { uploadId: string; snapshotDate: string | null; fileName: string | null },
): ProductIdMap {
  const map: ProductIdMap = {
    uploadId: meta.uploadId,
    snapshotDate: meta.snapshotDate,
    fileName: meta.fileName,
    byProductId: new Map(),
    asinToProductId: new Map(),
    fsnToProductId: new Map(),
  };
  for (const row of rows) {
    mergeSnapshotRow(map, row);
  }
  return map;
}

async function bootstrapRegistryFromHoSnapshot(upload: {
  id: string;
  snapshot_date: string | null;
  file_name: string;
}): Promise<Array<{ asin: string; fsn: string; erp_product_id: string; model_name: string }>> {
  try {
    const data = (await fetchAllHoStockSnapshotRows(
      upload.id,
      "asin, fsn, erp_product_id, model_name",
    )) as Array<{
      asin: string;
      fsn: string;
      erp_product_id: string;
      model_name: string;
    }>;
    if (data.length > 0) {
      await syncErpProductLinksFromHoStockRows(data, upload.id);
    }
    return data;
  } catch (error) {
    if (isMissingSchemaError(error, "ho_stock_snapshot")) return [];
    throw error;
  }
}

/**
 * Persistent product ID registry (erp_product_link) + latest HO stock upload metadata.
 * Links survive when older HO stock uploads are pruned after a new file is ingested.
 */
export async function loadProductIdMap(force = false): Promise<ProductIdMap | null> {
  const upload = await getLatestHoStockUpload();
  const cacheKey = upload?.id ?? "registry";
  if (!force && cached?.uploadId === cacheKey) return cached;

  let linkRows = await fetchAllErpProductLinks();

  if (linkRows.length === 0 && upload) {
    const snapshotRows = await bootstrapRegistryFromHoSnapshot(upload);
    if (snapshotRows.length > 0) {
      linkRows = snapshotRows.map((row) => ({
        erp_product_id: row.erp_product_id,
        asin: row.asin,
        fsn: row.fsn,
        model_name: row.model_name,
      }));
    } else {
      linkRows = await fetchAllErpProductLinks();
    }
  }

  if (linkRows.length === 0) {
    cached = null;
    return null;
  }

  const map = buildMapFromLinkRows(linkRows, {
    uploadId: upload?.id ?? "registry",
    snapshotDate: upload?.snapshot_date ?? null,
    fileName: upload?.file_name ?? null,
  });

  cached = map;
  return map;
}

/** Resolve product ID for a listing, with persistent registry + snapshot DB fallbacks. */
export async function resolveErpProductIdForListing(
  marketplace: Marketplace,
  productCode: string,
  productName?: string,
): Promise<string | null> {
  const code = productCode.trim();
  const map = await loadProductIdMap(true);
  if (map) {
    if (/^B0/i.test(code)) {
      const fromAsin = lookupErpProductId(map, "amazon", code);
      if (fromAsin) return fromAsin;
    }
    if (marketplace === "amazon" || marketplace === "flipkart") {
      const fromMap = lookupErpProductId(map, marketplace, code);
      if (fromMap) return fromMap;
    }
    const byName = findClosestErpProductIdByModelName(map, productName ?? "");
    if (byName) return byName;
  }

  const fromRegistry = await fetchErpProductLinkByListing(
    marketplace === "amazon" || marketplace === "flipkart" ? marketplace : "amazon",
    code,
  );
  if (fromRegistry) {
    return normalizeProductId(fromRegistry.erp_product_id) || null;
  }

  const upload = await getLatestHoStockUpload();
  if (!upload) return null;

  if (marketplace !== "amazon" && marketplace !== "flipkart") {
    if (!/^B0/i.test(code)) return null;
    try {
      const row = await fetchHoStockRowByListingCode(upload.id, "amazon", code);
      if (!row) return null;
      const pid = normalizeProductId(row.erp_product_id);
      return pid || null;
    } catch {
      return null;
    }
  }

  try {
    const row = await fetchHoStockRowByListingCode(upload.id, marketplace, code);
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

function scoreNameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  const aParts = a.split(" ").filter(Boolean);
  const bParts = b.split(" ").filter(Boolean);
  if (!aParts.length || !bParts.length) return 0;
  const bSet = new Set(bParts);
  let overlap = 0;
  for (const token of aParts) {
    if (bSet.has(token)) overlap += 1;
  }
  return overlap / Math.max(aParts.length, bParts.length);
}

function findClosestErpProductIdByModelName(
  map: ProductIdMap,
  productName: string,
): string | null {
  const query = normalizeKey(productName);
  if (!query) return null;
  let best: { pid: string; score: number } | null = null;
  for (const entry of map.byProductId.values()) {
    const model = normalizeKey(entry.modelName);
    if (!model) continue;
    const score = scoreNameSimilarity(query, model);
    if (!best || score > best.score) {
      best = { pid: entry.erpProductId, score };
    }
  }
  return best && best.score >= 0.55 ? best.pid : null;
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

  const codeQuery = isDirectListingCodeQuery(trimmed);
  const q = trimmed.toLowerCase();

  if (codeQuery && /^\d+$/.test(trimmed)) {
    const exact = map.byProductId.get(trimmed);
    if (exact) push(exact);
  }

  for (const entry of map.byProductId.values()) {
    if (results.length >= limit) break;

    const displayName = unifiedLookupModelName({
      amazonCode: entry.asin,
      flipkartCode: pickFlipkartFsn(entry.fsns),
    });

    if (!codeQuery) {
      if (displayName !== "—" && modelNameMatchesLookupQuery(displayName, trimmed)) {
        push(entry);
      }
      continue;
    }

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
    if (modelNameMatchesLookupQuery(displayName, trimmed)) {
      push(entry);
    }
  }

  return results.slice(0, limit);
}

/** Clear in-memory cache (e.g. after a new HO stock upload in the same session). */
export function invalidateProductIdMapCache() {
  cached = null;
}
