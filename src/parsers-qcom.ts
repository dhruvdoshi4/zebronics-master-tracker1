import * as XLSX from "xlsx";
import { format } from "date-fns";
import { getCurrentFyStart } from "./category-sellout-insights";
import {
  buildQcomAsinLinkMapsFromWorkbook,
  linkMapStats,
  resolveQcomChannelIdentity,
  type QcomAsinLinkMaps,
} from "./qcom-consolidated-link";
import { looksLikeProductSku } from "./product-display";
import type {
  CategoryMonthlySelloutInput,
  DailySale,
  Marketplace,
  MetricInput,
  ParsedUploadPayload,
  QcomMarketplace,
} from "./types";
import { QCOM_HO_STOCK_CATALOG_MARKETPLACE, QCOM_MARKETPLACES } from "./types";
import { splitFsnCell } from "./parsers-ho-stock";
import {
  asNumber,
  isValidIsoDateString,
  normalizeKey,
  resolveUploadSnapshotDate,
} from "./utils";

const CONSOLIDATED_SHEET_KEY = "consolidated";

const CONSOLIDATED_COLUMN_ALIASES = {
  asin: ["asin", "amazon asin"],
  fsn: ["fsn", "flipkart fsn"],
  productCode: ["asin/fsn", "sku", "product id"],
  productName: ["model"],
  category: ["category"],
  subCategory: ["sub category", "subcategory"],
} as const;

const SHEET_TO_MARKETPLACE: Record<string, QcomMarketplace> = {
  zepto: "zepto",
  blinkit: "blinkit",
  bigbasket: "bigbasket",
  swiggy: "instamart",
};

const COLUMN_ALIASES = {
  productCode: ["asin", "asin/fsn", "sku"],
  listingCode: ["item id", "item code", "pvid"],
  productName: ["model"],
  category: ["category"],
  subCategory: ["sub category", "subcategory"],
  brand: ["brand"],
  inventory: ["inv", "inventory"],
  totalSo: ["total so", "total sellout"],
  mtd: ["mtd"],
  drr: ["drr"],
  doc: ["doc"],
} as const;

const METRIC_HEADER_TOKENS = new Set([
  "total so",
  "2026 so",
  "2025 so",
  "2024 so",
  "feb mtd",
  "drr",
  "doc",
  "kam",
  "brand",
]);

const MONTH_LOOKUP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function headerCellToString(cell: unknown): string {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return format(cell, "yyyy-MM-dd");
  }
  return String(cell ?? "").trim();
}

type ProductInput = {
  marketplace: Marketplace;
  product_code: string;
  product_name: string;
  category: string | null;
  sub_category: string | null;
  brand: string | null;
  /** Channel SKU when product_code is ASIN (from Consolidated link). */
  listing_code: string | null;
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

function rowHasProductIdentifier(normalized: string[]): boolean {
  const hasProductCode = normalized.some((h) =>
    COLUMN_ALIASES.productCode.some((a) => h === a || h.includes(a)),
  );
  const hasListingCode = normalized.some((h) =>
    COLUMN_ALIASES.listingCode.some((a) => h === a || h.includes(a)),
  );
  return hasProductCode || hasListingCode;
}

function detectHeaderRow(rows: unknown[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const normalized = (rows[i] ?? []).map((c) => normalizeKey(c));
    if (!rowHasProductIdentifier(normalized)) continue;
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

/** Day-level sellout headers: Excel shows "6/Feb" (raw:false) or full GMT timestamps. */
function parseQcomDailyColumnDate(
  rawHeader: string,
  snapshotDate: string,
): string | null {
  const raw = headerCellToString(rawHeader);
  if (!raw || METRIC_HEADER_TOKENS.has(normalizeKey(raw))) return null;
  if (/^20\d{2}\s+so$/i.test(raw)) return null;
  if (normalizeKey(raw).includes("mtd") && !/gmt|202\d/i.test(raw)) return null;

  if (/gmt|202\d/i.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return format(d, "yyyy-MM-dd");
  }

  const short = /^(\d{1,2})\/([A-Za-z]{3})$/i.exec(raw);
  if (short) {
    const day = Number(short[1]);
    const monthToken = short[2].slice(0, 3).toLowerCase();
    const month = MONTH_LOOKUP[monthToken];
    if (month === undefined || day < 1 || day > 31) return null;
    const snap = new Date(`${snapshotDate}T12:00:00`);
    let year = snap.getFullYear();
    if (month > snap.getMonth() + 2) year -= 1;
    return format(new Date(year, month, day), "yyyy-MM-dd");
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  return null;
}

function findCurrentMonthMtdIndex(headers: string[], snapshotDate: string): number {
  const monthToken = format(new Date(`${snapshotDate}T12:00:00`), "MMM").toLowerCase();
  return headers.findIndex(
    (h) => h.includes(monthToken) && h.includes("mtd") && !h.includes("nlc"),
  );
}

function pickModelName(
  row: unknown[],
  modelIndex: number,
  code: string,
  consolidatedName: string | null,
): string {
  const channelName = modelIndex >= 0 ? String(row[modelIndex] ?? "").trim() : "";
  const name = channelName || consolidatedName || "";
  if (!name) return code;
  if (code && name.toUpperCase() === code.toUpperCase()) return name;
  if (looksLikeProductSku(name) && /^B0/i.test(code)) return name;
  return name;
}

function parseSheetToPayload(
  rows: unknown[][],
  marketplace: QcomMarketplace,
  effectiveSnapshotDate: string,
  linkMaps: QcomAsinLinkMaps,
): ParsedUploadPayload {
  const headerRowIndex = detectHeaderRow(rows);
  const headers = (rows[headerRowIndex] ?? []).map((c) => normalizeKey(c));

  const productCodeIndex = findColumnIndex(headers, COLUMN_ALIASES.productCode);
  const listingIndex = findColumnIndex(headers, COLUMN_ALIASES.listingCode);
  const modelIndex = findColumnIndex(headers, COLUMN_ALIASES.productName);
  const categoryIndex = findColumnIndex(headers, COLUMN_ALIASES.category);
  const subCategoryIndex = findColumnIndex(headers, COLUMN_ALIASES.subCategory);
  const brandIndex = findColumnIndex(headers, COLUMN_ALIASES.brand);
  const inventoryIndex = findColumnIndex(headers, COLUMN_ALIASES.inventory);
  const totalSoIndex = findColumnIndex(headers, COLUMN_ALIASES.totalSo);
  const mtdIndex = findCurrentMonthMtdIndex(headers, effectiveSnapshotDate);
  const drrIndex = findColumnIndex(headers, COLUMN_ALIASES.drr);
  const docIndex = findColumnIndex(headers, COLUMN_ALIASES.doc);

  const fy2024Index = headers.findIndex((h) => h === "2024 so");
  const fy2025Index = headers.findIndex((h) => h === "2025 so");

  const rawHeaders = (rows[headerRowIndex] ?? []).map((c) => headerCellToString(c));
  const dailyColumns = rawHeaders
    .map((rawHeader, index) => ({
      index,
      date: parseQcomDailyColumnDate(rawHeader, effectiveSnapshotDate),
    }))
    .filter((item): item is { index: number; date: string } => Boolean(item.date));

  const productsByKey = new Map<string, ProductInput>();
  const metricsByKey = new Map<string, MetricInput>();
  const dailySelloutByKey = new Map<string, DailySale>();
  const categoryMonthlyMap = new Map<string, number>();
  const errors: ParsedUploadPayload["errors"] = [];

  let rawCount = 0;
  let validCount = 0;

  const reportFyStart = getCurrentFyStart(new Date(`${effectiveSnapshotDate}T12:00:00`));
  const priorFyStart = reportFyStart - 1;

  for (let rowNumber = headerRowIndex + 1; rowNumber < rows.length; rowNumber += 1) {
    const row = rows[rowNumber];
    if (!row) continue;

    const asinRaw = productCodeIndex >= 0 ? String(row[productCodeIndex] ?? "").trim() : "";
    const listingRaw = listingIndex >= 0 ? String(row[listingIndex] ?? "").trim() : "";
    const identity = resolveQcomChannelIdentity(marketplace, asinRaw, listingRaw, linkMaps);
    const productCode = identity.productCode;
    if (!productCode || productCode === "-") continue;

    rawCount += 1;
    const productName = pickModelName(
      row,
      modelIndex,
      productCode,
      identity.consolidated?.productName ?? null,
    );
    const category =
      (categoryIndex >= 0 ? String(row[categoryIndex] ?? "").trim() : "") ||
      identity.consolidated?.category ||
      "";
    const subCategory =
      (subCategoryIndex >= 0 ? String(row[subCategoryIndex] ?? "").trim() : "") ||
      identity.consolidated?.subCategory ||
      "";
    const brand =
      (brandIndex >= 0 ? String(row[brandIndex] ?? "").trim() : "") ||
      identity.consolidated?.brand ||
      "";

    const mapKey = `${marketplace}:${productCode}`;
    productsByKey.set(mapKey, {
      marketplace,
      product_code: productCode,
      product_name: productName || productCode,
      category: category || null,
      sub_category: subCategory || null,
      brand: brand || null,
      listing_code: identity.listingCode,
    });

    const inventoryValue = inventoryIndex >= 0 ? asNumber(row[inventoryIndex]) : 0;
    const totalSoValue = totalSoIndex >= 0 ? asNumber(row[totalSoIndex]) : 0;
    const mtdValue = mtdIndex >= 0 ? asNumber(row[mtdIndex]) : 0;
    const drrValue = drrIndex >= 0 ? asNumber(row[drrIndex]) : 0;
    const docValue = docIndex >= 0 ? asNumber(row[docIndex]) : 0;

    let priorFySo = 0;
    if (priorFyStart === 2024 && fy2024Index >= 0) priorFySo += asNumber(row[fy2024Index]);
    if (priorFyStart === 2025 && fy2025Index >= 0) priorFySo += asNumber(row[fy2025Index]);

    const existingMetric = metricsByKey.get(mapKey);
    if (existingMetric) {
      metricsByKey.set(mapKey, {
        ...existingMetric,
        inventory_units: Math.max(existingMetric.inventory_units, inventoryValue),
        total_so_units: Math.max(existingMetric.total_so_units, totalSoValue),
        may_mtd_units: existingMetric.may_mtd_units + mtdValue,
        drr_units: drrValue || existingMetric.drr_units,
        doc_days_excel: docIndex >= 0 ? docValue : existingMetric.doc_days_excel,
        prior_fy_so_units: Math.max(existingMetric.prior_fy_so_units ?? 0, priorFySo),
      });
    } else {
      metricsByKey.set(mapKey, {
        marketplace,
        product_code: productCode,
        as_of_date: effectiveSnapshotDate,
        inventory_units: inventoryValue,
        total_so_units: totalSoValue,
        may_mtd_units: mtdValue,
        apr_so_units: 0,
        prior_fy_so_units: priorFySo,
        drr_units: drrValue,
        doc_days_excel: docIndex >= 0 ? docValue : null,
      });
    }

    for (const col of dailyColumns) {
      const units = Math.max(0, asNumber(row[col.index]));
      if (units <= 0) continue;
      const saleMapKey = `${marketplace}:${productCode}:${col.date}`;
      const prev = dailySelloutByKey.get(saleMapKey);
      dailySelloutByKey.set(saleMapKey, {
        marketplace,
        product_code: productCode,
        sale_date: col.date,
        units_sold: (prev?.units_sold ?? 0) + units,
      });
      if (category) {
        const monthYm = col.date.slice(0, 7);
        const catKey = `${category}::${monthYm}`;
        categoryMonthlyMap.set(catKey, (categoryMonthlyMap.get(catKey) ?? 0) + units);
      }
    }

    validCount += 1;
  }

  const categoryMonthlySellout: CategoryMonthlySelloutInput[] = [];
  for (const [key, units] of categoryMonthlyMap) {
    const [cat, monthYm] = key.split("::");
    if (!cat || !monthYm) continue;
    categoryMonthlySellout.push({
      marketplace,
      sub_category: cat,
      month_ym: monthYm,
      units_sold: units,
    });
  }

  return {
    products: [...productsByKey.values()],
    metricInputs: [...metricsByKey.values()],
    dailySales: [...dailySelloutByKey.values()],
    categoryMonthlySellout,
    errors,
    rawCount,
    validCount,
    ignoredCount: 0,
    flipkartEolModelNames: [],
    flipkartEolFsns: [],
  };
}

export type QcomParseBundle = {
  marketplace: QcomMarketplace;
  sheetName: string;
  payload: ParsedUploadPayload;
};

export type QcomConsolidatedCatalogBundle = {
  sheetName: string;
  payload: ParsedUploadPayload;
};

export type QcomMasterParseResult = {
  channelBundles: QcomParseBundle[];
  consolidatedCatalog: QcomConsolidatedCatalogBundle | null;
};

function isAmazonAsinValue(value: string): boolean {
  return /^B0[A-Z0-9]{8,}$/i.test(value.trim());
}

/**
 * Consolidated tab: catalogue rows for HO Stock (category, ASIN, FSN, model).
 * Does not ingest channel sellout metrics.
 */
function parseConsolidatedCatalogSheet(rows: unknown[][]): ParsedUploadPayload {
  const headerRowIndex = detectHeaderRow(rows);
  const headers = (rows[headerRowIndex] ?? []).map((c) => normalizeKey(c));

  const asinIndex = findColumnIndex(headers, CONSOLIDATED_COLUMN_ALIASES.asin);
  const fsnIndex = findColumnIndex(headers, CONSOLIDATED_COLUMN_ALIASES.fsn);
  const productCodeIndex = findColumnIndex(headers, CONSOLIDATED_COLUMN_ALIASES.productCode);
  const modelIndex = findColumnIndex(headers, CONSOLIDATED_COLUMN_ALIASES.productName);
  const categoryIndex = findColumnIndex(headers, CONSOLIDATED_COLUMN_ALIASES.category);
  const subCategoryIndex = findColumnIndex(headers, CONSOLIDATED_COLUMN_ALIASES.subCategory);

  const productsByKey = new Map<string, ProductInput>();
  let rawCount = 0;

  const addIdentifier = (
    code: string,
    productName: string,
    category: string,
    subCategory: string,
  ) => {
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode || normalizedCode === "-") return;
    const mapKey = `${QCOM_HO_STOCK_CATALOG_MARKETPLACE}:${normalizedCode}`;
    productsByKey.set(mapKey, {
      marketplace: QCOM_HO_STOCK_CATALOG_MARKETPLACE,
      product_code: normalizedCode,
      product_name: productName || normalizedCode,
      category: category || null,
      sub_category: subCategory || null,
      brand: null,
    });
  };

  for (let rowNumber = headerRowIndex + 1; rowNumber < rows.length; rowNumber += 1) {
    const row = rows[rowNumber];
    if (!row) continue;

    rawCount += 1;

    let asinRaw = asinIndex >= 0 ? String(row[asinIndex] ?? "").trim() : "";
    let fsnRaw = fsnIndex >= 0 ? String(row[fsnIndex] ?? "").trim() : "";
    const combinedRaw =
      productCodeIndex >= 0 ? String(row[productCodeIndex] ?? "").trim() : "";

    if (!asinRaw && combinedRaw && isAmazonAsinValue(combinedRaw)) {
      asinRaw = combinedRaw;
    }
    if (!fsnRaw && combinedRaw && !isAmazonAsinValue(combinedRaw) && looksLikeProductSku(combinedRaw)) {
      fsnRaw = combinedRaw;
    }

    const asin = asinRaw && isAmazonAsinValue(asinRaw) ? asinRaw.toUpperCase() : "";
    const fsns = splitFsnCell(fsnRaw).filter((fsn) => looksLikeProductSku(fsn));
    if (!asin && fsns.length === 0) continue;

    const modelRaw = modelIndex >= 0 ? String(row[modelIndex] ?? "").trim() : "";
    const category = categoryIndex >= 0 ? String(row[categoryIndex] ?? "").trim() : "";
    const subCategory =
      subCategoryIndex >= 0 ? String(row[subCategoryIndex] ?? "").trim() : "";
    const productName = pickModelName(row, modelIndex, asin || fsns[0] || "");

    if (asin) addIdentifier(asin, productName || modelRaw, category, subCategory);
    for (const fsn of fsns) {
      if (fsn === asin) continue;
      addIdentifier(fsn, productName || modelRaw, category, subCategory);
    }
  }

  const products = [...productsByKey.values()];
  return {
    products,
    metricInputs: [],
    dailySales: [],
    categoryMonthlySellout: [],
    errors: [],
    rawCount,
    validCount: products.length,
    ignoredCount: 0,
    flipkartEolModelNames: [],
    flipkartEolFsns: [],
  };
}

export async function parseQcomMasterFile(
  file: File,
  snapshotDate: string,
): Promise<QcomMasterParseResult> {
  const effectiveSnapshotDate = resolveUploadSnapshotDate(file.name, snapshotDate);
  if (!isValidIsoDateString(effectiveSnapshotDate)) {
    throw new Error(
      "Set the sheet coverage date, or include it in the file name (e.g. till 6th February 2026).",
    );
  }

  const buffer = await file.arrayBuffer();
  const book = XLSX.read(buffer, { type: "array", cellDates: true });
  const linkMaps = buildQcomAsinLinkMapsFromWorkbook(book);
  const linkStats = linkMapStats(linkMaps);
  if (linkStats.asinCount === 0) {
    console.warn(
      "[qcom upload] Consolidated sheet missing or has no ASIN rows — channel products will use listing IDs only.",
    );
  } else {
    console.info(
      `[qcom upload] Consolidated link: ${linkStats.asinCount} ASINs (Blinkit ${linkStats.blinkit}, Zepto ${linkStats.zepto}, Instamart ${linkStats.instamart}, BigBasket ${linkStats.bigbasket} listing codes).`,
    );
  }

  const channelBundles: QcomParseBundle[] = [];
  let consolidatedCatalog: QcomConsolidatedCatalogBundle | null = null;

  for (const sheetName of book.SheetNames) {
    const key = normalizeKey(sheetName);
    const ws = book.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];

    if (key === CONSOLIDATED_SHEET_KEY) {
      if (rows.length < 3) continue;
      const payload = parseConsolidatedCatalogSheet(rows);
      if (payload.validCount > 0) {
        consolidatedCatalog = { sheetName, payload };
      }
      continue;
    }

    const marketplace = SHEET_TO_MARKETPLACE[key];
    if (!marketplace) continue;

    if (rows.length < 3) continue;

    const payload = parseSheetToPayload(rows, marketplace, effectiveSnapshotDate, linkMaps);
    if (payload.validCount === 0) {
      const headerIdx = detectHeaderRow(rows);
      const headers = (rows[headerIdx] ?? []).map((c) => normalizeKey(c)).filter(Boolean);
      throw new Error(
        `No valid rows on sheet "${sheetName}".` +
          (headers.length
            ? ` Header row looks like: ${headers.slice(0, 8).join(", ")}. Need ASIN or a listing column (Item ID / PVID / Item Code) plus Model.`
            : " Could not detect a header row — check the tab is not empty."),
      );
    }
    channelBundles.push({ marketplace, sheetName, payload });
  }

  if (channelBundles.length === 0) {
    throw new Error(
      `No Quick Commerce sheets found. Expected tabs: Zepto, Blinkit, Swiggy (Instamart), BigBasket. Found: ${book.SheetNames.join(", ")}`,
    );
  }

  const missing = QCOM_MARKETPLACES.filter(
    (m) => !channelBundles.some((b) => b.marketplace === m),
  );
  if (missing.length) {
    console.warn(`[qcom upload] Missing channel sheets: ${missing.join(", ")}`);
  }

  if (!consolidatedCatalog) {
    console.warn(
      `[qcom upload] No Consolidated sheet catalogue — HO Stock categories will be empty until that tab is present.`,
    );
  }

  return { channelBundles, consolidatedCatalog };
}
