import * as XLSX from "xlsx";
import type {
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
import { asNumber, normalizeKey } from "./utils";

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
 * Maps master sheet Category + Sub Category to stored keys (same ingest path for every product type).
 * Combines columns so values split across Category / Sub Category still match (e.g. "Projection" + "Screen").
 */
function normalizedSubCategory(
  rawSubCategory: string,
  rawCategory: string,
): SubCategory | null {
  const sub = normalizeKey(rawSubCategory);
  const cat = normalizeKey(rawCategory);
  const hay = normalizeKey(`${rawCategory} ${rawSubCategory}`);
  const hasProj = hasProjectionFamily(hay);

  const hasScreenToken =
    /\bscreen(s)?\b/.test(hay) || hay.includes("projection screen");

  const hasStandToken =
    /\bstand(s)?\b/.test(hay) ||
    /\bmount(s)?\b/.test(hay) ||
    /\bbracket(s)?\b/.test(hay) ||
    /\btripod(s)?\b/.test(hay) ||
    hay.includes("ceiling mount");

  if (hasScreenToken && hasProj) return "projector_screen";

  if (hasStandToken && hasProj && !hasMonitorFamily(hay)) {
    return "projector_stand";
  }

  if (
    /\bcartridge(s)?\b/.test(hay) ||
    /\btoner(s)?\b/.test(hay) ||
    /\bdrum(s)?\b/.test(hay)
  ) {
    return "cartridge";
  }

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

  if (TRACKED_SUB_CATEGORY_SET.has(sub)) {
    return sub as SubCategory;
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

function findPreviousMonthSoIndex(headers: string[], snapshotDate: string): number {
  const prevMonthToken = previousMonthTokenFromDate(snapshotDate);
  return headers.findIndex((header) => {
    if (!header) return false;
    if (header === prevMonthToken || header === `${prevMonthToken} so`) return true;
    return (
      header.includes(prevMonthToken) &&
      COLUMN_ALIASES.prevMonthSo.some((alias) => header.includes(alias))
    );
  });
}

function parseMonthHeaderToDate(rawHeader: string, snapshotDate: string): string | null {
  const cleaned = String(rawHeader ?? "").trim();

  let match = /^([A-Za-z]{3,9})[-\s'](\d{2,4})$/.exec(cleaned);
  if (match) {
    const monthToken = match[1].slice(0, 3).toLowerCase();
    const month = MONTH_LOOKUP[monthToken];
    if (month === undefined) return null;
    const rawYear = Number(match[2]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return `${year}-${String(month + 1).padStart(2, "0")}-01`;
  }

  // Day-first headers common in masters: 4-May, 30-Apr, 4-May-26
  match = /^(\d{1,2})[-/]([A-Za-z]{3,9})(?:[-/](\d{2,4}))?$/i.exec(cleaned);
  if (match) {
    const day = Math.min(31, Math.max(1, parseInt(match[1], 10)));
    const monthToken = match[2].slice(0, 3).toLowerCase();
    const monthIndex = MONTH_LOOKUP[monthToken];
    if (monthIndex === undefined) return null;
    let year: number;
    if (match[3]) {
      const y = Number(match[3]);
      year = y < 100 ? 2000 + y : y;
    } else {
      year = new Date(`${snapshotDate}T12:00:00`).getFullYear();
    }
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
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


export async function parseUploadFile(
  file: File,
  marketplace: Marketplace,
  snapshotDate: string,
): Promise<ParsedUploadPayload> {
  const parseStart = performance.now();
  console.log(
    `[upload] parse start: file=${file.name} size=${(file.size / 1024).toFixed(0)}KB`,
  );

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
  const currentMonthMtdIndex = findCurrentMonthMtdIndex(headers, snapshotDate);
  const previousMonthSoIndex = findPreviousMonthSoIndex(headers, snapshotDate);
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
      date: parseMonthHeaderToDate(rawHeader, snapshotDate),
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

  const rowLoopStart = performance.now();
  for (let rowNumber = headerRowIndex + 1; rowNumber < rows.length; rowNumber += 1) {
    const row = rows[rowNumber];
    if (!row) continue;
    const productCode = String(row[productCodeIndex] ?? "").trim();
    if (!productCode) continue;
    rawCount += 1;

    const productName =
      productNameIndex >= 0
        ? String(row[productNameIndex] ?? "").trim()
        : productCode;

    const category = categoryIndex >= 0 ? String(row[categoryIndex] ?? "").trim() : "";
    const rawSubCategory =
      subCategoryIndex >= 0 ? String(row[subCategoryIndex] ?? "").trim() : "";
    const brand = brandIndex >= 0 ? String(row[brandIndex] ?? "").trim() : "";

    const subCategoryToStore = normalizedSubCategory(rawSubCategory, category);

    const remarksRaw =
      remarksIndex >= 0 ? String(row[remarksIndex] ?? "").trim() : "";
    /** Flipkart master file only: Remarks column equals EOL (not lifecycle text elsewhere). */
    const flipkartRemarksEol =
      marketplace === "flipkart" && normalizeKey(remarksRaw) === "eol";

    // Flipkart: Remarks = EOL for tracked sub-categories — exclude row and record model for Amazon.
    if (
      marketplace === "flipkart" &&
      flipkartRemarksEol &&
      subCategoryToStore !== null &&
      TRACKED_SUB_CATEGORY_SET.has(subCategoryToStore)
    ) {
      if (productName) flipkartEolCollected.add(normalizeKey(productName));
      ignoredCount += 1;
      continue;
    }

    // Amazon: exclude rows whose model name was marked EOL on Flipkart (Remarks column — cross-channel rule).
    if (
      marketplace === "amazon" &&
      productName &&
      flipkartEolFromDb.has(normalizeKey(productName))
    ) {
      ignoredCount += 1;
      continue;
    }

    // Amazon: no EOL column on sheet — only hardcoded legacy ASIN blocklist for M/P (Flipkart drives model-level EOL).
    if (marketplace === "amazon") {
      const eolByMasterList = isKnownEolProductCode(marketplace, productCode);
      const isMonitorOrProjector =
        subCategoryToStore === "monitor" || subCategoryToStore === "projector";
      if (isMonitorOrProjector && eolByMasterList) {
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

    const mapKey = `${marketplace}:${productCode}`;
    productsByKey.set(mapKey, {
      marketplace,
      product_code: productCode,
      product_name: productName,
      category: category || null,
      sub_category: subCategoryToStore,
      brand: brand || null,
    });

    const inventoryValue = inventoryIndex >= 0 ? asNumber(row[inventoryIndex]) : 0;
    const totalSoValue = totalSoIndex >= 0 ? asNumber(row[totalSoIndex]) : 0;
    const currentMonthMtdValue =
      currentMonthMtdIndex >= 0 ? asNumber(row[currentMonthMtdIndex]) : 0;
    const previousMonthSoValue =
      previousMonthSoIndex >= 0 ? asNumber(row[previousMonthSoIndex]) : 0;
    const drrValue = drrIndex >= 0 ? asNumber(row[drrIndex]) : 0;
    const docValue = docIndex >= 0 ? asNumber(row[docIndex]) : 0;

    metricsByKey.set(mapKey, {
      marketplace,
      product_code: productCode,
      as_of_date: snapshotDate,
      inventory_units: Math.max(0, inventoryValue),
      total_so_units: Math.max(0, totalSoValue),
      may_mtd_units: Math.max(0, currentMonthMtdValue),
      apr_so_units: Math.max(0, previousMonthSoValue),
      drr_units: Math.max(0, drrValue),
      doc_days_excel: docIndex >= 0 ? docValue : null,
    });

    for (const monthColumn of monthlyColumns) {
      const units = Math.max(0, asNumber(row[monthColumn.index]));
      const saleMapKey = `${marketplace}:${productCode}:${monthColumn.date}`;
      monthlySelloutByKey.set(saleMapKey, {
        marketplace,
        product_code: productCode,
        sale_date: monthColumn.date,
        units_sold: units,
      });
    }

    validCount += 1;
  }
  console.log(
    `[upload] row loop (${rawCount} raw, ${validCount} valid, ${ignoredCount} skipped): ${(performance.now() - rowLoopStart).toFixed(0)}ms`,
  );
  console.log(
    `[upload] parse TOTAL: ${(performance.now() - parseStart).toFixed(0)}ms`,
  );

  return {
    products: [...productsByKey.values()],
    metricInputs: [...metricsByKey.values()],
    dailySales: [...monthlySelloutByKey.values()],
    errors,
    rawCount,
    validCount,
    ignoredCount,
    flipkartEolModelNames: [...flipkartEolCollected],
  };
}
