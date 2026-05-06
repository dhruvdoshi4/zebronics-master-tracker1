import * as XLSX from "xlsx";
import type {
  Marketplace,
  MetricInput,
  ParsedUploadPayload,
  ProductMaster,
} from "./types";
import { asNumber, normalizeKey } from "./utils";

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
    if (!sheetList.SheetNames.includes(AMAZON_SHEET_NAME)) {
      throw new Error(
        `Amazon uploads must contain the "${AMAZON_SHEET_NAME}" sheet. Please upload the original Zebronics Amazon report.`,
      );
    }
    sheetName = AMAZON_SHEET_NAME;
  } else {
    const preferred = getLikelySheetNames(marketplace);
    sheetName =
      preferred.find((name) => sheetList.SheetNames.includes(name)) ??
      sheetList.SheetNames[0];
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

  const productsByKey = new Map<string, ProductInput>();
  const metricsByKey = new Map<string, MetricInput>();
  const errors: ParsedUploadPayload["errors"] = [];

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
    dailySales: [],
    errors,
    rawCount,
    validCount,
    ignoredCount,
  };
}
