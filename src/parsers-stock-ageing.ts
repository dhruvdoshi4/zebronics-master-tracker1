import {
  readSingleSheetRowArrays,
  readWorkbookSheetNames,
} from "./xlsx-fast";
import { normalizeProductId } from "./erp-product-link";
import {
  emptyStockAgeingFineBuckets,
  rollupStockAgeingBuckets,
  type StockAgeingBuckets,
  type StockAgeingFineBuckets,
} from "./stock-ageing";
import { asNumber, normalizeKey, parseAsOnDateFromText } from "./utils";
import type { ParsedRowError } from "./types";

export type ParsedStockAgeingRow = {
  prdcode: string;
  model_name: string;
  total_qty: number;
} & StockAgeingBuckets;

export type ParsedStockAgeingPayload = {
  rows: ParsedStockAgeingRow[];
  errors: ParsedRowError[];
  sheetName: string;
};

const FINE_BUCKET_QTY_COLUMNS: Array<{
  key: keyof StockAgeingFineBuckets;
  headerTokens: string[];
}> = [
  { key: "qty_0_30", headerTokens: ["0 30", "0-30"] },
  { key: "qty_31_90", headerTokens: ["31 90", "31-90"] },
  { key: "qty_91_180", headerTokens: ["91 180", "91-180"] },
  { key: "qty_181_270", headerTokens: ["181 270", "181-270"] },
  { key: "qty_271_365", headerTokens: ["271 365", "271-365"] },
  { key: "qty_366_547", headerTokens: ["366 547", "366-547", "365 547", "365-547"] },
  { key: "qty_547_plus", headerTokens: ["above 547", "547"] },
];

function findConsolidatedSheet(buffer: ArrayBuffer): string | null {
  const names = readWorkbookSheetNames(buffer);
  const exact = names.find((n) => normalizeKey(n) === "consolidated");
  if (exact) return exact;
  return names.find((n) => normalizeKey(n).includes("consolidat")) ?? null;
}

function headerMatchesBucket(header: string, tokens: string[]): boolean {
  const h = normalizeKey(header);
  if (!h) return false;
  return tokens.some((t) => {
    const token = normalizeKey(t);
    if (token === "547" && (h.includes("366") || h.includes("365"))) return false;
    return h.includes(token) || token.includes(h);
  });
}

function findQtyColumns(
  groupRow: string[],
  qtyRow: string[],
): Map<keyof StockAgeingFineBuckets, number> {
  const map = new Map<keyof StockAgeingFineBuckets, number>();
  for (let c = 0; c < qtyRow.length; c++) {
    if (normalizeKey(qtyRow[c]) !== "qty") continue;
    const group = String(groupRow[c] ?? "").trim();
    for (const bucket of FINE_BUCKET_QTY_COLUMNS) {
      if (map.has(bucket.key)) continue;
      if (headerMatchesBucket(group, bucket.headerTokens)) {
        map.set(bucket.key, c);
        break;
      }
    }
  }
  return map;
}

function detectLayout(rows: unknown[][]): {
  headerRowIndex: number;
  dataStartRow: number;
  prdcodeIdx: number;
  modelIdx: number;
  totalQtyIdx: number;
  bucketCols: Map<keyof StockAgeingFineBuckets, number>;
} | null {
  for (let i = 0; i < Math.min(rows.length - 1, 12); i++) {
    const headerCells = (rows[i] ?? []).map((c) => String(c ?? ""));
    const headerKeys = headerCells.map((c) => normalizeKey(c));
    const prdcodeIdx = headerKeys.indexOf("prdcode");
    if (prdcodeIdx < 0) continue;

    const qtyRow = (rows[i + 1] ?? []).map((c) => String(c ?? ""));
    const bucketCols = findQtyColumns(headerCells, qtyRow);
    if (bucketCols.size < 5) continue;

    const modelIdx = headerKeys.findIndex(
      (k) => k === "model name" || k === "model",
    );
    const totalQtyIdx = headerKeys.findIndex((k) => k.includes("total qty"));

    return {
      headerRowIndex: i,
      dataStartRow: i + 2,
      prdcodeIdx,
      modelIdx,
      totalQtyIdx,
      bucketCols,
    };
  }
  return null;
}

/** Scan Consolidated sheet header rows for “AS ON …” (e.g. 31.5.2026). */
export async function peekStockAgeingSnapshotDate(file: File): Promise<string | null> {
  const buffer = await file.arrayBuffer();
  const sheetName = findConsolidatedSheet(buffer);
  if (!sheetName) return null;

  const rows = readSingleSheetRowArrays(buffer, sheetName, 8);
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const iso = parseAsOnDateFromText(String(cell ?? ""));
      if (iso) return iso;
    }
  }
  return null;
}

export async function parseStockAgeingFile(file: File): Promise<ParsedStockAgeingPayload> {
  const buffer = await file.arrayBuffer();
  const sheetName = findConsolidatedSheet(buffer);
  if (!sheetName) {
    throw new Error('Could not find a "Consolidated" sheet in the stock ageing workbook.');
  }

  const rows = readSingleSheetRowArrays(buffer, sheetName, 24);
  const layout = detectLayout(rows);
  if (!layout) {
    throw new Error(
      "Consolidated sheet must include Prdcode and ageing bucket QTY columns (0-30, 31-90, …).",
    );
  }

  const parsed: ParsedStockAgeingRow[] = [];
  const errors: ParsedRowError[] = [];
  const seen = new Set<string>();

  for (let r = layout.dataStartRow; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    const prdcode = normalizeProductId(row[layout.prdcodeIdx]);
    if (!prdcode) continue;

    const model_name = String(
      layout.modelIdx >= 0 ? row[layout.modelIdx] ?? "" : "",
    ).trim();
    if (!model_name) continue;

    const fine = { ...emptyStockAgeingFineBuckets() };
    for (const [key, colIdx] of layout.bucketCols) {
      fine[key] = Math.max(0, asNumber(row[colIdx]));
    }
    const buckets = rollupStockAgeingBuckets(fine);

    const bucketSum = stockAgeingTotalFromFine(fine);
    const total_qty =
      layout.totalQtyIdx >= 0
        ? Math.max(0, asNumber(row[layout.totalQtyIdx]))
        : bucketSum;
    if (total_qty <= 0 && bucketSum <= 0) continue;

    if (seen.has(prdcode)) {
      errors.push({ rowNumber: r + 1, reason: `Duplicate Prdcode ${prdcode}` });
      continue;
    }
    seen.add(prdcode);

    parsed.push({
      prdcode,
      model_name,
      total_qty: total_qty > 0 ? total_qty : bucketSum,
      ...buckets,
    });
  }

  if (parsed.length === 0) {
    throw new Error("No product rows with Prdcode found on the Consolidated ageing sheet.");
  }

  return { rows: parsed, errors, sheetName };
}

function stockAgeingTotalFromFine(fine: StockAgeingFineBuckets): number {
  return Object.values(fine).reduce((sum, qty) => sum + qty, 0);
}
