import * as XLSX from "xlsx";
import type {
  CategoryMonthlySelloutInput,
  DailySale,
  Marketplace,
  MetricInput,
  ParsedUploadPayload,
  ProductMaster,
  SubCategory,
} from "./types";
import { TRACKED_SUB_CATEGORY_SET } from "./types";
import { getFlipkartEolModelNames } from "./data";
import { isKnownEolProductCode } from "./eol";
import {
  asNumber,
  isValidIsoDateString,
  normalizeKey,
  resolveUploadSnapshotDate,
} from "./utils";

type ProductInput = Omit<
  ProductMaster,
  "id" | "created_at" | "updated_at" | "image_url"
>;

const COLUMN_ALIASES = {
  productCode: ["asin", "fsn", "sku", "product id", "item id", "model code"],
  productName: [
    "model name",
    "modelname",
    "model no",
    "model number",
    "model colour",
    "model name colour",
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
  subCategory: ["sub category", "subcategory", "sub-category", "sub cat"],
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
  drr: ["drr", "daily run rate"],
  doc: ["doc", "days of coverage", "days of cover"],
  /** Flipkart master: "Active" | "EOL" — sole source for Flipkart EOL (tracked sub-categories). */
  remarks: ["remarks", "remark"],
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

/** Sheet labels use "Projector", "Projection", "Proj.", etc. */
function hasProjectionFamily(text: string): boolean {
  return (
    text.includes("projector") ||
    text.includes("projection") ||
    /\bproj[.\s]/.test(text) ||
    text.includes("pjt")
  );
}

function hasMonitorFamily(text: string): boolean {
  return /\bmonitor(s)?\b/.test(text) || text.includes("mntr");
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
  const hay = normalizeKey(`${rawCategory} ${rawSubCategory} ${productName}`);
  const hasProj = hasProjectionFamily(hay);

  const hasScreenToken =
    /\bscreen(s)?\b/.test(hay) || hay.includes("projection screen");

  const hasStandToken =
    /\bstand(s)?\b/.test(hay) ||
    /\bmount(s)?\b/.test(hay) ||
    /\bbracket(s)?\b/.test(hay) ||
    /\btripod(s)?\b/.test(hay) ||
    hay.includes("ceiling mount");

  if (hasScreenToken && !hasMonitorFamily(hay)) return "projector_screen";

  if (hasStandToken && !hasMonitorFamily(hay)) {
    return "projector_stand";
  }

  if (
    /\bcartridge(s)?\b/.test(hay) ||
    /\btoner(s)?\b/.test(hay) ||
    /\bdrum(s)?\b/.test(hay)
  ) {
    return "cartridge";
  }

  if (hasMonitorArmFamily(hay) && !hasProj) return "monitor_arm";

  if (hasMonitorFamily(hay) && !hasProj) return "monitor";

  if (
    sub === "projector" ||
    sub === "projectors" ||
    cat === "projector" ||
    (hasProj && !hasScreenToken && !hasStandToken)
  ) {
    return "projector";
  }

  if (hasProj && hasStandToken) return "projector_stand";

  const subAsKey = sub.replace(/\s+/g, "_");
  if (TRACKED_SUB_CATEGORY_SET.has(subAsKey)) {
    return subAsKey as SubCategory;
  }

  return null;
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
        normalized.some((cell) =>
          COLUMN_ALIASES.inventory.some((alias) => cell.includes(alias)),
        ),
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

function findCurrentMonthMtdIndex(headers: string[], snapshotDate: string): number {
  const monthToken = monthTokenFromDate(snapshotDate);
  const matches = (header: string): boolean => {
    if (!header) return false;
    return (
      header.includes(`${monthToken} mtd`) ||
      header === `${monthToken}mtd` ||
      (header.includes(monthToken) &&
        COLUMN_ALIASES.mtd.some((alias) => header.includes(alias)))
    );
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
 * Prefer **Apr SO** (month + SO / sellout) over a plain **Apr** column, which is often a different metric.
 * Avoid day columns like **30-apr** → normalized `30 apr` (starts with a digit).
 */
function findPreviousMonthSoIndex(headers: string[], snapshotDate: string): number {
  const prevMonthToken = previousMonthTokenFromDate(snapshotDate);
  /** Avoid matching **April** when the token is **apr** (`includes` is too loose on normalized headers). */
  const monthWord = new RegExp(`\\b${prevMonthToken}\\b`);
  let bestIdx = -1;
  let bestScore = -1;
  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    if (!header) continue;
    const h = header;
    const hasSoAlias = COLUMN_ALIASES.prevMonthSo.some((alias) => h.includes(alias));
    const looksLikeDayColumn = /^\d/.test(h.trim());

    let score = -1;
    if (h === `${prevMonthToken} so`) score = 5;
    /** Plain **Apr** column (no SO suffix) — common on masters; must beat loose partial matches. */
    else if (h === prevMonthToken) score = 4;
    else if (monthWord.test(h) && hasSoAlias && !looksLikeDayColumn) score = 3;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Event SO month columns on the master (e.g. **Apr-25**, **May-25**) — one total per calendar month.
 * Day-level headers (4-May, 30-Apr) are excluded; category MoM uses these columns only.
 */
export function parseEventSoMonthColumnDate(rawHeader: string): string | null {
  const cleaned = String(rawHeader ?? "").trim();
  const match = /^([A-Za-z]{3,9})[-\s'](\d{2,4})$/i.exec(cleaned);
  if (!match) return null;
  const monthToken = match[1].slice(0, 3).toLowerCase();
  const month = MONTH_LOOKUP[monthToken];
  if (month === undefined) return null;
  const rawYear = Number(match[2]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/** First sheet whose header row looks like the Flipkart master (FSN + Category or Sub Category + Remarks). */
function findFlipkartSheetByContent(
  buffer: ArrayBuffer,
  sheetNames: string[],
): string | undefined {
  for (const name of sheetNames) {
    const workbook = XLSX.read(buffer, {
      type: "array",
      sheets: [name],
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
    });
    const worksheet = workbook.Sheets[name];
    if (!worksheet) continue;
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: "",
    }) as unknown[][];
    if (rows.length < 2) continue;
    const capped = rows.slice(0, Math.min(rows.length, 80));
    const headerRowIndex = detectHeaderRow(capped);
    const headers = (capped[headerRowIndex] ?? []).map((cell) => normalizeKey(cell));
    const hasCode =
      findColumnIndex(headers, COLUMN_ALIASES.productCode) >= 0;
    const hasSub =
      findColumnIndex(headers, COLUMN_ALIASES.subCategory) >= 0;
    const hasCat =
      findColumnIndex(headers, COLUMN_ALIASES.category) >= 0;
    const hasRemarks =
      findColumnIndex(headers, COLUMN_ALIASES.remarks) >= 0;
    if (hasCode && (hasSub || hasCat) && hasRemarks) return name;
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
  previousMonthSoIndex: number;
  drrIndex: number;
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
    subCategoryToStore: SubCategory;
    brand: string;
    mapKey: string;
    effectiveSnapshotDate: string;
    columnIndices: SheetColumnIndices;
    productsByKey: Map<string, ProductInput>;
    metricsByKey: Map<string, MetricInput>;
    monthlySelloutByKey: Map<string, DailySale>;
    monthlyColumns: Array<{ index: number; date: string }>;
    includeDailySales: boolean;
  },
): void {
  const {
    marketplace,
    productCode,
    productName,
    category,
    subCategoryToStore,
    brand,
    mapKey,
    effectiveSnapshotDate,
    columnIndices,
    productsByKey,
    metricsByKey,
    monthlySelloutByKey,
    monthlyColumns,
    includeDailySales,
  } = opts;

  productsByKey.set(mapKey, {
    marketplace,
    product_code: productCode,
    product_name: productName,
    category: category || null,
    sub_category: subCategoryToStore,
    brand: brand || null,
  });

  const {
    inventoryIndex,
    totalSoIndex,
    currentMonthMtdIndex,
    previousMonthSoIndex,
    drrIndex,
    docIndex,
  } = columnIndices;

  const inventoryValue = inventoryIndex >= 0 ? asNumber(row[inventoryIndex]) : 0;
  const totalSoValue = totalSoIndex >= 0 ? asNumber(row[totalSoIndex]) : 0;
  const currentMonthMtdValue =
    currentMonthMtdIndex >= 0 ? asNumber(row[currentMonthMtdIndex]) : 0;
  const previousMonthSoValue =
    previousMonthSoIndex >= 0 ? asNumber(row[previousMonthSoIndex]) : 0;
  const drrValue = drrIndex >= 0 ? asNumber(row[drrIndex]) : 0;
  const docValue = docIndex >= 0 ? asNumber(row[docIndex]) : 0;

  const aprSo = Math.max(0, previousMonthSoValue);
  const mayMtd = Math.max(0, currentMonthMtdValue);
  const totalSo = Math.max(0, totalSoValue);
  const inv = Math.max(0, inventoryValue);
  const drr = Math.max(0, drrValue);

  const existingMetric = metricsByKey.get(mapKey);
  if (existingMetric) {
    metricsByKey.set(mapKey, {
      ...existingMetric,
      inventory_units: inv,
      total_so_units: Math.max(existingMetric.total_so_units, totalSo),
      may_mtd_units: existingMetric.may_mtd_units + mayMtd,
      apr_so_units: existingMetric.apr_so_units + aprSo,
      drr_units: drr,
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
      drr_units: drr,
      doc_days_excel: docIndex >= 0 ? docValue : null,
    });
  }

  if (!includeDailySales) return;

  for (const monthColumn of monthlyColumns) {
    const units = Math.max(0, asNumber(row[monthColumn.index]));
    const saleMapKey = `${marketplace}:${productCode}:${monthColumn.date}`;
    const prevSale = monthlySelloutByKey.get(saleMapKey);
    if (prevSale) {
      monthlySelloutByKey.set(saleMapKey, {
        ...prevSale,
        units_sold: prevSale.units_sold + units,
      });
    } else {
      monthlySelloutByKey.set(saleMapKey, {
        marketplace,
        product_code: productCode,
        sale_date: monthColumn.date,
        units_sold: units,
      });
    }
  }
}

export async function parseUploadFile(
  file: File,
  marketplace: Marketplace,
  snapshotDate: string,
): Promise<ParsedUploadPayload> {
  const parseStart = performance.now();
  console.log(
    `[upload] parse start: file=${file.name} size=${(file.size / 1024).toFixed(0)}KB`,
  );

  const effectiveSnapshotDate = resolveUploadSnapshotDate(file.name, snapshotDate);
  if (!isValidIsoDateString(effectiveSnapshotDate)) {
    throw new Error(
      'Set the sheet coverage date — the day the data is as on (e.g. 5 May), not the upload day. Or include it in the file name (e.g. till 5th May).',
    );
  }
  if (effectiveSnapshotDate !== snapshotDate) {
    console.log(
      `[upload] sheet coverage date from filename "${file.name}": ${effectiveSnapshotDate} (picker was "${snapshotDate}")`,
    );
  }

  const fileReadStart = performance.now();
  const buffer = await file.arrayBuffer();
  console.log(
    `[upload] file -> arrayBuffer: ${(performance.now() - fileReadStart).toFixed(0)}ms`,
  );

  const sheetListStart = performance.now();
  const sheetList = XLSX.read(buffer, {
    type: "array",
    bookSheets: true,
  });
  console.log(
    `[upload] enumerate sheet names (${sheetList.SheetNames.length} sheets): ${(performance.now() - sheetListStart).toFixed(0)}ms`,
  );

  let sheetName: string | undefined;
  if (marketplace === "amazon") {
    const strictEcomSheet = sheetList.SheetNames.find(
      (name) => normalizeKey(name) === normalizeKey(ECOM_SELLOUT_SHEET),
    );
    if (!strictEcomSheet) {
      throw new Error(
        `Amazon uploads must contain the "${ECOM_SELLOUT_SHEET}" sheet.`,
      );
    }
    sheetName = strictEcomSheet;
  } else {
    sheetName =
      sheetList.SheetNames.find(
        (name) => normalizeKey(name) === normalizeKey(ECOM_SELLOUT_SHEET),
      ) ??
      findFlipkartSheetByContent(buffer, sheetList.SheetNames) ??
      resolveFlipkartSheetNameHeuristic(sheetList.SheetNames);
    if (!sheetName) {
      throw new Error(
        `Flipkart file has no usable sheet. Use a tab named "${ECOM_SELLOUT_SHEET}", or include columns for product code (FSN), Category or Sub Category, and Remarks. Sheets in this file: ${sheetList.SheetNames.join(", ")}`,
      );
    }
    console.log(`[upload] Flipkart sheet resolved to "${sheetName}"`);
  }

  const targetReadStart = performance.now();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    sheets: [sheetName],
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
  });
  console.log(
    `[upload] parse target sheet "${sheetName}": ${(performance.now() - targetReadStart).toFixed(0)}ms`,
  );

  const sheetStart = performance.now();
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];
  console.log(
    `[upload] sheet_to_json (${rows.length} rows): ${(performance.now() - sheetStart).toFixed(0)}ms`,
  );

  const headerRowIndex = detectHeaderRow(rows);
  const headers = (rows[headerRowIndex] ?? []).map((cell) => normalizeKey(cell));
  const rawHeaders = (rows[headerRowIndex] ?? []).map((cell) =>
    String(cell ?? "").trim(),
  );

  const productCodeIndex = findColumnIndex(headers, COLUMN_ALIASES.productCode);
  const productNameIndex = findColumnIndex(headers, COLUMN_ALIASES.productName);
  const categoryIndex = findColumnIndex(headers, COLUMN_ALIASES.category);
  const subCategoryIndex = findColumnIndex(headers, COLUMN_ALIASES.subCategory);
  const brandIndex = findColumnIndex(headers, COLUMN_ALIASES.brand);
  const inventoryIndex = findColumnIndex(headers, COLUMN_ALIASES.inventory);
  const totalSoIndex = findColumnIndex(headers, COLUMN_ALIASES.totalSo);
  const currentMonthMtdIndex = findCurrentMonthMtdIndex(headers, effectiveSnapshotDate);
  const previousMonthSoIndex = findPreviousMonthSoIndex(headers, effectiveSnapshotDate);
  const drrIndex = findColumnIndex(headers, COLUMN_ALIASES.drr);
  const docIndex = findColumnIndex(headers, COLUMN_ALIASES.doc);
  const remarksIndex = findColumnIndex(headers, COLUMN_ALIASES.remarks);

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

  if (marketplace === "flipkart" && remarksIndex < 0) {
    throw new Error(
      `Flipkart uploads must include a "Remarks" column (Active / EOL) on sheet "${sheetName}".`,
    );
  }

  const productsByKey = new Map<string, ProductInput>();
  const metricsByKey = new Map<string, MetricInput>();
  const monthlySelloutByKey = new Map<string, DailySale>();
  const errors: ParsedUploadPayload["errors"] = [];
  const monthlyColumns = rawHeaders
    .map((rawHeader, index) => ({
      index,
      date: parseEventSoMonthColumnDate(rawHeader),
    }))
    .filter((item): item is { index: number; date: string } => Boolean(item.date));

  const flipkartEolCollected = new Set<string>();
  const flipkartEolFromDb =
    marketplace === "amazon"
      ? await getFlipkartEolModelNames()
      : new Set<string>();

  let rawCount = 0;
  let validCount = 0;
  let ignoredCount = 0;

  const columnIndices: SheetColumnIndices = {
    inventoryIndex,
    totalSoIndex,
    currentMonthMtdIndex,
    previousMonthSoIndex,
    drrIndex,
    docIndex,
  };

  const rowLoopStart = performance.now();
  for (let rowNumber = headerRowIndex + 1; rowNumber < rows.length; rowNumber += 1) {
    const row = rows[rowNumber];
    if (!row) continue;
    const productCodeRaw = String(row[productCodeIndex] ?? "").trim();
    if (!productCodeRaw) continue;
    /** Flipkart FSN is case-insensitive; merge rows that differ only by casing (avoids split SKUs / dup lines). */
    const productCode =
      marketplace === "flipkart" ? productCodeRaw.toUpperCase() : productCodeRaw;
    rawCount += 1;

    const productName =
      productNameIndex >= 0
        ? String(row[productNameIndex] ?? "").trim()
        : productCode;

    const category = categoryIndex >= 0 ? String(row[categoryIndex] ?? "").trim() : "";
    const rawSubCategory =
      subCategoryIndex >= 0 ? String(row[subCategoryIndex] ?? "").trim() : "";
    const brand = brandIndex >= 0 ? String(row[brandIndex] ?? "").trim() : "";

    const subCategoryToStore = normalizedSubCategory(rawSubCategory, category, productName);

    const remarksRaw =
      remarksIndex >= 0 ? String(row[remarksIndex] ?? "").trim() : "";
    /** Flipkart master file only: Remarks column equals EOL (not lifecycle text elsewhere). */
    const flipkartRemarksEol =
      marketplace === "flipkart" && normalizeKey(remarksRaw) === "eol";

    const isTrackedSubCategory =
      subCategoryToStore !== null &&
      TRACKED_SUB_CATEGORY_SET.has(subCategoryToStore);

    // Flipkart Remarks = EOL: skip active dashboard / Event SO dailies, but keep Apr SO + May MTD for category charts.
    if (marketplace === "flipkart" && flipkartRemarksEol && isTrackedSubCategory) {
      if (productName) flipkartEolCollected.add(normalizeKey(productName));
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
          subCategoryToStore,
          brand,
          mapKey: `${marketplace}:${productCode}`,
          effectiveSnapshotDate,
          columnIndices,
          productsByKey,
          metricsByKey,
          monthlySelloutByKey,
          monthlyColumns,
          includeDailySales: true,
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
        subCategoryToStore,
        brand,
        mapKey: `${marketplace}:${productCode}`,
        effectiveSnapshotDate,
        columnIndices,
        productsByKey,
        metricsByKey,
        monthlySelloutByKey,
        monthlyColumns,
        includeDailySales: true,
      });
      validCount += 1;
      ignoredCount += 1;
      continue;
    }

    // Amazon hardcoded legacy EOL ASINs (M/P): keep Apr/May for category roll-ups.
    if (marketplace === "amazon" && isTrackedSubCategory) {
      const eolByMasterList = isKnownEolProductCode(marketplace, productCodeRaw);
      const isMonitorOrProjector =
        subCategoryToStore === "monitor" ||
        subCategoryToStore === "monitor_arm" ||
        subCategoryToStore === "projector";
      if (isMonitorOrProjector && eolByMasterList) {
        accumulateRowIntoUploadMaps(row, {
          marketplace,
          productCode,
          productName: productName || productCode,
          category,
          subCategoryToStore,
          brand,
          mapKey: `${marketplace}:${productCode}`,
          effectiveSnapshotDate,
          columnIndices,
          productsByKey,
          metricsByKey,
          monthlySelloutByKey,
          monthlyColumns,
          includeDailySales: true,
        });
        validCount += 1;
        ignoredCount += 1;
        continue;
      }
    }

    if (!subCategoryToStore) {
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
      brand,
      mapKey: `${marketplace}:${productCode}`,
      effectiveSnapshotDate,
      columnIndices,
      productsByKey,
      metricsByKey,
      monthlySelloutByKey,
      monthlyColumns,
      includeDailySales: true,
    });

    validCount += 1;
  }
  console.log(
    `[upload] row loop (${rawCount} raw, ${validCount} valid, ${ignoredCount} skipped): ${(performance.now() - rowLoopStart).toFixed(0)}ms`,
  );
  console.log(
    `[upload] parse TOTAL: ${(performance.now() - parseStart).toFixed(0)}ms`,
  );

  const categoryMonthlySellout = buildCategoryMonthlySelloutFromMaps(
    marketplace,
    monthlySelloutByKey,
    productsByKey,
    metricsByKey,
    effectiveSnapshotDate,
  );

  return {
    products: [...productsByKey.values()],
    metricInputs: [...metricsByKey.values()],
    dailySales: [...monthlySelloutByKey.values()],
    categoryMonthlySellout,
    errors,
    rawCount,
    validCount,
    ignoredCount,
    flipkartEolModelNames: [...flipkartEolCollected],
  };
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
): CategoryMonthlySelloutInput[] {
  const totals = new Map<string, number>();

  for (const sale of monthlySelloutByKey.values()) {
    if (!/^\d{4}-\d{2}-01$/.test(sale.sale_date)) continue;
    const product = productsByKey.get(`${marketplace}:${sale.product_code}`);
    const sub = product?.sub_category;
    if (!sub || !TRACKED_SUB_CATEGORY_SET.has(sub)) continue;
    const ym = sale.sale_date.slice(0, 7);
    const key = `${sub}|${ym}`;
    totals.set(key, (totals.get(key) ?? 0) + sale.units_sold);
  }

  const reportYm = snapshotDate.slice(0, 7);
  const mtdBySub = new Map<string, number>();
  for (const metric of metricsByKey.values()) {
    const product = productsByKey.get(`${marketplace}:${metric.product_code}`);
    const sub = product?.sub_category;
    if (!sub || !TRACKED_SUB_CATEGORY_SET.has(sub)) continue;
    mtdBySub.set(sub, (mtdBySub.get(sub) ?? 0) + Math.max(0, metric.may_mtd_units));
  }
  for (const [sub, units] of mtdBySub) {
    totals.set(`${sub}|${reportYm}`, units);
  }

  return [...totals.entries()].map(([key, units_sold]) => {
    const [sub_category, month_ym] = key.split("|") as [SubCategory, string];
    return { marketplace, sub_category, month_ym, units_sold };
  });
}
