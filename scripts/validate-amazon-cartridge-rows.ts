/**
 * Count Cartridge rows on Amazon "Ecom Sellout" the same way ingest classifies them.
 *
 * Usage:
 *   npx tsx scripts/validate-amazon-cartridge-rows.ts <path-to-amazon-master.xlsx>
 */

import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { inferSubCategoryFromProductFields } from "../src/parsers.ts";
import { normalizeKey } from "../src/utils.ts";

const ECOM_SELLOUT_SHEET = "Ecom Sellout";

const COLUMN_ALIASES = {
  productCode: ["asin", "fsn", "sku"],
  category: ["category", "product category", "product type"],
  subCategory: ["sub category", "subcategory", "sub-category", "sub cat"],
  productName: ["model name", "model", "title", "product name"],
} as const;

function findColumnIndex(headers: string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const exact = headers.findIndex((h) => h === alias);
    if (exact >= 0) return exact;
    const includes = headers.findIndex((h) => Boolean(h) && h.includes(alias));
    if (includes >= 0) return includes;
  }
  return -1;
}

function findCategoryColumnIndex(headers: string[]): number {
  const subCategoryIndex = findColumnIndex(headers, COLUMN_ALIASES.subCategory);
  for (const alias of COLUMN_ALIASES.category) {
    const exact = headers.findIndex(
      (h, i) => h === alias && i !== subCategoryIndex,
    );
    if (exact >= 0) return exact;
    const includes = headers.findIndex(
      (h, i) =>
        Boolean(h) &&
        i !== subCategoryIndex &&
        h.includes(alias) &&
        !h.includes("sub category") &&
        !h.includes("subcategory"),
    );
    if (includes >= 0) return includes;
  }
  return -1;
}

function detectHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 60); i += 1) {
    const headers = (rows[i] ?? []).map((c) => normalizeKey(c));
    if (findColumnIndex(headers, COLUMN_ALIASES.productCode) >= 0) return i;
  }
  return 0;
}

const filePath = process.argv[2];
if (!filePath || !fs.existsSync(filePath)) {
  console.error("Usage: npx tsx scripts/validate-amazon-cartridge-rows.ts <amazon-master.xlsx>");
  process.exit(1);
}

const buffer = fs.readFileSync(filePath);
const wb = XLSX.read(buffer, { type: "buffer", sheets: [ECOM_SELLOUT_SHEET] });
const sheet = wb.Sheets[ECOM_SELLOUT_SHEET];
if (!sheet) {
  console.error(`Sheet "${ECOM_SELLOUT_SHEET}" not found.`);
  process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(sheet, {
  header: 1,
  raw: false,
  defval: "",
}) as unknown[][];

const headerRowIndex = detectHeaderRow(rows);
const headers = (rows[headerRowIndex] ?? []).map((c) => normalizeKey(c));
const codeIdx = findColumnIndex(headers, COLUMN_ALIASES.productCode);
const catIdx = findCategoryColumnIndex(headers);
const subIdx = findColumnIndex(headers, COLUMN_ALIASES.subCategory);
const nameIdx = findColumnIndex(headers, COLUMN_ALIASES.productName);

let sheetCartridge = 0;
let ingestCartridge = 0;

for (let r = headerRowIndex + 1; r < rows.length; r += 1) {
  const row = rows[r];
  if (!row) continue;
  const code = String(row[codeIdx] ?? "").trim();
  if (!code) continue;
  const category = catIdx >= 0 ? String(row[catIdx] ?? "").trim() : "";
  const subCategory = subIdx >= 0 ? String(row[subIdx] ?? "").trim() : "";
  const name = nameIdx >= 0 ? String(row[nameIdx] ?? "").trim() : "";
  if (normalizeKey(category) !== "cartridge") continue;
  sheetCartridge += 1;
  if (inferSubCategoryFromProductFields(name, category, subCategory) === "cartridge") {
    ingestCartridge += 1;
  }
}

console.log({
  sheet: ECOM_SELLOUT_SHEET,
  headerRow: headerRowIndex + 1,
  categoryColumn: catIdx,
  subCategoryColumn: subIdx,
  sheetCartridgeRows: sheetCartridge,
  ingestWouldAccept: ingestCartridge,
});
