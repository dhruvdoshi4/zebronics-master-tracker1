import * as XLSX from "xlsx";
import { sheetRowsFromWorksheet } from "./xlsx-qcom-sheet";
import { normalizeKey } from "./utils";
import type { QcomMarketplace } from "./types";

export type QcomConsolidatedRow = {
  asin: string;
  productName: string;
  category: string | null;
  subCategory: string | null;
  brand: string | null;
  blinkitItemId: string | null;
  zeptoPvid: string | null;
  instamartCode: string | null;
  bigbasketCode: string | null;
};

export type QcomAsinLinkMaps = {
  byAsin: Map<string, QcomConsolidatedRow>;
  blinkit: Map<string, string>;
  zepto: Map<string, string>;
  instamart: Map<string, string>;
  bigbasket: Map<string, string>;
};

const CONSOLIDATED_SHEET = "consolidated";

const COLUMN_ALIASES = {
  asin: ["asin"],
  itemId: ["item id"],
  pvid: ["pvid"],
  swiggy: ["swiggy"],
  bigbasket: ["big basket", "bigbasket"],
  model: ["model"],
  category: ["category"],
  subCategory: ["sub category", "subcategory"],
  brand: ["brand"],
} as const;

const CHANNEL_LISTING_GETTERS: Record<
  QcomMarketplace,
  (row: QcomConsolidatedRow) => string | null
> = {
  blinkit: (r) => r.blinkitItemId,
  zepto: (r) => r.zeptoPvid,
  instamart: (r) => r.instamartCode,
  bigbasket: (r) => r.bigbasketCode,
};

function findColumnIndex(headers: string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const exact = headers.findIndex((h) => h === alias);
    if (exact >= 0) return exact;
    const partial = headers.findIndex((h) => Boolean(h) && h.includes(alias));
    if (partial >= 0) return partial;
  }
  return -1;
}

function rowHasAsin(normalized: string[]): boolean {
  return normalized.some((h) => h === "asin" || h.includes("asin"));
}

function detectHeaderRow(rows: unknown[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const normalized = (rows[i] ?? []).map((c) => normalizeKey(c));
    if (!rowHasAsin(normalized)) continue;
    const score =
      Number(normalized.some((h) => h === "model")) +
      Number(normalized.some((h) => h === "category"));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function cleanListing(value: string): string {
  const v = value.trim();
  if (!v || v === "-") return "";
  return v;
}

function cleanAsin(value: string): string {
  const v = value.trim().toUpperCase();
  return /^B0[A-Z0-9]{8,}$/i.test(v) ? v : "";
}

/** Build ASIN ↔ channel listing maps from the Consolidated tab (identity only, no sellout). */
export function buildQcomAsinLinkMapsFromRows(rows: unknown[][]): QcomAsinLinkMaps {
  const maps: QcomAsinLinkMaps = {
    byAsin: new Map(),
    blinkit: new Map(),
    zepto: new Map(),
    instamart: new Map(),
    bigbasket: new Map(),
  };

  if (rows.length < 2) return maps;

  const headerRowIndex = detectHeaderRow(rows);
  const headers = (rows[headerRowIndex] ?? []).map((c) => normalizeKey(c));

  const asinIdx = findColumnIndex(headers, COLUMN_ALIASES.asin);
  const itemIdIdx = findColumnIndex(headers, COLUMN_ALIASES.itemId);
  const pvidIdx = findColumnIndex(headers, COLUMN_ALIASES.pvid);
  const swiggyIdx = findColumnIndex(headers, COLUMN_ALIASES.swiggy);
  const bbIdx = findColumnIndex(headers, COLUMN_ALIASES.bigbasket);
  const modelIdx = findColumnIndex(headers, COLUMN_ALIASES.model);
  const categoryIdx = findColumnIndex(headers, COLUMN_ALIASES.category);
  const subCategoryIdx = findColumnIndex(headers, COLUMN_ALIASES.subCategory);
  const brandIdx = findColumnIndex(headers, COLUMN_ALIASES.brand);

  for (let r = headerRowIndex + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const asin = asinIdx >= 0 ? cleanAsin(String(row[asinIdx] ?? "")) : "";
    if (!asin) continue;

    const entry: QcomConsolidatedRow = {
      asin,
      productName: modelIdx >= 0 ? String(row[modelIdx] ?? "").trim() : "",
      category: categoryIdx >= 0 ? String(row[categoryIdx] ?? "").trim() || null : null,
      subCategory:
        subCategoryIdx >= 0 ? String(row[subCategoryIdx] ?? "").trim() || null : null,
      brand: brandIdx >= 0 ? String(row[brandIdx] ?? "").trim() || null : null,
      blinkitItemId: itemIdIdx >= 0 ? cleanListing(String(row[itemIdIdx] ?? "")) || null : null,
      zeptoPvid: pvidIdx >= 0 ? cleanListing(String(row[pvidIdx] ?? "")) || null : null,
      instamartCode: swiggyIdx >= 0 ? cleanListing(String(row[swiggyIdx] ?? "")) || null : null,
      bigbasketCode: bbIdx >= 0 ? cleanListing(String(row[bbIdx] ?? "")) || null : null,
    };

    maps.byAsin.set(asin, entry);
    if (entry.blinkitItemId) maps.blinkit.set(entry.blinkitItemId, asin);
    if (entry.zeptoPvid) maps.zepto.set(entry.zeptoPvid, asin);
    if (entry.instamartCode) maps.instamart.set(entry.instamartCode, asin);
    if (entry.bigbasketCode) maps.bigbasket.set(entry.bigbasketCode, asin);
  }

  return maps;
}

export function buildQcomAsinLinkMapsFromWorkbook(book: XLSX.WorkBook): QcomAsinLinkMaps {
  const sheetName = book.SheetNames.find((n) => normalizeKey(n) === CONSOLIDATED_SHEET);
  if (!sheetName) {
    return {
      byAsin: new Map(),
      blinkit: new Map(),
      zepto: new Map(),
      instamart: new Map(),
      bigbasket: new Map(),
    };
  }
  const ws = book.Sheets[sheetName];
  if (!ws) {
    return buildQcomAsinLinkMapsFromRows([]);
  }
  return buildQcomAsinLinkMapsFromRows(sheetRowsFromWorksheet(ws));
}

export type QcomChannelIdentity = {
  /** Stored in product_master / daily_sales / metrics (ASIN when Consolidated links). */
  productCode: string;
  /** Platform listing code from the channel sheet row. */
  listingCode: string | null;
  asin: string | null;
  consolidated: QcomConsolidatedRow | null;
};

export function resolveQcomChannelIdentity(
  marketplace: QcomMarketplace,
  asinRaw: string,
  listingRaw: string,
  linkMaps: QcomAsinLinkMaps,
): QcomChannelIdentity {
  const listing = cleanListing(listingRaw);
  const asinFromRow = cleanAsin(asinRaw);
  const channelMap =
    marketplace === "blinkit"
      ? linkMaps.blinkit
      : marketplace === "zepto"
        ? linkMaps.zepto
        : marketplace === "instamart"
          ? linkMaps.instamart
          : linkMaps.bigbasket;
  const asinFromMap = listing ? channelMap.get(listing) ?? "" : "";
  const asin = asinFromRow || asinFromMap || null;
  const productCode = asin ?? (listing || asinFromRow || "");
  const listingCode = asin && listing ? listing : null;
  const consolidated = asin ? linkMaps.byAsin.get(asin) ?? null : null;

  return { productCode, listingCode, asin, consolidated };
}

export function getListingCodeForChannel(
  consolidated: QcomConsolidatedRow | null,
  marketplace: QcomMarketplace,
): string | null {
  if (!consolidated) return null;
  return CHANNEL_LISTING_GETTERS[marketplace](consolidated);
}

export function linkMapStats(maps: QcomAsinLinkMaps): {
  asinCount: number;
  blinkit: number;
  zepto: number;
  instamart: number;
  bigbasket: number;
} {
  return {
    asinCount: maps.byAsin.size,
    blinkit: maps.blinkit.size,
    zepto: maps.zepto.size,
    instamart: maps.instamart.size,
    bigbasket: maps.bigbasket.size,
  };
}
