import * as XLSX from "xlsx";
import type { CatalogWorkspace } from "./catalog-workspace";
import {
  CATALOG_WORKSPACE_HOME_AUDIO,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_PRAVIN,
  CATALOG_WORKSPACE_RITHIKA,
} from "./catalog-workspace";
import {
  KARAN_TRACKED_SUB_CATEGORY_SET,
  normalizedKaranSubCategory,
} from "./karan-category-scope";
import {
  isLegacyRithikaStoredSubCategory,
  normalizedRithikaSubCategory,
  rowPassesRithikaKamGate,
} from "./rithika-category-scope";
import { normalizedPravinSubCategory, rowPassesPravinCategoryScope } from "./pravin-category-scope";
import {
  normalizedRishabhSubCategory,
  rowPassesRishabhCategoryScope,
} from "./rishabh-category-scope";
import type {
  CategoryMonthlySelloutInput,
  DailySale,
  Marketplace,
  MetricInput,
  ParsedUploadPayload,
  ProductMaster,
  SubCategory,
} from "./types";
import { getCurrentFyStart } from "./category-sellout-insights";
import {
  SELLOUT_DRR_LITERAL_ALIASES,
  SELLOUT_PO_28D_AVG_ALIASES,
  resolveSelloutDrrUnits,
  roundSheetDrrUnits,
  selloutDrrFallbackAliases,
} from "./sellout-drr-sheet-contract";
import {
  fyStartForMonthYm,
  monthColumnSumForFy,
  monthColumnUnitsAtSaleDate,
} from "./sellout-monthly-map";
import { priorYearMtdCategoryMonthKey } from "./sellout-yoy-compare";
import {
  buildSelloutClassificationHaystack,
  CORE_SELL_OUT_SUB_CATEGORY_SET,
  isExcludedNonDisplaySelloutProduct,
  looksLikeDisplayMonitor,
} from "./sellout-category-scope";
import { TRACKED_SUB_CATEGORY_SET } from "./types";
import { isDawgSheetCategory } from "./dawg-scope";
import { isKnownEolProductCode } from "./eol";
import { enrichFlipkartProductName } from "./flipkart-fsn-catalog";
import { looksLikeProductSku } from "./product-display";
import {
  asNumber,
  safeUnitsSold,
  isValidIsoDateString,
  normalizeKey,
  resolveUploadSnapshotDate,
} from "./utils";
import {
  readSheetProbeRows,
  readWorkbookSheetNames,
  readWorksheetCellValue,
  readWorksheetRowSlice,
} from "./xlsx-fast";

type ProductInput = Omit<
  ProductMaster,
  "id" | "created_at" | "updated_at" | "image_url"
> & {
  sub_category: string;
};

const COLUMN_ALIASES = {
  productCode: ["asin", "fsn", "sku", "product id", "item id", "model code"],
  productName: [
    "madel name",
    "madel",
    "name colour",
    "name color",
    "name (colour)",
    "name (color)",
    "model name",
    "modelname",
    "model no",
    "model number",
    "model colour",
    "model name colour",
    "style name",
    "product title",
    "listing title",
    "listing name",
    "article name",
    "article description",
    "item name",
    "item description",
    "model",
    "title",
    "product name",
    "description",
  ],
  category: [
    "category",
    "product category",
    "product type",
    "vertical",
    "business unit",
  ],
  subCategory: [
    "sub category",
    "subcategory",
    "sub-category",
    "sub_category",
    "sub cat",
  ],
  brand: ["brand"],
  inventory: [
    "atp",
    "inv as on",
    "inventory",
    "app inv",
    "sellable qty",
    "available qty",
    "stock",
  ],
  totalSo: ["total so", "total sellout", "total sell out", "lifetime so"],
  mtd: ["mtd"],
  prevMonthSo: ["so", "sellout", "sell out"],
  /** Literal DRR when present; channel fallback columns live in sellout-drr-sheet-contract.ts */
  drr: [...SELLOUT_DRR_LITERAL_ALIASES],
  drr28dAvg: [...SELLOUT_PO_28D_AVG_ALIASES],
  doc: ["doc", "days of coverage", "days of cover"],
  /** Flipkart master: "Active" | "EOL" — sole source for Flipkart EOL (tracked sub-categories). */
  remarks: ["remarks", "remark"],
  kam: ["kam", "account manager", "account mgr", "key account manager"],
} as const;

const ECOM_SELLOUT_SHEET = "Ecom Sellout";
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

function findColumnIndex(headers: string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const exact = headers.findIndex((header) => header === alias);
    if (exact >= 0) return exact;
    const includes = headers.findIndex(
      (header) => Boolean(header) && header.includes(alias),
    );
    if (includes >= 0) return includes;
  }
  return -1;
}

/** daWg / FK sheets often use dated headers like "Inv. 21st May 2026" → "inv 21st may 2026". */
function headerLooksLikeInventory(header: string): boolean {
  if (!header) return false;
  if (COLUMN_ALIASES.inventory.some((alias) => header.includes(alias))) return true;
  return (
    header === "inv" ||
    header.startsWith("inv ") ||
    /^inv \d/.test(header)
  );
}

function findInventoryColumnIndex(headers: string[]): number {
  const byAlias = findColumnIndex(headers, COLUMN_ALIASES.inventory);
  if (byAlias >= 0) return byAlias;
  return headers.findIndex((header) => headerLooksLikeInventory(header));
}

/** Flipkart masters use FSN as listing id; daWg tabs often include both ASIN and FSN. */
function findProductCodeColumnIndex(
  headers: string[],
  marketplace: Marketplace,
): number {
  if (marketplace === "flipkart") {
    const fsn = findColumnIndex(headers, ["fsn"]);
    if (fsn >= 0) return fsn;
  }
  return findColumnIndex(headers, COLUMN_ALIASES.productCode);
}

/** daWg / compact Flipkart tabs: FSN + Category, no Remarks (EOL) column. */
function flipkartSheetAllowsMissingRemarks(
  headers: string[],
  categoryIndex: number,
  options?: { subCategoryOnly?: boolean },
): boolean {
  if (options?.subCategoryOnly) {
    if (findColumnIndex(headers, COLUMN_ALIASES.remarks) >= 0) return false;
    return (
      findColumnIndex(headers, COLUMN_ALIASES.subCategory) >= 0 &&
      findColumnIndex(headers, ["fsn"]) >= 0
    );
  }
  if (categoryIndex < 0) return false;
  if (findColumnIndex(headers, COLUMN_ALIASES.remarks) >= 0) return false;
  return findColumnIndex(headers, ["fsn"]) >= 0;
}

/** Prefer the sheet "Category" column — not "Sub Category" (which also contains the word category). */
function findCategoryColumnIndex(headers: string[]): number {
  const subCategoryIndex = findColumnIndex(headers, COLUMN_ALIASES.subCategory);
  for (const alias of COLUMN_ALIASES.category) {
    const exact = headers.findIndex(
      (header, index) => header === alias && index !== subCategoryIndex,
    );
    if (exact >= 0) return exact;
    const includes = headers.findIndex(
      (header, index) =>
        Boolean(header) &&
        index !== subCategoryIndex &&
        header.includes(alias) &&
        !header.includes("sub category") &&
        !header.includes("subcategory"),
    );
    if (includes >= 0) return includes;
  }
  return -1;
}

function isCodeColumnHeader(header: string): boolean {
  if (!header) return true;
  if (header.includes("fsn")) return true;
  if (header.includes("asin")) return true;
  if (header === "sku" || header.endsWith(" sku") || header.startsWith("sku ")) return true;
  if (header.includes("product id") || header.includes("item id")) return true;
  if (header.includes("model code")) return true;
  return false;
}

function findProductNameColumnIndex(headers: string[]): number {
  for (const alias of COLUMN_ALIASES.productName) {
    const exact = headers.findIndex(
      (header) => header === alias && !isCodeColumnHeader(header),
    );
    if (exact >= 0) return exact;
    const includes = headers.findIndex(
      (header) =>
        Boolean(header) &&
        header.includes(alias) &&
        !isCodeColumnHeader(header) &&
        alias.length > 3,
    );
    if (includes >= 0) return includes;
  }
  const loose = headers.findIndex(
    (header) => header === "model" && !isCodeColumnHeader(header),
  );
  return loose >= 0 ? loose : -1;
}

function pickProductModelName(
  row: unknown[],
  headers: string[],
  productCodeIndex: number,
  productNameIndex: number,
): string {
  const code = String(row[productCodeIndex] ?? "").trim();

  const readAt = (index: number): string =>
    index >= 0 && index !== productCodeIndex
      ? String(row[index] ?? "").trim()
      : "";

  const accept = (candidate: string): boolean => {
    if (!candidate) return false;
    if (code && candidate.toUpperCase() === code.toUpperCase()) return false;
    return !looksLikeProductSku(candidate);
  };

  if (productNameIndex >= 0) {
    const primary = readAt(productNameIndex);
    if (accept(primary)) return primary;
  }

  for (let i = 0; i < headers.length; i += 1) {
    if (i === productCodeIndex || i === productNameIndex) continue;
    const header = headers[i] ?? "";
    if (
      COLUMN_ALIASES.productName.some(
        (alias) => header === alias || (alias.length > 3 && header.includes(alias)),
      )
    ) {
      const candidate = readAt(i);
      if (accept(candidate)) return candidate;
    }
  }

  for (let i = 0; i < row.length; i += 1) {
    if (i === productCodeIndex) continue;
    const header = headers[i] ?? "";
    if (
      isCodeColumnHeader(header) ||
      headerLooksLikeInventory(header) ||
      COLUMN_ALIASES.category.some((alias) => header.includes(alias)) ||
      COLUMN_ALIASES.subCategory.some((alias) => header.includes(alias)) ||
      COLUMN_ALIASES.totalSo.some((alias) => header.includes(alias)) ||
      COLUMN_ALIASES.mtd.some((alias) => header.includes(alias)) ||
      COLUMN_ALIASES.prevMonthSo.some((alias) => header.includes(alias)) ||
      COLUMN_ALIASES.drr.some((alias) => header.includes(alias)) ||
      COLUMN_ALIASES.doc.some((alias) => header.includes(alias)) ||
      COLUMN_ALIASES.remarks.some((alias) => header.includes(alias))
    ) {
      continue;
    }
    const cell = String(row[i] ?? "").trim();
    if (!accept(cell)) continue;
    if (/[a-zA-Z]/.test(cell) && (/\s/.test(cell) || /[-/()]/.test(cell) || /^ZEB/i.test(cell))) {
      return cell;
    }
  }

  return "";
}

/** Sheet labels use "Projector", "Projection", "Proj.", etc. */
function hasProjectionFamily(text: string): boolean {
  return (
    text.includes("projector") ||
    text.includes("projection") ||
    text.includes("pixaplay") ||
    /\bproj[.\s]/.test(text) ||
    text.includes("pjt")
  );
}

function hasMonitorFamily(text: string): boolean {
  return /\bmonitor(s)?\b/.test(text) || text.includes("mntr");
}

/** Smart watches / bands — often mis-tagged "Monitor" on marketplace masters. */
function hasWearableFamily(text: string): boolean {
  return (
    /\b(smart\s*)?(fitness\s*)?watch(es)?\b/.test(text) ||
    /\bzeb[\s-]*fit\d+/i.test(text) ||
    (text.includes("fitness") && text.includes("band") && !text.includes("monitor"))
  );
}

export function isWearableProductName(productName: string): boolean {
  return hasWearableFamily(normalizeKey(productName));
}

/**
 * Desk mounts / arms — not display panels.
 * Amazon sheet: Sub Category "Monitor Arm". Models: Zeb-DMS*, DM5200 / DM5500 style (DM + digits).
 */
function hasMonitorArmFamily(text: string): boolean {
  const t = text.toLowerCase();
  if (/\bdms\d{2,4}\b/i.test(t)) return true;
  if (/\bdm\d{3,5}\b/i.test(t)) return true;
  if (/\bmonitor\s+arms?\b/.test(t)) return true;
  if (t.includes("desk mount") && t.includes("monitor") && /\b(arm|bracket)\b/.test(t)) return true;
  return false;
}

/**
 * Maps master sheet Category + Sub Category to stored keys (same ingest path for every product type).
 * Combines columns so values split across Category / Sub Category still match (e.g. "Projection" + "Screen").
 * `productName` is included so model codes (e.g. DMS500) classify even when the sheet says "Monitor".
 */
function normalizedSubCategory(
  rawSubCategory: string,
  rawCategory: string,
  productName: string,
): SubCategory | null {
  const sub = normalizeKey(rawSubCategory);
  const cat = normalizeKey(rawCategory);
  const hay = buildSelloutClassificationHaystack(rawCategory, rawSubCategory, productName);
  const hasProj = hasProjectionFamily(hay);

  if (
    normalizeKey(rawCategory) === "cartridge" ||
    normalizeKey(rawSubCategory) === "cartridge"
  ) {
    return "cartridge";
  }

  if (hasWearableFamily(hay)) return null;
  if (isExcludedNonDisplaySelloutProduct(hay)) return null;

  const hasScreenToken =
    /\bscreen(s)?\b/.test(hay) || hay.includes("projection screen");

  if (hasScreenToken && !hasMonitorFamily(hay)) return "projector_screen";

  if (hasMonitorArmFamily(hay) && !hasProj) return "monitor_arm";

  if (hasMonitorFamily(hay) && !hasProj) {
    const subIsMonitor = sub === "monitor" || sub === "monitors";
    if (subIsMonitor || looksLikeDisplayMonitor(hay)) {
      return "monitor";
    }
    return null;
  }

  if (
    sub === "projector" ||
    sub === "projectors" ||
    cat === "projector" ||
    (hasProj && !hasScreenToken)
  ) {
    return "projector";
  }

  const subAsKey = sub.replace(/\s+/g, "_");
  if (
    CORE_SELL_OUT_SUB_CATEGORY_SET.has(subAsKey) &&
    TRACKED_SUB_CATEGORY_SET.has(subAsKey)
  ) {
    return subAsKey as SubCategory;
  }

  return null;
}

/** Classify HO stock / orphan rows from ERP model text when Product Master has no ASIN/FSN match. */
export function inferSubCategoryFromProductFields(
  productName: string,
  rawCategory = "",
  rawSubCategory = "",
): SubCategory | null {
  return normalizedSubCategory(rawSubCategory, rawCategory, productName);
}

function detectHeaderRow(rows: unknown[][]): number {
  let bestRowIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < Math.min(rows.length, 60); i += 1) {
    const normalized = (rows[i] ?? []).map((cell) => normalizeKey(cell));

    const hasCode = normalized.some((cell) =>
      COLUMN_ALIASES.productCode.some((alias) => cell.includes(alias)),
    );
    if (!hasCode) continue;

    const score =
      Number(
        normalized.some((cell) =>
          COLUMN_ALIASES.productName.some((alias) => cell.includes(alias)),
        ),
      ) +
      Number(
        normalized.some((cell) =>
          COLUMN_ALIASES.subCategory.some((alias) => cell.includes(alias)),
        ),
      ) +
      Number(
        normalized.some((cell) =>
          COLUMN_ALIASES.category.some((alias) => cell.includes(alias)),
        ),
      ) +
      Number(
        normalized.some((cell) =>
          COLUMN_ALIASES.totalSo.some((alias) => cell.includes(alias)),
        ),
      ) +
      Number(
        normalized.some((cell) => headerLooksLikeInventory(cell)),
      ) +
      Number(
        normalized.some((cell) =>
          COLUMN_ALIASES.drr.some((alias) => cell.includes(alias)),
        ),
      );

    if (score > bestScore) {
      bestScore = score;
      bestRowIndex = i;
    }
  }

  return bestScore >= 0 ? bestRowIndex : 0;
}

function monthTokenFromDate(dateString: string): string {
  const d = new Date(`${dateString}T00:00:00`);
  return d
    .toLocaleString("en-US", { month: "short" })
    .toLowerCase()
    .slice(0, 3);
}

function previousMonthTokenFromDate(dateString: string): string {
  const d = new Date(`${dateString}T00:00:00`);
  d.setMonth(d.getMonth() - 1);
  return d
    .toLocaleString("en-US", { month: "short" })
    .toLowerCase()
    .slice(0, 3);
}

/** Calendar month before the upload snapshot (YYYY-MM). */
export function previousCalendarMonthYm(snapshotDate: string): string {
  const d = new Date(`${snapshotDate}T12:00:00`);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function headerHasMtdToken(header: string, monthToken: string): boolean {
  if (!header || !header.includes(monthToken)) return false;
  return (
    header.includes(`${monthToken} mtd`) ||
    header === `${monthToken}mtd` ||
    COLUMN_ALIASES.mtd.some((alias) => header.includes(alias))
  );
}

function findCurrentMonthMtdIndex(headers: string[], snapshotDate: string): number {
  const snap = new Date(`${snapshotDate}T12:00:00`);
  const currentYearStr = String(snap.getFullYear());
  const priorYearStr = String(snap.getFullYear() - 1);
  const monthToken = monthTokenFromDate(snapshotDate);
  const matches = (header: string): boolean => {
    if (!headerHasMtdToken(header, monthToken)) return false;
    /** **2025 May MTD** is prior-year same period — never the current-month MTD column. */
    if (header.includes(priorYearStr) && !header.includes(currentYearStr)) return false;
    if (header.includes(currentYearStr)) return true;
    return !/\b20\d{2}\b/.test(header);
  };
  /** Skip NLC / inventory MTD picks (e.g. "May. MTD NLC") when a plain "May MTD" column exists. */
  let fallback = -1;
  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    if (!matches(header)) continue;
    if (fallback < 0) fallback = i;
    if (!header.includes("nlc")) return i;
  }
  return fallback;
}

/**
 * Sheet column **2025 May MTD** — prior calendar year, same month & same day-range as the report
 * (e.g. May 1–20, 2025 when the file is as-on 24 May 2026). Used for YoY MTD comparison only.
 */
function findPriorYearMtdIndex(headers: string[], snapshotDate: string): number {
  const snap = new Date(`${snapshotDate}T12:00:00`);
  const priorYear = snap.getFullYear() - 1;
  const currentYear = snap.getFullYear();
  const monthToken = monthTokenFromDate(snapshotDate);
  const priorYearStr = String(priorYear);
  const currentYearStr = String(currentYear);
  let fallback = -1;
  let bestIdx = -1;
  let bestScore = -1;
  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    if (!header) continue;
    if (!headerHasMtdToken(header, monthToken)) continue;
    if (!header.includes(priorYearStr)) continue;
    if (header.includes(currentYearStr) && !header.includes(priorYearStr)) continue;

    let score = 1;
    if (header.startsWith(priorYearStr)) score += 2;
    if (header.includes(`${priorYearStr} ${monthToken}`)) score += 2;

    if (header.includes("nlc")) {
      if (fallback < 0) fallback = i;
      continue;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx >= 0 ? bestIdx : fallback;
}

/**
 * FK IT **Apr-25** = previous month full SO (not **26-Apr**, which is a day-style header).
 * The `-25` suffix is FY shorthand, not always calendar year on the snapshot date.
 */
function findFlipkartPreviousMonthSoIndex(
  headers: string[],
  rawHeaders: string[],
  snapshotDate: string,
): number {
  const prevMonthToken = previousMonthTokenFromDate(snapshotDate);
  const prevCap = prevMonthToken.charAt(0).toUpperCase() + prevMonthToken.slice(1);
  const fkMonthCol = new RegExp(`^${prevCap}[-\\s'](\\d{2})$`, "i");
  let bestIdx = -1;
  let bestScore = -1;

  for (let i = 0; i < rawHeaders.length; i += 1) {
    const raw = String(rawHeaders[i] ?? "").trim();
    const h = headers[i] ?? "";
    if (!raw || !h) continue;
    if (/^\d{1,2}[-\s/]/i.test(raw)) continue;

    if (fkMonthCol.test(raw)) {
      const score = 6;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
      continue;
    }

    const hasSoAlias = COLUMN_ALIASES.prevMonthSo.some((alias) => h.includes(alias));
    const monthWord = new RegExp(`\\b${prevMonthToken}\\b`);
    let score = -1;
    if (h === `${prevMonthToken} so`) score = 5;
    else if (h === prevMonthToken) score = 4;
    else if (monthWord.test(h) && hasSoAlias) score = 3;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Amazon / generic: calendar prior month via parsed YYYY-MM on **Apr-25** / **Apr 2026**. */
function findPreviousMonthSoIndex(
  headers: string[],
  rawHeaders: string[],
  snapshotDate: string,
  marketplace: Marketplace,
): number {
  if (marketplace === "flipkart") {
    return findFlipkartPreviousMonthSoIndex(headers, rawHeaders, snapshotDate);
  }

  const prevYm = previousCalendarMonthYm(snapshotDate);
  const prevMonthToken = previousMonthTokenFromDate(snapshotDate);
  const monthWord = new RegExp(`\\b${prevMonthToken}\\b`);
  let bestIdx = -1;
  let bestScore = -1;

  for (let i = 0; i < headers.length; i += 1) {
    const raw = rawHeaders[i] ?? "";
    const h = headers[i] ?? "";
    if (!h) continue;

    const iso = parseEventSoMonthColumnDate(raw);
    if (iso && iso.slice(0, 7) === prevYm) {
      const score = 4;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
      continue;
    }

    const hasSoAlias = COLUMN_ALIASES.prevMonthSo.some((alias) => h.includes(alias));
    const looksLikeDayColumn = /^\d/.test(h.trim());

    let score = -1;
    if (h === `${prevMonthToken} so`) score = 5;
    else if (h === prevMonthToken) score = 4;
    else if (monthWord.test(h) && hasSoAlias && !looksLikeDayColumn) score = 2;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** FK IT: **May MTD** or **May-25** (report month) when there is no literal "MTD" in the header. */
function findFlipkartCurrentMonthMtdIndex(
  headers: string[],
  rawHeaders: string[],
  snapshotDate: string,
): number {
  const monthToken = monthTokenFromDate(snapshotDate);
  const monthCap = monthToken.charAt(0).toUpperCase() + monthToken.slice(1);
  const fkReportMonth = new RegExp(`^${monthCap}[-\\s'](\\d{2})$`, "i");

  let bestIdx = -1;
  let bestScore = -1;
  for (let i = 0; i < headers.length; i += 1) {
    const raw = String(rawHeaders[i] ?? "").trim();
    const h = headers[i] ?? "";
    if (!h) continue;

    if (headerHasMtdToken(h, monthToken)) {
      const score = h.includes("nlc") ? 2 : 5;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
      continue;
    }

    if (fkReportMonth.test(raw) && !/^\d{1,2}[-\s/]/i.test(raw)) {
      const score = 4;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
  }
  return bestIdx >= 0 ? bestIdx : findCurrentMonthMtdIndex(headers, snapshotDate);
}

function monthIndexFromToken(token: string): number | undefined {
  return MONTH_LOOKUP[token.slice(0, 3).toLowerCase()];
}

/**
 * Event SO month columns on the master — one total per calendar month.
 * Supports **Apr-25**, **Apr 25**, **2026 Apr** (AZ workbook with year-above-month headers), **Apr 2026**.
 * Day-level headers (4-May, 30-Apr) and KPI cells (May MTD, Apr SO) are excluded.
 */
export function parseEventSoMonthColumnDate(rawHeader: string): string | null {
  const cleaned = String(rawHeader ?? "")
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return null;
  if (/\bMTD\b/i.test(cleaned)) return null;
  if (/^([A-Za-z]{3,9})\s+SO$/i.test(cleaned)) return null;

  const toIso = (year: number, monthIndex: number | undefined): string | null => {
    if (!Number.isFinite(year) || monthIndex === undefined) return null;
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
  };

  let match = /^([A-Za-z]{3,9})[-\s'](\d{2,4})$/i.exec(cleaned);
  if (match) {
    const monthIndex = monthIndexFromToken(match[1]);
    const rawYear = Number(match[2]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return toIso(year, monthIndex);
  }

  match = /^(\d{4})\s+([A-Za-z]{3,9})$/i.exec(cleaned);
  if (match) {
    return toIso(Number(match[1]), monthIndexFromToken(match[2]));
  }

  match = /^([A-Za-z]{3,9})\s+(\d{4})$/i.exec(cleaned);
  if (match) {
    return toIso(Number(match[2]), monthIndexFromToken(match[1]));
  }

  return null;
}

export type EventSoMonthColumn = { index: number; date: string; priority: number };

/**
 * FK consolidated sheets often store daily headers as Excel serials (e.g. 46167).
 * Convert those day columns into month anchors so prior-FY month shapes are recoverable.
 */
function parseExcelSerialHeaderToMonthDate(rawHeader: string): string | null {
  const trimmed = String(rawHeader ?? "").trim();
  if (!/^\d{5}$/.test(trimmed)) return null;
  const serial = Number(trimmed);
  if (!Number.isFinite(serial) || serial < 30000 || serial > 80000) return null;
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed || !parsed.y || !parsed.m) return null;
  return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-01`;
}

/** Event SO month columns (**Apr-25**, **Mar-25**, …). FK **26-Apr** day-style headers are excluded. */
export function buildEventSoMonthColumns(
  rawHeaders: string[],
  _snapshotDate: string,
  marketplace: Marketplace,
): EventSoMonthColumn[] {
  const out: EventSoMonthColumn[] = [];
  for (let index = 0; index < rawHeaders.length; index += 1) {
    const raw = rawHeaders[index] ?? "";
    if (marketplace === "flipkart" && /^\d{1,2}[-\s/][A-Za-z]{3,9}$/i.test(String(raw).trim())) {
      continue;
    }
    const standard = parseEventSoMonthColumnDate(raw);
    if (standard) {
      out.push({ index, date: standard, priority: 2 });
      continue;
    }
    if (marketplace === "flipkart") {
      const fromSerial = parseExcelSerialHeaderToMonthDate(raw);
      /** Serial date columns in FK consolidated exports are typically day-wise cumulative snapshots. */
      if (fromSerial) out.push({ index, date: fromSerial, priority: 1 });
    }
  }
  return out;
}

/** Flipkart-style **FY 2025 -26 SO** year-total columns (not Apr-25 month columns). */
export function parseFySoColumnFyStart(rawHeader: string): number | null {
  const norm = normalizeKey(rawHeader);
  if (!norm.includes("fy") || !norm.includes("so")) return null;
  // "FY 2025-26 SO" → fy 2025 26 so | "FY 2025 -26 SO" → fy 2025 26 so
  let match = /fy\s*(\d{4})\s*[-–]\s*(\d{2,4})\s*so/.exec(norm);
  if (!match) match = /fy\s*(\d{4})\s+(\d{2,4})\s+so/.exec(norm);
  if (!match) return null;
  const startYear = Number(match[1]);
  if (!Number.isFinite(startYear)) return null;
  return startYear;
}

/**
 * Spread FY SO only into months without Event SO month columns on this row.
 * Skips entirely when month columns already cover the FY total (avoids ~2× prior-year charts).
 */
function spreadFySoToMonthlySales(
  fySoUnits: number,
  fyStart: number,
  marketplace: Marketplace,
  productCode: string,
  monthlySelloutByKey: Map<string, DailySale>,
  monthlyColumns: EventSoMonthColumn[],
  row: unknown[],
): void {
  if (fySoUnits <= 0) return;

  /** AZ-style masters already have **2025 Apr** … **2026 Mar** columns — never spread FY totals. */
  if (
    monthlyColumns.some((col) => fyStartForMonthYm(col.date.slice(0, 7)) === fyStart)
  ) {
    return;
  }

  const monthSum = monthColumnSumForFy(row, monthlyColumns, fyStart);
  if (monthSum >= fySoUnits * 0.99) return;

  const emptySaleDates: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const calMonth = (3 + i) % 12;
    const year = i < 9 ? fyStart : fyStart + 1;
    const saleDate = `${year}-${String(calMonth + 1).padStart(2, "0")}-01`;
    if (monthColumnUnitsAtSaleDate(row, monthlyColumns, saleDate) <= 0) {
      emptySaleDates.push(saleDate);
    }
  }

  /** No month-level columns for this FY — keep total on prior_fy_so_units only (no fake flat MoM). */
  if (emptySaleDates.length === 12) return;

  const remainder = Math.max(0, fySoUnits - monthSum);
  const addEach = remainder / emptySaleDates.length;

  for (const saleDate of emptySaleDates) {
    if (addEach <= 0) continue;
    const saleMapKey = `${marketplace}:${productCode}:${saleDate}`;
    const prevSale = monthlySelloutByKey.get(saleMapKey);
    if (prevSale) {
      monthlySelloutByKey.set(saleMapKey, {
        ...prevSale,
        units_sold: safeUnitsSold(prevSale.units_sold) + safeUnitsSold(addEach),
      });
    } else {
      monthlySelloutByKey.set(saleMapKey, {
        marketplace,
        product_code: productCode,
        sale_date: saleDate,
        units_sold: safeUnitsSold(addEach),
      });
    }
  }
}

/** First sheet whose header row looks like the Flipkart master (FSN + Category or Sub Category + Remarks). */
function findFlipkartSheetByContent(
  buffer: ArrayBuffer,
  sheetNames: string[],
): string | undefined {
  for (const name of sheetNames) {
    const capped = readSheetProbeRows(buffer, name, 30, 90);
    if (capped.length < 2) continue;
    const headerRowIndex = detectHeaderRow(capped);
    const headers = (capped[headerRowIndex] ?? []).map((cell) => normalizeKey(cell));
    const hasCode = findColumnIndex(headers, ["fsn", "asin"]) >= 0;
    const hasSub = findColumnIndex(headers, COLUMN_ALIASES.subCategory) >= 0;
    const hasCat = findColumnIndex(headers, COLUMN_ALIASES.category) >= 0;
    const hasRemarks = findColumnIndex(headers, COLUMN_ALIASES.remarks) >= 0;
    if (hasCode && (hasSub || hasCat) && (hasRemarks || hasCat)) return name;
  }
  return undefined;
}

/** When the tab is not literally "Ecom Sellout" (e.g. "FK SO Report May 2026"). */
function resolveFlipkartSheetNameHeuristic(sheetNames: string[]): string | undefined {
  const nk = (s: string) => normalizeKey(s);
  const withTokens = sheetNames.find((n) => {
    const k = nk(n);
    return k.includes("ecom") && k.includes("sellout");
  });
  if (withTokens) return withTokens;

  const sellout = sheetNames.find((n) => nk(n).includes("sellout"));
  if (sellout) return sellout;

  return sheetNames.find((n) => {
    const k = nk(n);
    return (
      (k.includes("fk") && (k.includes("so") || k.includes("report"))) ||
      k.includes("flipkart")
    );
  });
}


type SheetColumnIndices = {
  inventoryIndex: number;
  totalSoIndex: number;
  currentMonthMtdIndex: number;
  priorYearMtdIndex: number;
  previousMonthSoIndex: number;
  drrIndex: number;
  drr7dAvgIndex: number;
  drr15dAvgIndex: number;
  drr28dAvgIndex: number;
  docIndex: number;
};

/**
 * Merges sheet Apr SO / May MTD (and optional Event SO dailies) into upload maps.
 * EOL rows use `includeDailySales: false` but still land in product_master + computed_metrics
 * so category Apr totals match Excel pivots.
 */
function accumulateRowIntoUploadMaps(
  row: unknown[],
  opts: {
    marketplace: Marketplace;
    productCode: string;
    productName: string;
    category: string;
    subCategoryToStore: string;
    rawSubCategory: string;
    brand: string;
    mapKey: string;
    effectiveSnapshotDate: string;
    columnIndices: SheetColumnIndices;
    productsByKey: Map<string, ProductInput>;
    metricsByKey: Map<string, MetricInput>;
    monthlySelloutByKey: Map<string, DailySale>;
    monthlyColumns: EventSoMonthColumn[];
    fySoColumns: Array<{ index: number; fyStart: number }>;
    includeDailySales: boolean;
    categoryPriorYearMtdBySub: Map<string, number>;
  },
): void {
  const {
    marketplace,
    productCode,
    productName,
    category,
    subCategoryToStore,
    rawSubCategory,
    brand,
    mapKey,
    effectiveSnapshotDate,
    columnIndices,
    productsByKey,
    metricsByKey,
    monthlySelloutByKey,
    monthlyColumns,
    fySoColumns,
    includeDailySales,
    categoryPriorYearMtdBySub,
  } = opts;

  productsByKey.set(mapKey, {
    marketplace,
    product_code: productCode,
    product_name: productName,
    category: category || null,
    sub_category: rawSubCategory || String(subCategoryToStore),
    brand: brand || null,
  });

  const {
    inventoryIndex,
    totalSoIndex,
    currentMonthMtdIndex,
    priorYearMtdIndex,
    previousMonthSoIndex,
    drrIndex,
    drr7dAvgIndex,
    drr15dAvgIndex,
    drr28dAvgIndex,
    docIndex,
  } = columnIndices;

  const inventoryValue = inventoryIndex >= 0 ? asNumber(row[inventoryIndex]) : 0;
  const totalSoValue = totalSoIndex >= 0 ? asNumber(row[totalSoIndex]) : 0;
  const currentMonthMtdValue =
    currentMonthMtdIndex >= 0 ? asNumber(row[currentMonthMtdIndex]) : 0;
  const priorYearMtdValue = priorYearMtdIndex >= 0 ? asNumber(row[priorYearMtdIndex]) : 0;
  const previousMonthSoValue =
    previousMonthSoIndex >= 0 ? asNumber(row[previousMonthSoIndex]) : 0;
  const drrValue = drrIndex >= 0 ? asNumber(row[drrIndex]) : 0;
  const drr7dAvgValue = drr7dAvgIndex >= 0 ? asNumber(row[drr7dAvgIndex]) : 0;
  const drr15dAvgValue = drr15dAvgIndex >= 0 ? asNumber(row[drr15dAvgIndex]) : 0;
  const drr28dAvgValue = drr28dAvgIndex >= 0 ? asNumber(row[drr28dAvgIndex]) : 0;
  const docValue = docIndex >= 0 ? asNumber(row[docIndex]) : 0;

  const aprSo = Math.max(0, previousMonthSoValue);
  const mayMtd = Math.max(0, currentMonthMtdValue);
  const totalSo = Math.max(0, totalSoValue);
  const inv = Math.max(0, inventoryValue);
  const drr28dAvg = roundSheetDrrUnits(drr28dAvgValue);
  const drr = resolveSelloutDrrUnits(
    marketplace,
    drrValue,
    drr7dAvgValue,
    drr15dAvgValue,
  );

  const reportFyStart = getCurrentFyStart(new Date(`${effectiveSnapshotDate}T12:00:00`));
  const priorFyStart = reportFyStart - 1;
  let priorFySo = 0;
  for (const fyCol of fySoColumns) {
    if (fyCol.fyStart !== priorFyStart) continue;
    priorFySo += Math.max(0, asNumber(row[fyCol.index]));
  }

  const existingMetric = metricsByKey.get(mapKey);
  if (existingMetric) {
    metricsByKey.set(mapKey, {
      ...existingMetric,
      inventory_units: inv,
      total_so_units: Math.max(existingMetric.total_so_units, totalSo),
      may_mtd_units: existingMetric.may_mtd_units + mayMtd,
      apr_so_units: existingMetric.apr_so_units + aprSo,
      prior_year_mtd_units: Math.max(
        existingMetric.prior_year_mtd_units ?? 0,
        priorYearMtdValue,
      ),
      prior_fy_so_units: Math.max(existingMetric.prior_fy_so_units ?? 0, priorFySo),
      drr_units: drr,
      drr_28d_avg_units: drr28dAvg,
      doc_days_excel: docIndex >= 0 ? docValue : null,
    });
  } else {
    metricsByKey.set(mapKey, {
      marketplace,
      product_code: productCode,
      as_of_date: effectiveSnapshotDate,
      inventory_units: inv,
      total_so_units: totalSo,
      may_mtd_units: mayMtd,
      apr_so_units: aprSo,
      prior_year_mtd_units: priorYearMtdValue,
      prior_fy_so_units: priorFySo,
      drr_units: drr,
      drr_28d_avg_units: drr28dAvg,
      doc_days_excel: docIndex >= 0 ? docValue : null,
    });
  }

  if (priorYearMtdValue > 0) {
    categoryPriorYearMtdBySub.set(
      subCategoryToStore,
      (categoryPriorYearMtdBySub.get(subCategoryToStore) ?? 0) + priorYearMtdValue,
    );
  }

  if (!includeDailySales) return;

  for (const fyCol of fySoColumns) {
    if (fyCol.fyStart !== priorFyStart) continue;
    const fySo = Math.max(0, asNumber(row[fyCol.index]));
    spreadFySoToMonthlySales(
      fySo,
      fyCol.fyStart,
      marketplace,
      productCode,
      monthlySelloutByKey,
      monthlyColumns,
      row,
    );
  }

  const monthUnitsByDate = new Map<string, { units: number; priority: number }>();
  for (const monthColumn of monthlyColumns) {
    const units = Math.max(0, asNumber(row[monthColumn.index]));
    if (units <= 0) continue;
    const prev = monthUnitsByDate.get(monthColumn.date);
    if (!prev || monthColumn.priority > prev.priority) {
      monthUnitsByDate.set(monthColumn.date, {
        units,
        priority: monthColumn.priority,
      });
    } else if (monthColumn.priority === prev.priority) {
      monthUnitsByDate.set(monthColumn.date, {
        /**
         * Priority 2 = true month columns (Apr-25 etc): additive across sheets/rows.
         * Priority 1 = Excel-serial daily columns: treat as cumulative snapshots; take max per month.
         */
        units: monthColumn.priority === 1 ? Math.max(prev.units, units) : prev.units + units,
        priority: monthColumn.priority,
      });
    }
  }
  for (const [saleDate, { units }] of monthUnitsByDate) {
    const saleMapKey = `${marketplace}:${productCode}:${saleDate}`;
    const prevSale = monthlySelloutByKey.get(saleMapKey);
    if (prevSale) {
      monthlySelloutByKey.set(saleMapKey, {
        ...prevSale,
        units_sold: safeUnitsSold(prevSale.units_sold) + safeUnitsSold(units),
      });
    } else {
      monthlySelloutByKey.set(saleMapKey, {
        marketplace,
        product_code: productCode,
        sale_date: saleDate,
        units_sold: safeUnitsSold(units),
      });
    }
  }
}

export type ParseUploadProgress = {
  message: string;
};

export type ParseUploadOptions = {
  catalogWorkspace?: CatalogWorkspace;
  /** daWg workbook: Amazon / Flipkart tabs and Gaming - daWg + Personal Audio categories. */
  dawgWorkbook?: boolean;
  /** Pravin workbook: Cocoblu_SO + Click_tect_SO (Amazon) or Flipkart tab; ROMA + PowerBank only. */
  pravinWorkbook?: boolean;
  onProgress?: (update: ParseUploadProgress) => void;
};

export type ParseSelloutBufferInput = {
  fileName: string;
  marketplace: Marketplace;
  snapshotDate: string;
  catalogWorkspace?: CatalogWorkspace;
  dawgWorkbook?: boolean;
  pravinWorkbook?: boolean;
  flipkartEolFromDb: Set<string>;
  onProgress?: (update: ParseUploadProgress) => void;
};

function buildNeededColumnIndices(
  fixedIndices: number[],
  monthlyColumns: Array<{ index: number }>,
  fySoColumns: Array<{ index: number }>,
): number[] {
  const indices = new Set<number>();
  for (const idx of fixedIndices) {
    if (idx >= 0) indices.add(idx);
  }
  for (const col of monthlyColumns) indices.add(col.index);
  for (const col of fySoColumns) indices.add(col.index);
  return [...indices].sort((a, b) => a - b);
}

function* iterateSparseDataRows(
  worksheet: XLSX.WorkSheet,
  headerRowIndex: number,
  neededCols: number[],
  productCodeIndex: number,
  lastRow: number,
): Generator<{ sheetRow: number; values: unknown[] }, void, void> {
  const maxCol = neededCols[neededCols.length - 1] ?? 0;
  for (let sheetRow = headerRowIndex + 1; sheetRow <= lastRow; sheetRow += 1) {
    const values = new Array<unknown>(maxCol + 1).fill("");
    let hasCode = false;
    for (const col of neededCols) {
      const val = readWorksheetCellValue(worksheet, sheetRow, col);
      values[col] = val;
      if (col === productCodeIndex && String(val ?? "").trim()) {
        hasCode = true;
      }
    }
    if (hasCode) yield { sheetRow, values };
  }
}

function compactDailySales(sales: DailySale[]): DailySale[] {
  const compact: DailySale[] = [];
  for (const sale of sales) {
    const units = safeUnitsSold(sale.units_sold);
    if (units > 0) compact.push({ ...sale, units_sold: units });
  }
  return compact;
}

const DAWG_SELL_OUT_PIPELINE_SUB = "monitor" as SubCategory;

function resolveDawgSelloutSubCategory(
  category: string,
  productName: string,
): SubCategory | null {
  if (!isDawgSheetCategory(category) || !productName.trim()) return null;
  return DAWG_SELL_OUT_PIPELINE_SUB;
}

function resolvePravinSelloutSheetNames(
  sheetNames: string[],
  marketplace: Marketplace,
  buffer: ArrayBuffer,
): string[] {
  if (marketplace === "flipkart") {
    const flipkartTab = sheetNames.find((name) => normalizeKey(name) === "flipkart");
    if (flipkartTab) return [flipkartTab];
    const byContent = findFlipkartSheetByContent(buffer, sheetNames);
    if (byContent) return [byContent];
    throw new Error(
      'Pravin sellout workbook must include a "Flipkart" tab (or a sheet with FSN + Sub Category).',
    );
  }
  const amazonTabs = sheetNames.filter((name) => {
    const key = normalizeKey(name);
    // normalizeKey replaces _ and - with spaces, strips dots
    // Cocoblu_SO  → "cocoblu so"
    // Click_tect_SO → "click tect so"
    // Cocoblu_HIS. → "cocoblu his"
    if (key === "amazon" || key === normalizeKey(ECOM_SELLOUT_SHEET)) return true;
    // Exclude history / summary tabs
    if (key.endsWith(" his") || key.includes(" his ") || key === "gms" || key === "eol") {
      return false;
    }
    // Include any SO tab (sellout only) that looks like Cocoblu or Click_tect
    if (
      key.endsWith(" so") &&
      (key.startsWith("cocoblu") || key.includes("click") || key.includes("tect"))
    ) {
      return true;
    }
    return false;
  });
  if (amazonTabs.length > 0) return amazonTabs;
  throw new Error(
    'Pravin Amazon sellout workbook must include Cocoblu_SO and/or Click_tect_SO tabs.',
  );
}

function resolveSelloutSheetName(
  sheetNames: string[],
  marketplace: Marketplace,
  dawgWorkbook: boolean,
  buffer: ArrayBuffer,
  pravinWorkbook = false,
): string {
  if (pravinWorkbook) {
    return resolvePravinSelloutSheetNames(sheetNames, marketplace, buffer)[0]!;
  }
  if (dawgWorkbook) {
    if (marketplace === "amazon") {
      const amazonTab = sheetNames.find((name) => normalizeKey(name) === "amazon");
      if (amazonTab) return amazonTab;
      const ecom = sheetNames.find(
        (name) => normalizeKey(name) === normalizeKey(ECOM_SELLOUT_SHEET),
      );
      if (ecom) return ecom;
      throw new Error(
        'daWg sellout workbook must include an "Amazon" tab (or "Ecom Sellout").',
      );
    }
    const flipkartTab = sheetNames.find((name) => normalizeKey(name) === "flipkart");
    if (flipkartTab) return flipkartTab;
    const ecom = sheetNames.find(
      (name) => normalizeKey(name) === normalizeKey(ECOM_SELLOUT_SHEET),
    );
    if (ecom) return ecom;
    const byContent = findFlipkartSheetByContent(buffer, sheetNames);
    if (byContent) return byContent;
    throw new Error(
      'daWg sellout workbook must include a "Flipkart" tab (or "Ecom Sellout").',
    );
  }

  if (marketplace === "amazon") {
    const strictEcomSheet = sheetNames.find(
      (name) => normalizeKey(name) === normalizeKey(ECOM_SELLOUT_SHEET),
    );
    if (!strictEcomSheet) {
      throw new Error(
        `Amazon uploads must contain the "${ECOM_SELLOUT_SHEET}" sheet.`,
      );
    }
    return strictEcomSheet;
  }

  const sheetName =
    sheetNames.find(
      (name) => normalizeKey(name) === normalizeKey(ECOM_SELLOUT_SHEET),
    ) ??
    resolveFlipkartSheetNameHeuristic(sheetNames) ??
    findFlipkartSheetByContent(buffer, sheetNames);
  if (!sheetName) {
    throw new Error(
      `Flipkart file has no usable sheet. Use a tab named "${ECOM_SELLOUT_SHEET}", or include columns for product code (FSN), Category or Sub Category, and Remarks. Sheets in this file: ${sheetNames.join(", ")}`,
    );
  }
  return sheetName;
}

/** Parse sellout workbook bytes (runs on main thread or in a Web Worker). */
export function parseSelloutFromBuffer(
  buffer: ArrayBuffer,
  input: ParseSelloutBufferInput,
): ParsedUploadPayload {
  const {
    fileName,
    marketplace,
    snapshotDate,
    catalogWorkspace = "monitor_projector",
    dawgWorkbook: isDawgIngest = false,
    pravinWorkbook: isPravinIngest = false,
    flipkartEolFromDb,
    onProgress,
  } = input;
  const isKaranIngest =
    !isDawgIngest && !isPravinIngest && catalogWorkspace === CATALOG_WORKSPACE_PERSONAL_AUDIO;
  const isRithikaIngest =
    !isDawgIngest && !isPravinIngest && catalogWorkspace === CATALOG_WORKSPACE_RITHIKA;
  const isRishabhIngest =
    !isDawgIngest && !isPravinIngest && catalogWorkspace === CATALOG_WORKSPACE_HOME_AUDIO;
  const isPravinWorkspaceIngest =
    isPravinIngest || catalogWorkspace === CATALOG_WORKSPACE_PRAVIN;
  if (
    (isKaranIngest || isRithikaIngest || isRishabhIngest || isPravinWorkspaceIngest) &&
    marketplace !== "amazon" &&
    marketplace !== "flipkart"
  ) {
    throw new Error("Manager workspace uploads are only supported for Amazon and Flipkart.");
  }
  const parseStart = performance.now();
  console.log(
    `[upload] parse start: file=${fileName} size=${(buffer.byteLength / 1024).toFixed(0)}KB`,
  );

  const reportProgress = (message: string) => {
    onProgress?.({ message });
  };

  const effectiveSnapshotDate = resolveUploadSnapshotDate(fileName, snapshotDate);
  if (!isValidIsoDateString(effectiveSnapshotDate)) {
    throw new Error(
      'Set the sheet coverage date — the day the data is as on (e.g. 5 May), not the upload day. Or include it in the file name (e.g. till 5th May).',
    );
  }
  if (effectiveSnapshotDate !== snapshotDate) {
    console.log(
      `[upload] sheet coverage date from filename "${fileName}": ${effectiveSnapshotDate} (picker was "${snapshotDate}")`,
    );
  }

  reportProgress("Reading workbook…");
  const sheetListStart = performance.now();
  const sheetNames = readWorkbookSheetNames(buffer);
  console.log(
    `[upload] enumerate sheet names (${sheetNames.length} sheets): ${(performance.now() - sheetListStart).toFixed(0)}ms`,
  );

  const sheetNamesToParse = isPravinWorkspaceIngest
    ? resolvePravinSelloutSheetNames(sheetNames, marketplace, buffer)
    : [
        resolveSelloutSheetName(
          sheetNames,
          marketplace,
          isDawgIngest,
          buffer,
          isPravinWorkspaceIngest,
        ),
      ];
  if (marketplace === "flipkart") {
    console.log(`[upload] Flipkart sheet(s): ${sheetNamesToParse.join(", ")}`);
  }

  reportProgress(`Parsing ${sheetNamesToParse.join(" + ")}…`);
  const targetReadStart = performance.now();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    sheets: sheetNamesToParse,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
  });
  console.log(
    `[upload] parse target sheet(s) "${sheetNamesToParse.join('", "')}": ${(performance.now() - targetReadStart).toFixed(0)}ms`,
  );

  const productsByKey = new Map<string, ProductInput>();
  const metricsByKey = new Map<string, MetricInput>();
  const monthlySelloutByKey = new Map<string, DailySale>();
  const errors: ParsedUploadPayload["errors"] = [];
  const flipkartEolCollected = new Set<string>();
  const flipkartEolFsnsCollected = new Set<string>();
  const categoryPriorYearMtdBySub = new Map<string, number>();

  let rawCount = 0;
  let validCount = 0;
  let ignoredCount = 0;

  for (const sheetName of sheetNamesToParse) {
  const sheetStart = performance.now();
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" was not found in the workbook.`);
  }
  const sheetRange = worksheet["!ref"]
    ? XLSX.utils.decode_range(worksheet["!ref"])
    : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const headerScanMaxCol = Math.min(sheetRange.e.c, 120);
  const headerScanRows: unknown[][] = [];
  for (let row = 0; row <= Math.min(sheetRange.e.r, 59); row += 1) {
    headerScanRows.push(readWorksheetRowSlice(worksheet, row, headerScanMaxCol));
  }
  const headerRowIndex = detectHeaderRow(headerScanRows);
  const headerRow = readWorksheetRowSlice(worksheet, headerRowIndex, sheetRange.e.c);
  console.log(
    `[upload] header scan + row ${headerRowIndex} (${sheetRange.e.r + 1} sheet rows): ${(performance.now() - sheetStart).toFixed(0)}ms`,
  );

  const headers = headerRow.map((cell) => normalizeKey(cell));
  const rawHeaders = headerRow.map((cell) => String(cell ?? "").trim());
  const estimatedDataRows = Math.max(0, sheetRange.e.r - headerRowIndex);
  reportProgress(`Processing up to ${estimatedDataRows.toLocaleString()} rows…`);

  const productCodeIndex = findProductCodeColumnIndex(headers, marketplace);
  const productNameIndex = findProductNameColumnIndex(headers);
  const categoryIndex = findCategoryColumnIndex(headers);
  const subCategoryIndex = findColumnIndex(headers, COLUMN_ALIASES.subCategory);
  const brandIndex = findColumnIndex(headers, COLUMN_ALIASES.brand);
  const inventoryIndex = findInventoryColumnIndex(headers);
  const totalSoIndex = findColumnIndex(headers, COLUMN_ALIASES.totalSo);
  const currentMonthMtdIndex =
    marketplace === "flipkart"
      ? findFlipkartCurrentMonthMtdIndex(headers, rawHeaders, effectiveSnapshotDate)
      : findCurrentMonthMtdIndex(headers, effectiveSnapshotDate);
  const priorYearMtdIndex = findPriorYearMtdIndex(headers, effectiveSnapshotDate);
  const previousMonthSoIndex = findPreviousMonthSoIndex(
    headers,
    rawHeaders,
    effectiveSnapshotDate,
    marketplace,
  );
  const drrIndex = findColumnIndex(headers, COLUMN_ALIASES.drr);
  const drr7dAvgIndex = findColumnIndex(headers, selloutDrrFallbackAliases("flipkart"));
  const drr15dAvgIndex = findColumnIndex(headers, selloutDrrFallbackAliases("amazon"));
  const drr28dAvgIndex = findColumnIndex(headers, COLUMN_ALIASES.drr28dAvg);
  const docIndex = findColumnIndex(headers, COLUMN_ALIASES.doc);
  const remarksIndex = findColumnIndex(headers, COLUMN_ALIASES.remarks);
  const kamIndex = findColumnIndex(headers, COLUMN_ALIASES.kam);

  if (productCodeIndex < 0) {
    throw new Error(
      `Could not detect a product code column (ASIN/FSN/SKU) in sheet "${sheetName}".`,
    );
  }

  if (subCategoryIndex < 0 && categoryIndex < 0) {
    throw new Error(
      `Could not detect a "Category" or "Sub Category" column in sheet "${sheetName}". Need at least one (many masters put "Projector Screen" / "Projector Stand" in Category only).`,
    );
  }

  if (
    marketplace === "flipkart" &&
    remarksIndex < 0 &&
    !flipkartSheetAllowsMissingRemarks(headers, categoryIndex, {
      subCategoryOnly: isPravinWorkspaceIngest,
    })
  ) {
    throw new Error(
      `Flipkart uploads must include a "Remarks" column (Active / EOL) on sheet "${sheetName}".`,
    );
  }

  const monthlyColumns = buildEventSoMonthColumns(
    rawHeaders,
    effectiveSnapshotDate,
    marketplace,
  );

  const fySoColumns = rawHeaders
    .map((rawHeader, index) => {
      const fyStart = parseFySoColumnFyStart(rawHeader);
      return fyStart !== null ? { index, fyStart } : null;
    })
    .filter((item): item is { index: number; fyStart: number } => item !== null);

  const columnIndices: SheetColumnIndices = {
    inventoryIndex,
    totalSoIndex,
    currentMonthMtdIndex,
    priorYearMtdIndex,
    previousMonthSoIndex,
    drrIndex,
    drr7dAvgIndex,
    drr15dAvgIndex,
    drr28dAvgIndex,
    docIndex,
  };

  const categoryPriorYearMtdBySub = new Map<string, number>();

  const neededColumnIndices = buildNeededColumnIndices(
    [
      productCodeIndex,
      productNameIndex,
      categoryIndex,
      subCategoryIndex,
      brandIndex,
      inventoryIndex,
      totalSoIndex,
      currentMonthMtdIndex,
      priorYearMtdIndex,
      previousMonthSoIndex,
      drrIndex,
      drr7dAvgIndex,
      drr15dAvgIndex,
      drr28dAvgIndex,
      docIndex,
      remarksIndex,
      kamIndex,
    ],
    monthlyColumns,
    fySoColumns,
  );

  const rowLoopStart = performance.now();
  let processedRows = 0;
  for (const { sheetRow, values: row } of iterateSparseDataRows(
    worksheet,
    headerRowIndex,
    neededColumnIndices,
    productCodeIndex,
    sheetRange.e.r,
  )) {
    processedRows += 1;
    if (processedRows % 500 === 0) {
      reportProgress(`Processing rows… ${processedRows.toLocaleString()}`);
    }
    const rowNumber = sheetRow;
    const productCodeRaw = String(row[productCodeIndex] ?? "").trim();
    if (!productCodeRaw) continue;
    /** Flipkart FSN is case-insensitive; merge rows that differ only by casing (avoids split SKUs / dup lines). */
    const productCode =
      marketplace === "flipkart" ? productCodeRaw.toUpperCase() : productCodeRaw;
    rawCount += 1;

    let productName = pickProductModelName(
      row,
      headers,
      productCodeIndex,
      productNameIndex,
    );
    if (marketplace === "flipkart") {
      productName = enrichFlipkartProductName(productCode, productName);
    }

    const category = categoryIndex >= 0 ? String(row[categoryIndex] ?? "").trim() : "";
    const rawSubCategory =
      subCategoryIndex >= 0 ? String(row[subCategoryIndex] ?? "").trim() : "";
    const brand = brandIndex >= 0 ? String(row[brandIndex] ?? "").trim() : "";

    const legacyMarketplace = marketplace as "amazon" | "flipkart";
    const rithikaScopeBucket = isRithikaIngest
      ? normalizedRithikaSubCategory(
          rawSubCategory,
          category,
          productName,
          legacyMarketplace,
        )
      : null;
    const kamRaw = kamIndex >= 0 ? String(row[kamIndex] ?? "").trim() : "";

    const subCategoryToStore = isDawgIngest
      ? resolveDawgSelloutSubCategory(category, productName)
      : isKaranIngest
        ? normalizedKaranSubCategory(
            rawSubCategory,
            category,
            productName,
            legacyMarketplace,
          )
        : isPravinWorkspaceIngest
          ? normalizedPravinSubCategory(rawSubCategory, category, productName)
          : isRishabhIngest
            ? normalizedRishabhSubCategory(rawSubCategory, category, productName)
            : isRithikaIngest
              ? rawSubCategory.trim() || category.trim() || "Uncategorized"
              : normalizedSubCategory(rawSubCategory, category, productName);

    const remarksRaw =
      remarksIndex >= 0 ? String(row[remarksIndex] ?? "").trim() : "";
    /** Flipkart master file only: Remarks column equals EOL (not lifecycle text elsewhere). */
    const flipkartRemarksEol =
      marketplace === "flipkart" && normalizeKey(remarksRaw) === "eol";

    const isTrackedSubCategory = isDawgIngest
      ? subCategoryToStore !== null
      : isKaranIngest
        ? subCategoryToStore !== null &&
          KARAN_TRACKED_SUB_CATEGORY_SET.has(subCategoryToStore)
        : isPravinWorkspaceIngest
          ? subCategoryToStore !== null &&
            rowPassesPravinCategoryScope(category, rawSubCategory, productName)
          : isRishabhIngest
            ? subCategoryToStore !== null &&
              rowPassesRishabhCategoryScope(category, rawSubCategory, productName)
            : isRithikaIngest
            ? rithikaScopeBucket !== null &&
              rowPassesRithikaKamGate(kamRaw, legacyMarketplace, rithikaScopeBucket)
            : subCategoryToStore !== null && TRACKED_SUB_CATEGORY_SET.has(subCategoryToStore);

    // Flipkart Remarks = EOL: skip active dashboard / Event SO dailies, but keep Apr SO + May MTD for category charts.
    if (marketplace === "flipkart" && flipkartRemarksEol && isTrackedSubCategory) {
      const subStored = subCategoryToStore as string;
      if (productName) flipkartEolCollected.add(normalizeKey(productName));
      if (productCode) flipkartEolFsnsCollected.add(productCode.trim().toUpperCase());
      if (!productName) {
        errors.push({
          rowNumber: rowNumber + 1,
          reason: "Missing product name",
          payload: { productCode },
        });
      } else {
        accumulateRowIntoUploadMaps(row, {
          marketplace,
          productCode,
          productName,
          category,
          subCategoryToStore: subStored,
          rawSubCategory,
          brand,
          mapKey: `${marketplace}:${productCode}`,
          effectiveSnapshotDate,
          columnIndices,
          productsByKey,
          metricsByKey,
          monthlySelloutByKey,
          monthlyColumns,
          fySoColumns,
          includeDailySales: true,
          categoryPriorYearMtdBySub,
        });
        validCount += 1;
      }
      ignoredCount += 1;
      continue;
    }

    // Amazon: model EOL on Flipkart — same sheet-metric rule as above.
    if (
      marketplace === "amazon" &&
      productName &&
      flipkartEolFromDb.has(normalizeKey(productName)) &&
      isTrackedSubCategory
    ) {
      accumulateRowIntoUploadMaps(row, {
        marketplace,
        productCode,
        productName,
        category,
        subCategoryToStore: subCategoryToStore as string,
        rawSubCategory,
        brand,
        mapKey: `${marketplace}:${productCode}`,
        effectiveSnapshotDate,
        columnIndices,
        productsByKey,
        metricsByKey,
        monthlySelloutByKey,
        monthlyColumns,
        fySoColumns,
        includeDailySales: true,
        categoryPriorYearMtdBySub,
      });
      validCount += 1;
      ignoredCount += 1;
      continue;
    }

    // Amazon hardcoded legacy EOL ASINs (M/P): keep Apr/May for category roll-ups.
    if (
      !isKaranIngest &&
      !isRithikaIngest &&
      !isRishabhIngest &&
      marketplace === "amazon" &&
      isTrackedSubCategory
    ) {
      const eolByMasterList = isKnownEolProductCode(marketplace, productCodeRaw);
      const isMonitorOrProjector =
        subCategoryToStore === "monitor" ||
        subCategoryToStore === "monitor_arm" ||
        subCategoryToStore === "projector";
      if (isMonitorOrProjector && eolByMasterList) {
        accumulateRowIntoUploadMaps(row, {
          marketplace,
          productCode,
          productName,
          category,
          subCategoryToStore,
          rawSubCategory,
          brand,
          mapKey: `${marketplace}:${productCode}`,
          effectiveSnapshotDate,
          columnIndices,
          productsByKey,
          metricsByKey,
          monthlySelloutByKey,
          monthlyColumns,
          fySoColumns,
          includeDailySales: true,
          categoryPriorYearMtdBySub,
        });
        validCount += 1;
        ignoredCount += 1;
        continue;
      }
    }

    if (
      !subCategoryToStore ||
      ((isRithikaIngest || isRishabhIngest || isPravinWorkspaceIngest) &&
        !isTrackedSubCategory)
    ) {
      ignoredCount += 1;
      continue;
    }

    if (!productName) {
      errors.push({
        rowNumber: rowNumber + 1,
        reason: "Missing product name",
        payload: { productCode },
      });
      continue;
    }

    accumulateRowIntoUploadMaps(row, {
      marketplace,
      productCode,
      productName,
      category,
      subCategoryToStore,
      rawSubCategory,
      brand,
      mapKey: `${marketplace}:${productCode}`,
      effectiveSnapshotDate,
      columnIndices,
      productsByKey,
      metricsByKey,
      monthlySelloutByKey,
      monthlyColumns,
      fySoColumns,
      includeDailySales: true,
      categoryPriorYearMtdBySub,
    });

    validCount += 1;
  }
  console.log(
    `[upload] row loop "${sheetName}" (${rawCount} raw so far, ${validCount} valid): ${(performance.now() - rowLoopStart).toFixed(0)}ms`,
  );
  } // end sheetNamesToParse

  console.log(
    `[upload] all sheets (${rawCount} raw, ${validCount} valid, ${ignoredCount} skipped)`,
  );

  reportProgress("Building category roll-ups…");
  const categoryMonthlySellout = buildCategoryMonthlySelloutFromMaps(
    marketplace,
    monthlySelloutByKey,
    productsByKey,
    metricsByKey,
    effectiveSnapshotDate,
    catalogWorkspace,
    isDawgIngest,
    categoryPriorYearMtdBySub,
  );

  const products = [...productsByKey.values()];
  let cartridgeRowCount = 0;
  for (const product of products) {
    if (normalizeKey(product.category ?? "") === "cartridge") cartridgeRowCount += 1;
  }
  console.log(
    `[upload] ingest summary: ${products.length} products, ${cartridgeRowCount} Cartridge (Category column)`,
  );
  console.log(
    `[upload] parse TOTAL: ${(performance.now() - parseStart).toFixed(0)}ms`,
  );

  const dailySales = compactDailySales(
    [...monthlySelloutByKey.values()].map((sale) => ({
      ...sale,
      units_sold: safeUnitsSold(sale.units_sold),
    })),
  );
  console.log(
    `[upload] daily_sales compact: ${monthlySelloutByKey.size} -> ${dailySales.length} non-zero month rows`,
  );

  return {
    products,
    metricInputs: [...metricsByKey.values()],
    dailySales,
    categoryMonthlySellout,
    errors,
    rawCount,
    validCount,
    ignoredCount,
    cartridgeRowCount,
    flipkartEolModelNames: [...flipkartEolCollected],
    flipkartEolFsns: [...flipkartEolFsnsCollected],
  };
}

export async function parseUploadFile(
  file: File,
  marketplace: Marketplace,
  snapshotDate: string,
  options?: ParseUploadOptions,
): Promise<ParsedUploadPayload> {
  const catalogWorkspace = options?.catalogWorkspace ?? "monitor_projector";
  options?.onProgress?.({ message: "Loading file…" });

  let [buffer, flipkartEolFromDb] = await Promise.all([
    file.arrayBuffer(),
    marketplace === "amazon"
      ? import("./data").then((mod) => mod.getFlipkartEolModelNames())
      : Promise.resolve(new Set<string>()),
  ]);

  const bufferInput: ParseSelloutBufferInput = {
    fileName: file.name,
    marketplace,
    snapshotDate,
    catalogWorkspace,
    dawgWorkbook: options?.dawgWorkbook,
    pravinWorkbook: options?.pravinWorkbook,
    flipkartEolFromDb,
    onProgress: options?.onProgress,
  };

  const { parseSelloutInWorker, shouldParseSelloutInWorker } = await import(
    "./parse-upload-worker-client"
  );

  if (shouldParseSelloutInWorker(file.size)) {
    options?.onProgress?.({ message: "Parsing workbook in background…" });
    try {
      return await parseSelloutInWorker(buffer, bufferInput, options?.onProgress);
    } catch (workerError) {
      console.warn(
        "[upload] worker parse failed, retrying on main thread:",
        workerError,
      );
      options?.onProgress?.({ message: "Retrying parse on main thread…" });
      buffer = await file.arrayBuffer();
    }
  }

  return parseSelloutFromBuffer(buffer, bufferInput);
}

/**
 * Category chart totals: Event SO month columns (Apr-25, …) plus **report-month MTD** from the
 * sheet's May MTD (etc.) column — overwrites the in-progress calendar month so MoM is not zero.
 */
function buildCategoryMonthlySelloutFromMaps(
  marketplace: Marketplace,
  monthlySelloutByKey: Map<string, DailySale>,
  productsByKey: Map<string, ProductInput>,
  metricsByKey: Map<string, MetricInput>,
  snapshotDate: string,
  catalogWorkspace: CatalogWorkspace = "monitor_projector",
  dawgWorkbook = false,
  categoryPriorYearMtdBySub: Map<string, number> = new Map(),
): CategoryMonthlySelloutInput[] {
  const totals = new Map<string, number>();
  const isKaran = catalogWorkspace === CATALOG_WORKSPACE_PERSONAL_AUDIO;
  const isRithika = catalogWorkspace === CATALOG_WORKSPACE_RITHIKA;
  const isPravin = catalogWorkspace === CATALOG_WORKSPACE_PRAVIN;
  const isRishabh = catalogWorkspace === CATALOG_WORKSPACE_HOME_AUDIO;
  const trackedSet = isKaran
    ? KARAN_TRACKED_SUB_CATEGORY_SET
    : isRithika || isPravin || isRishabh
      ? null
      : TRACKED_SUB_CATEGORY_SET;

  const subAllowedForRollup = (sub: string): boolean => {
    if (dawgWorkbook || isRithika || isPravin || isRishabh) return Boolean(sub);
    return trackedSet!.has(sub);
  };

  const rollupSub = (product: ProductInput | undefined): string | null => {
    if (!product) return null;
    if (dawgWorkbook && isDawgSheetCategory(product.category ?? "")) {
      const sub = String(product.sub_category ?? "").trim();
      return sub || null;
    }
    if (isRithika) {
      const sub = String(product.sub_category ?? "").trim();
      if (!sub || isLegacyRithikaStoredSubCategory(sub)) return null;
      if (marketplace !== "amazon" && marketplace !== "flipkart") return null;
      return normalizedRithikaSubCategory(
        sub,
        String(product.category ?? ""),
        product.product_name,
        marketplace,
      )
        ? sub
        : null;
    }
    if (isPravin) {
      const sub = String(product.sub_category ?? "").trim();
      if (!sub) return null;
      return rowPassesPravinCategoryScope(
        String(product.category ?? ""),
        sub,
        product.product_name,
      )
        ? sub
        : null;
    }
    if (isRishabh) {
      const sub = String(product.sub_category ?? "").trim();
      if (!sub) return null;
      return rowPassesRishabhCategoryScope(
        String(product.category ?? ""),
        sub,
        product.product_name,
      )
        ? sub
        : null;
    }
    if (isKaran) {
      const key = String(product.sub_category ?? "").trim();
      if (key && trackedSet?.has(key)) return key;
      const inferred =
        marketplace === "amazon" || marketplace === "flipkart"
          ? normalizedKaranSubCategory(
              String(product.sub_category ?? ""),
              String(product.category ?? ""),
              product.product_name,
              marketplace,
            )
          : null;
      return inferred;
    }
    const inferred = inferSubCategoryFromProductFields(
      product.product_name,
      product.category ?? "",
      product.sub_category ?? "",
    );
    return inferred;
  };

  for (const sale of monthlySelloutByKey.values()) {
    if (!/^\d{4}-\d{2}-01$/.test(sale.sale_date)) continue;
    const product = productsByKey.get(`${marketplace}:${sale.product_code}`);
    const sub = rollupSub(product);
    if (!sub) continue;
    if (!subAllowedForRollup(sub)) continue;
    const ym = sale.sale_date.slice(0, 7);
    const key = `${sub}|${ym}`;
    totals.set(key, (totals.get(key) ?? 0) + sale.units_sold);
  }

  const reportYm = snapshotDate.slice(0, 7);
  const mtdBySub = new Map<string, number>();
  for (const metric of metricsByKey.values()) {
    const product = productsByKey.get(`${marketplace}:${metric.product_code}`);
    const sub = rollupSub(product);
    if (!sub) continue;
    if (!subAllowedForRollup(sub)) continue;
    mtdBySub.set(sub, (mtdBySub.get(sub) ?? 0) + Math.max(0, metric.may_mtd_units));
  }
  for (const [sub, units] of mtdBySub) {
    totals.set(`${sub}|${reportYm}`, units);
  }

  const prevDate = new Date(`${snapshotDate}T12:00:00`);
  prevDate.setMonth(prevDate.getMonth() - 1);
  const prevYm = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  const aprBySub = new Map<string, number>();
  for (const metric of metricsByKey.values()) {
    const product = productsByKey.get(`${marketplace}:${metric.product_code}`);
    const sub = rollupSub(product);
    if (!sub) continue;
    if (!subAllowedForRollup(sub)) continue;
    aprBySub.set(sub, (aprBySub.get(sub) ?? 0) + Math.max(0, metric.apr_so_units));
  }
  for (const [sub, units] of aprBySub) {
    const key = `${sub}|${prevYm}`;
    if ((totals.get(key) ?? 0) <= 0 && units > 0) totals.set(key, units);
  }

  const snap = new Date(`${snapshotDate}T12:00:00`);
  const priorYearMtdMonthYm = `${snap.getFullYear() - 1}-${String(snap.getMonth() + 1).padStart(2, "0")}`;
  const priorYearMtdKey = priorYearMtdCategoryMonthKey(priorYearMtdMonthYm);

  const rows = [...totals.entries()].map(([key, units_sold]) => {
    const [sub_category, month_ym] = key.split("|") as [string, string];
    return { marketplace, sub_category, month_ym, units_sold: safeUnitsSold(units_sold) };
  });

  for (const [sub, units] of categoryPriorYearMtdBySub) {
    if (units <= 0) continue;
    if (!subAllowedForRollup(sub)) continue;
    rows.push({
      marketplace,
      sub_category: sub,
      month_ym: priorYearMtdKey,
      units_sold: safeUnitsSold(units),
    });
  }

  return rows;
}
