/**
 * Offline validation: Amazon "Ecom Sellout" — strict Category + Sub Category + Apr SO vs ingest column.
 *
 * Usage:
 *   npx tsx scripts/validate-amazon-monitor-apr-so.ts <path-to-amazon-master.xlsx> [snapshotIso YYYY-MM-DD]
 *
 * Example:
 *   npx tsx scripts/validate-amazon-monitor-apr-so.ts "C:\\data\\Amazon.xlsx" 2026-05-11
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { normalizeKey } from "../src/utils.ts";
import { isKnownEolProductCode } from "../src/eol.ts";

const ECOM_SELLOUT_SHEET = "Ecom Sellout";

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
} as const;

function stripInvisible(s: string): string {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
}

/** Same as master ingest: trim, invisible strip, then normalizeKey (case/spacing/&-safe). */
function normForFilter(s: string): string {
  return normalizeKey(stripInvisible(s));
}

const STRICT_CATEGORY_NK = normForFilter("Monitor & Acc.");
const STRICT_SUB_NK = normForFilter("Monitor");
const EXPECTED_TOTAL = 5507;

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

function monthTokenFromDate(dateString: string): string {
  const d = new Date(`${dateString}T12:00:00`);
  return d.toLocaleString("en-US", { month: "short" }).toLowerCase().slice(0, 3);
}

function previousMonthTokenFromDate(dateString: string): string {
  const d = new Date(`${dateString}T12:00:00`);
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleString("en-US", { month: "short" }).toLowerCase().slice(0, 3);
}

const PREV_MONTH_SO_ALIASES = ["so", "sellout", "sell out"] as const;

/** Mirrors src/parsers.ts findPreviousMonthSoIndex (for comparison). */
function findPreviousMonthSoIndex(headers: string[], snapshotDate: string): number {
  const prevMonthToken = previousMonthTokenFromDate(snapshotDate);
  const monthWord = new RegExp(`\\b${prevMonthToken}\\b`);
  let bestIdx = -1;
  let bestScore = -1;
  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    if (!header) continue;
    const h = header;
    const hasSoAlias = PREV_MONTH_SO_ALIASES.some((alias) => h.includes(alias));
    const looksLikeDayColumn = /^\d/.test(h.trim());
    let score = -1;
    if (h === `${prevMonthToken} so`) score = 4;
    else if (monthWord.test(h) && hasSoAlias && !looksLikeDayColumn) score = 3;
    else if (h === prevMonthToken) score = 1;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Strict: normalized header must be exactly "apr so" (SheetJS + normalizeKey). */
function findStrictAprSoColumnIndex(headersNorm: string[], rawHeaders: string[]): number {
  for (let i = 0; i < headersNorm.length; i += 1) {
    const nk = headersNorm[i];
    if (nk === "apr so" || nk === "aprso") return i;
  }
  const rawNorm = rawHeaders.map((r) => normForFilter(String(r ?? "")));
  for (let i = 0; i < rawNorm.length; i += 1) {
    if (rawNorm[i] === "apr so" || rawNorm[i] === "aprso") return i;
  }
  return -1;
}

function findMayMtdColumnIndex(headersNorm: string[]): number {
  for (let i = 0; i < headersNorm.length; i += 1) {
    const nk = headersNorm[i] ?? "";
    if (nk === "may mtd" || nk.includes("may mtd")) return i;
  }
  return -1;
}

function findFySoColumnIndex(headersNorm: string[], fyStart: number): number {
  for (let i = 0; i < headersNorm.length; i += 1) {
    const nk = headersNorm[i] ?? "";
    if (!nk.includes("fy") || !nk.includes("so")) continue;
    const pair =
      /(\d{2,4})\s*[-–]\s*(\d{2,4})/.exec(nk) ?? /fy\s*(\d{2,4})\s+(\d{2,4})/.exec(nk);
    if (!pair) continue;
    let start = Number(pair[1]);
    if (!Number.isFinite(start)) continue;
    if (start >= 0 && start <= 99) start = 2000 + start;
    if (start === fyStart) return i;
  }
  return -1;
}

function readEcomSelloutRows(filePath: string): {
  sheetName: string;
  rows: unknown[][];
} {
  const resolved = path.resolve(filePath);
  /** One sheet only — avoids OOM on multi-sheet warehouse masters. */
  const candidates = [ECOM_SELLOUT_SHEET, "Ecom sellout", "ECOM SELLOUT"];
  const buffer = fs.readFileSync(resolved);
  for (const candidate of candidates) {
    try {
      const wb = XLSX.read(buffer, {
        type: "buffer",
        sheets: [candidate],
        cellDates: false,
        cellFormula: false,
        cellHTML: false,
        cellNF: false,
        cellStyles: false,
        dense: true,
      });
      const ws = wb.Sheets[candidate];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: false,
        defval: "",
      }) as unknown[][];
      return { sheetName: candidate, rows };
    } catch {
      // try next candidate name
    }
  }

  const wb = XLSX.read(buffer, {
    type: "buffer",
    bookSheets: true,
    cellStyles: false,
    cellNF: false,
  });
  const sheetName =
    wb.SheetNames.find((n) => normalizeKey(n) === normalizeKey(ECOM_SELLOUT_SHEET)) ?? null;
  if (!sheetName) {
    console.error(`No sheet named "${ECOM_SELLOUT_SHEET}". Found: ${wb.SheetNames.join(", ")}`);
    process.exit(1);
  }

  const wb2 = XLSX.read(buffer, {
    type: "buffer",
    sheets: [sheetName],
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    dense: true,
  });
  const ws = wb2.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];
  return { sheetName, rows };
}

function detectHeaderRow(rows: unknown[][]): number {
  let bestRowIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 60); i += 1) {
    const normalized = (rows[i] ?? []).map((cell) => normalizeKey(cell));
    const hasCode = COLUMN_ALIASES.productCode.some((alias) =>
      normalized.some((cell) => cell.includes(alias)),
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
      );
    if (score > bestScore) {
      bestScore = score;
      bestRowIndex = i;
    }
  }
  return bestScore >= 0 ? bestRowIndex : 0;
}

type RowRec = {
  rowNumber: number;
  sku: string;
  productName: string;
  categoryRaw: string;
  subRaw: string;
  aprStrict: number;
  aprParser: number;
  strictMatch: boolean;
  monitorLoose: boolean;
  rawAprCell: string;
  parserNaN: boolean;
};

function cellString(row: unknown[], i: number): string {
  if (i < 0) return "";
  const v = row[i];
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return stripInvisible(String(v));
}

function parseAprFlexible(raw: string): { n: number; nan: boolean } {
  const s = stripInvisible(raw).replace(/,/g, "");
  if (!s) return { n: 0, nan: false };
  const parsed = Number(s);
  if (!Number.isFinite(parsed)) return { n: 0, nan: true };
  return { n: parsed, nan: false };
}

function main(): void {
  const filePath = process.argv[2];
  const snapshotDate = process.argv[3] ?? "2026-05-11";
  if (!filePath || !fs.existsSync(filePath)) {
    console.error(
      "Usage: npx tsx scripts/validate-amazon-monitor-apr-so.ts <amazon-xlsx> [YYYY-MM-DD snapshot]",
    );
    process.exit(1);
  }

  const { sheetName, rows } = readEcomSelloutRows(filePath);

  const headerRowIndex = detectHeaderRow(rows);
  const headers = (rows[headerRowIndex] ?? []).map((cell) => normalizeKey(cell));
  const rawHeaders = (rows[headerRowIndex] ?? []).map((cell) => stripInvisible(String(cell ?? "")));

  const productCodeIndex = findColumnIndex(headers, COLUMN_ALIASES.productCode);
  const productNameIndex = findColumnIndex(headers, COLUMN_ALIASES.productName);
  const categoryIndex = findColumnIndex(headers, COLUMN_ALIASES.category);
  const subCategoryIndex = findColumnIndex(headers, COLUMN_ALIASES.subCategory);

  const strictAprIdx = findStrictAprSoColumnIndex(headers, rawHeaders);
  const parserAprIdx = findPreviousMonthSoIndex(headers, snapshotDate);
  const mayMtdIdx = findMayMtdColumnIndex(headers);
  const priorFyIdx = findFySoColumnIndex(headers, 2025);
  const currentFyIdx = findFySoColumnIndex(headers, 2026);

  console.log("=== Amazon Ecom Sellout — Monitor Apr SO validation ===\n");
  console.log(`File: ${path.resolve(filePath)}`);
  console.log(`Sheet: ${sheetName}`);
  console.log(`Snapshot date (for parser month token): ${snapshotDate}`);
  console.log(`Previous month token: "${previousMonthTokenFromDate(snapshotDate)}"`);
  console.log(`Header row (1-based): ${headerRowIndex + 1}`);
  console.log(`\nColumn indices:`);
  console.log(`  ASIN/SKU col: ${productCodeIndex}`);
  console.log(`  Category col: ${categoryIndex}`);
  console.log(`  Sub Category col: ${subCategoryIndex}`);
  console.log(`  Strict "Apr SO" col (normalizeKey === apr so): ${strictAprIdx}`);
  console.log(`  Parser findPreviousMonthSoIndex col: ${parserAprIdx}`);
  console.log(`  May MTD col: ${mayMtdIdx}${mayMtdIdx >= 0 ? ` ("${rawHeaders[mayMtdIdx]}")` : ""}`);
  console.log(`  FY 2025-26 SO col: ${priorFyIdx}${priorFyIdx >= 0 ? ` ("${rawHeaders[priorFyIdx]}")` : ""}`);
  console.log(`  FY 2026-27 SO col: ${currentFyIdx}${currentFyIdx >= 0 ? ` ("${rawHeaders[currentFyIdx]}")` : ""}`);
  if (strictAprIdx >= 0 && rawHeaders[strictAprIdx]) {
    console.log(`  Strict column raw header: "${rawHeaders[strictAprIdx]}"`);
  }
  if (parserAprIdx >= 0 && rawHeaders[parserAprIdx]) {
    console.log(`  Parser column raw header: "${rawHeaders[parserAprIdx]}"`);
  }
  if (strictAprIdx !== parserAprIdx && strictAprIdx >= 0 && parserAprIdx >= 0) {
    console.log(
      "\n*** MISMATCH: ingest uses parser column index, not strict 'Apr SO' label — totals will differ if those columns differ.\n",
    );
  }

  if (productCodeIndex < 0 || (categoryIndex < 0 && subCategoryIndex < 0)) {
    console.error("Missing required columns.");
    process.exit(1);
  }
  if (strictAprIdx < 0) {
    console.error('No column with strict label "Apr SO" (normalized to apr so).');
    process.exit(1);
  }

  const recs: RowRec[] = [];
  let emptySkuSkipped = 0;

  for (let rowNumber = headerRowIndex + 1; rowNumber < rows.length; rowNumber += 1) {
    const row = rows[rowNumber];
    if (!row) continue;
    const sku = stripInvisible(cellString(row, productCodeIndex)).toUpperCase();
    if (!sku) {
      emptySkuSkipped += 1;
      continue;
    }
    const productName =
      productNameIndex >= 0 ? stripInvisible(cellString(row, productNameIndex)) : sku;
    const categoryRaw = categoryIndex >= 0 ? cellString(row, categoryIndex) : "";
    const subRaw = subCategoryIndex >= 0 ? cellString(row, subCategoryIndex) : "";

    const catN = normForFilter(categoryRaw);
    const subN = normForFilter(subRaw);
    const strictMatch = catN === STRICT_CATEGORY_NK && subN === STRICT_SUB_NK;
    const nameN = normForFilter(productName);
    const monitorLoose =
      catN.includes("monitor") ||
      subN.includes("monitor") ||
      nameN.includes("monitor");

    const rawAprStrict = cellString(row, strictAprIdx);
    const rawAprParser = parserAprIdx >= 0 ? cellString(row, parserAprIdx) : "";
    const { n: aprStrict, nan: nanS } = parseAprFlexible(rawAprStrict);
    const { n: aprParser, nan: nanP } = parseAprFlexible(rawAprParser);

    recs.push({
      rowNumber: rowNumber + 1,
      sku,
      productName,
      categoryRaw,
      subRaw,
      aprStrict: Math.max(0, aprStrict),
      aprParser: Math.max(0, aprParser),
      strictMatch,
      monitorLoose,
      rawAprCell: rawAprStrict,
      parserNaN: nanP || nanS,
    });
  }

  const strictRows = recs.filter((r) => r.strictMatch);
  const sumStrict = strictRows.reduce((a, r) => a + r.aprStrict, 0);
  const sumParserOnStrictRows = strictRows.reduce((a, r) => a + r.aprParser, 0);

  function sumStrictColumn(colIdx: number): number {
    if (colIdx < 0) return 0;
    let total = 0;
    for (const r of strictRows) {
      const row = rows[r.rowNumber - 1];
      if (!row) continue;
      const { n } = parseAprFlexible(cellString(row, colIdx));
      total += Math.max(0, n);
    }
    return total;
  }

  const sumMayMtd = sumStrictColumn(mayMtdIdx);
  const sumPriorFy = sumStrictColumn(priorFyIdx);
  const sumCurrentFy = sumStrictColumn(currentFyIdx);

  console.log("\n--- Amazon Monitor truth (Category = Monitor & Acc., Sub = Monitor) ---");
  console.log("| Metric | Sheet |");
  console.log("|--------|------:|");
  console.log(`| FY 2025-26 SO | ${sumPriorFy.toLocaleString("en-IN")} |`);
  console.log(`| FY 2026-27 SO | ${sumCurrentFy.toLocaleString("en-IN")} |`);
  console.log(`| May MTD | ${sumMayMtd.toLocaleString("en-IN")} |`);
  console.log(`| Apr SO | ${sumStrict.toLocaleString("en-IN")} |`);
  console.log(`| SKU count | ${strictRows.length} |`);

  const monitorsPluralRows = recs.filter(
    (r) =>
      normForFilter(r.categoryRaw) === STRICT_CATEGORY_NK &&
      normForFilter(r.subRaw) === normForFilter("Monitors"),
  );
  const sumMonitorsPlural = monitorsPluralRows.reduce((a, r) => a + r.aprStrict, 0);

  const excluded = recs.filter((r) => r.monitorLoose && !r.strictMatch);

  console.log("\n--- 4) Strict filter (Category = Monitor & Acc., Sub Category = Monitor) ---");
  console.log(`Matching data rows (with non-empty SKU): ${strictRows.length}`);
  console.log(`Sum (strict Apr SO column): ${sumStrict}`);
  console.log(`Sum (parser Apr column, same rows): ${sumParserOnStrictRows}`);

  console.log(
    `\nSub Category = "Monitors" (plural) + same category: ${monitorsPluralRows.length} rows, Apr SO sum = ${sumMonitorsPlural}`,
  );
  if (monitorsPluralRows.length > 0 && monitorsPluralRows.length <= 30) {
    for (const r of monitorsPluralRows) {
      console.log(`  row ${r.rowNumber}\t${r.sku}\tAprSO=${r.aprStrict}`);
    }
  }

  const dupMap = new Map<string, number>();
  for (const r of strictRows) dupMap.set(r.sku, (dupMap.get(r.sku) ?? 0) + 1);
  const dupSkus = [...dupMap.entries()].filter(([, c]) => c > 1).map(([s]) => s);

  const nanRows = strictRows.filter((r) => {
    const { nan } = parseAprFlexible(r.rawAprCell);
    return nan;
  });

  console.log("\nPer-SKU (strict filter, strict Apr SO):");
  for (const r of strictRows.sort((a, b) => a.sku.localeCompare(b.sku))) {
    const eol = isKnownEolProductCode("amazon", r.sku);
    console.log(
      `  row ${r.rowNumber}\t${r.sku}\tAprSO=${r.aprStrict}\t${eol ? "[EOL blocklist]" : ""}\t${r.productName.slice(0, 40)}`,
    );
  }

  console.log("\n--- 5) Rows with Monitor in category/sub/name but NOT strict filter ---");
  console.log(`Count: ${excluded.length}`);
  for (const r of excluded.slice(0, 80)) {
    console.log(
      `  row ${r.rowNumber}\t${r.sku}\tcat="${r.categoryRaw.slice(0, 32)}"\tsub="${r.subRaw.slice(0, 32)}"\tAprSO=${r.aprStrict}`,
    );
  }
  if (excluded.length > 80) console.log(`  ... (${excluded.length - 80} more)`);

  const eolInStrict = strictRows.filter((r) => isKnownEolProductCode("amazon", r.sku));
  const eolUnits = eolInStrict.reduce((a, r) => a + r.aprStrict, 0);

  console.log("\n--- 6) Parsing notes ---");
  console.log(`Blank Apr SO → 0 (per asNumber-style parsing)`);
  console.log(`NaN / non-numeric Apr SO in strict rows: ${nanRows.length}`);
  if (nanRows.length) {
    for (const r of nanRows) console.log(`  row ${r.rowNumber} ${r.sku} raw="${r.rawAprCell}"`);
  }
  console.log(`Empty SKU rows skipped: ${emptySkuSkipped}`);

  console.log("\n--- 7) Expected 5507 ---");
  if (sumStrict === EXPECTED_TOTAL) {
    console.log(`OK: strict total equals ${EXPECTED_TOTAL}.`);
  } else {
    console.log(`Expected ${EXPECTED_TOTAL}, got ${sumStrict} (delta ${EXPECTED_TOTAL - sumStrict}).`);
    if (dupSkus.length) console.log(`Duplicate SKUs in strict set: ${dupSkus.join(", ")}`);
    if (strictAprIdx !== parserAprIdx && parserAprIdx >= 0) {
      console.log(
        `If app shows 5271: check ingest uses parser column (sum on strict rows = ${sumParserOnStrictRows}) vs strict Apr SO (${sumStrict}).`,
      );
    }
    console.log(
      `EOL ASINs in strict set: ${eolInStrict.length} rows, ${eolUnits} Apr SO units (app ingest excludes these for monitor/projector).`,
    );
  }

  console.log("\n=== Done ===");
}

main();
