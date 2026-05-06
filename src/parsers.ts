import * as XLSX from "xlsx";
import type {
  DailySale,
  Marketplace,
  MetricInput,
  ParsedUploadPayload,
  ProductMaster,
} from "./types";
import { asNumber, normalizeKey } from "./utils";

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const ONE_DAY_MS = 86400000;

function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const ms = EXCEL_EPOCH_MS + Math.round(serial) * ONE_DAY_MS;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const TEXT_DATE_PATTERNS: ReadonlyArray<{
  regex: RegExp;
  toISO: (m: RegExpMatchArray) => string | null;
}> = [
  // 03-May-2026, 3 May 2026, 03/May/2026
  {
    regex: /^(\d{1,2})[\s\-/](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-/](\d{2,4})$/i,
    toISO: (m) => {
      const day = m[1].padStart(2, "0");
      const monthMap: Record<string, string> = {
        jan: "01",
        feb: "02",
        mar: "03",
        apr: "04",
        may: "05",
        jun: "06",
        jul: "07",
        aug: "08",
        sep: "09",
        oct: "10",
        nov: "11",
        dec: "12",
      };
      const month = monthMap[m[2].slice(0, 3).toLowerCase()];
      let year = m[3];
      if (year.length === 2) year = `20${year}`;
      return month ? `${year}-${month}-${day}` : null;
    },
  },
  // 2026-05-03 ISO
  {
    regex: /^(\d{4})-(\d{2})-(\d{2})$/,
    toISO: (m) => `${m[1]}-${m[2]}-${m[3]}`,
  },
  // 03/05/2026 or 3/5/26 (DD/MM/YYYY common in IN exports)
  {
    regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/,
    toISO: (m) => {
      const day = m[1].padStart(2, "0");
      const month = m[2].padStart(2, "0");
      let year = m[3];
      if (year.length === 2) year = `20${year}`;
      return `${year}-${month}-${day}`;
    },
  },
];

function cellToISODate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return excelSerialToISO(value);
  }
  const str = String(value).trim();
  if (!str) return null;
  const numericMaybe = Number(str);
  if (Number.isFinite(numericMaybe) && numericMaybe > 30000 && numericMaybe < 80000) {
    return excelSerialToISO(numericMaybe);
  }
  for (const pattern of TEXT_DATE_PATTERNS) {
    const match = str.match(pattern.regex);
    if (match) {
      const iso = pattern.toISO(match);
      if (iso) return iso;
    }
  }
  return null;
}

type ProductInput = Omit<
  ProductMaster,
  "id" | "created_at" | "updated_at" | "image_url"
>;

const TRACKED_SUB_CATEGORIES: ReadonlySet<string> = new Set([
  "monitor",
  "projector",
]);

const COLUMN_ALIASES = {
  productCode: ["asin", "fsn", "sku", "product id", "item id", "model code"],
  productName: [
    "model name",
    "model colour",
    "model name colour",
    "model",
    "title",
    "product name",
    "description",
  ],
  category: ["category"],
  subCategory: ["sub category", "subcategory", "sub-category"],
  brand: ["brand"],
  inventory: [
    "inv as on",
    "inventory",
    "app inv",
    "sellable qty",
    "available qty",
    "stock",
  ],
  totalSo: ["total so", "total sellout", "total sell out", "lifetime so"],
  mayMtd: ["may mtd"],
  aprSo: ["apr so", "april so"],
  drr: ["drr", "daily run rate"],
  doc: ["doc", "days of coverage", "days of cover"],
} as const;

const AMAZON_SHEET_NAME = "Consolidated (TEZ + Ecom)";

function getLikelySheetNames(marketplace: Marketplace): string[] {
  if (marketplace === "amazon") {
    return [AMAZON_SHEET_NAME];
  }
  return ["Flipkart", "Sellout", "Sheet1"];
}

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

function normalizedSubCategory(value: string): "monitor" | "projector" | null {
  const normalized = normalizeKey(value);
  if (TRACKED_SUB_CATEGORIES.has(normalized)) {
    return normalized as "monitor" | "projector";
  }
  return null;
}

function detectHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i += 1) {
    const normalized = (rows[i] ?? []).map((cell) => normalizeKey(cell));
    const hasCode = normalized.some((cell) =>
      COLUMN_ALIASES.productCode.some((alias) => cell.includes(alias)),
    );
    const hasName = normalized.some((cell) =>
      COLUMN_ALIASES.productName.some((alias) => cell.includes(alias)),
    );
    if (hasCode && hasName) return i;
  }
  return 0;
}


export async function parseUploadFile(
  file: File,
  marketplace: Marketplace,
  snapshotDate: string,
): Promise<ParsedUploadPayload> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });

  let sheetName: string | undefined;
  if (marketplace === "amazon") {
    if (!workbook.SheetNames.includes(AMAZON_SHEET_NAME)) {
      throw new Error(
        `Amazon uploads must contain the "${AMAZON_SHEET_NAME}" sheet. Please upload the original Zebronics Amazon report.`,
      );
    }
    sheetName = AMAZON_SHEET_NAME;
  } else {
    const preferred = getLikelySheetNames(marketplace);
    sheetName =
      preferred.find((name) => workbook.SheetNames.includes(name)) ??
      workbook.SheetNames[0];
  }

  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];

  const headerRowIndex = detectHeaderRow(rows);
  const headers = (rows[headerRowIndex] ?? []).map((cell) => normalizeKey(cell));

  const productCodeIndex = findColumnIndex(headers, COLUMN_ALIASES.productCode);
  const productNameIndex = findColumnIndex(headers, COLUMN_ALIASES.productName);
  const categoryIndex = findColumnIndex(headers, COLUMN_ALIASES.category);
  const subCategoryIndex = findColumnIndex(headers, COLUMN_ALIASES.subCategory);
  const brandIndex = findColumnIndex(headers, COLUMN_ALIASES.brand);
  const inventoryIndex = findColumnIndex(headers, COLUMN_ALIASES.inventory);
  const totalSoIndex = findColumnIndex(headers, COLUMN_ALIASES.totalSo);
  const mayMtdIndex = findColumnIndex(headers, COLUMN_ALIASES.mayMtd);
  const aprSoIndex = findColumnIndex(headers, COLUMN_ALIASES.aprSo);
  const drrIndex = findColumnIndex(headers, COLUMN_ALIASES.drr);
  const docIndex = findColumnIndex(headers, COLUMN_ALIASES.doc);

  if (productCodeIndex < 0 || productNameIndex < 0) {
    throw new Error(
      `Could not detect required columns (ASIN/SKU and Product Name) in sheet "${sheetName}".`,
    );
  }

  if (subCategoryIndex < 0) {
    throw new Error(
      `Could not detect a "Sub Category" column in sheet "${sheetName}". Only rows where Sub Category is "Monitor" or "Projector" are tracked.`,
    );
  }

  const headerRowRaw = (rows[headerRowIndex] ?? []) as unknown[];
  const dateColumns: { index: number; iso: string }[] = [];
  for (let columnIndex = 0; columnIndex < headerRowRaw.length; columnIndex += 1) {
    const iso = cellToISODate(headerRowRaw[columnIndex]);
    if (iso) {
      dateColumns.push({ index: columnIndex, iso });
    }
  }

  const productsByKey = new Map<string, ProductInput>();
  const metricsByKey = new Map<string, MetricInput>();
  const dailyByKey = new Map<string, DailySale>();
  const errors: ParsedUploadPayload["errors"] = [];

  let rawCount = 0;
  let validCount = 0;
  let ignoredCount = 0;

  for (let rowNumber = headerRowIndex + 1; rowNumber < rows.length; rowNumber += 1) {
    const row = rows[rowNumber];
    if (!row) continue;
    const productCode = String(row[productCodeIndex] ?? "").trim();
    if (!productCode) continue;
    rawCount += 1;

    const productName = String(row[productNameIndex] ?? "").trim();
    const category = categoryIndex >= 0 ? String(row[categoryIndex] ?? "").trim() : "";
    const rawSubCategory = String(row[subCategoryIndex] ?? "").trim();
    const brand = brandIndex >= 0 ? String(row[brandIndex] ?? "").trim() : "";

    const subCategoryToStore = normalizedSubCategory(rawSubCategory);
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
    const mayMtdValue = mayMtdIndex >= 0 ? asNumber(row[mayMtdIndex]) : 0;
    const aprSoValue = aprSoIndex >= 0 ? asNumber(row[aprSoIndex]) : 0;
    const drrValue = drrIndex >= 0 ? asNumber(row[drrIndex]) : 0;
    const docValue = docIndex >= 0 ? asNumber(row[docIndex]) : 0;

    metricsByKey.set(mapKey, {
      marketplace,
      product_code: productCode,
      as_of_date: snapshotDate,
      inventory_units: Math.max(0, inventoryValue),
      total_so_units: Math.max(0, totalSoValue),
      may_mtd_units: Math.max(0, mayMtdValue),
      apr_so_units: Math.max(0, aprSoValue),
      drr_units: Math.max(0, drrValue),
      doc_days_excel: docIndex >= 0 ? docValue : null,
    });

    for (const { index, iso } of dateColumns) {
      const cellValue = row[index];
      if (cellValue == null || cellValue === "") continue;
      const units = asNumber(cellValue);
      if (!Number.isFinite(units) || units < 0) continue;
      dailyByKey.set(`${productCode}|${iso}`, {
        marketplace,
        product_code: productCode,
        sale_date: iso,
        units_sold: units,
      });
    }

    validCount += 1;
  }

  return {
    products: [...productsByKey.values()],
    metricInputs: [...metricsByKey.values()],
    dailySales: [...dailyByKey.values()],
    errors,
    rawCount,
    validCount,
    ignoredCount,
  };
}
