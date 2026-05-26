import {
  readSheetProbeRows,
  readSingleSheetRowArrays,
  readWorkbookSheetNames,
} from "./xlsx-fast";
import { asNumber, normalizeKey } from "./utils";
import type { ParsedRowError } from "./types";

export type ParsedHoStockRow = {
  row_key: string;
  asin: string;
  fsn: string;
  erp_product_id: string;
  model_name: string;
  blocked_units: number;
  ho_units: number;
  gurgaon_units: number;
  total_units: number;
};

export type ParsedHoStockPayload = {
  rows: ParsedHoStockRow[];
  errors: ParsedRowError[];
  sheetName: string;
};

/** Split Flipkart cells like `FSN1 / FSN2` into individual codes. */
export function splitFsnCell(raw: string): string[] {
  return String(raw ?? "")
    .split(/\s*\/\s*/)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeAsin(raw: string): string {
  return String(raw ?? "").trim().toUpperCase();
}

function buildRowKey(asin: string, fsn: string, erpProductId: string, rowIndex: number): string {
  const parts = [
    asin ? `a:${asin}` : "",
    fsn ? `f:${normalizeKey(fsn)}` : "",
    erpProductId ? `p:${erpProductId}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("|") : `row:${rowIndex}`;
}

function sheetLooksLikeHoStock(probeRows: unknown[][]): boolean {
  for (let i = 0; i < Math.min(probeRows.length, 8); i += 1) {
    const header = probeRows[i];
    if (!Array.isArray(header)) continue;
    const h0 = String(header[0] ?? "").trim().toUpperCase();
    const h5 = String(header[5] ?? "").trim().toUpperCase();
    const h6 = String(header[6] ?? "").trim().toUpperCase();
    if (h0 === "ASIN" && (h5 === "HO" || h6 === "GURGAON")) return true;
  }
  return false;
}

function findHoStockSheetName(buffer: ArrayBuffer): string | null {
  const names = readWorkbookSheetNames(buffer);
  const preferred = names.find((name) => /consolidated.*ho.*stock/i.test(name));
  const ordered = preferred
    ? [preferred, ...names.filter((n) => n !== preferred)]
    : names;

  for (const name of ordered) {
    const probe = readSheetProbeRows(buffer, name, 10, 24);
    if (sheetLooksLikeHoStock(probe)) return name;
  }
  return null;
}

export async function parseHoStockFile(file: File): Promise<ParsedHoStockPayload> {
  const buffer = await file.arrayBuffer();
  const sheetName = findHoStockSheetName(buffer);
  if (!sheetName) {
    throw new Error(
      'Could not find "Consolidated HO Stock Report" (or a sheet with ASIN, HO, and Gurgaon columns).',
    );
  }

  const rows = readSingleSheetRowArrays(buffer, sheetName, 24);
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const header = rows[i];
    if (!Array.isArray(header)) continue;
    if (String(header[0] ?? "").trim().toUpperCase() === "ASIN") {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex < 0) {
    throw new Error("Header row with ASIN not found in HO stock sheet.");
  }

  const header = rows[headerRowIndex] as unknown[];
  const col = (labels: string[]): number => {
    for (let i = 0; i < header.length; i += 1) {
      const cell = normalizeKey(header[i]);
      if (labels.some((l) => cell === l || cell.includes(l))) return i;
    }
    return -1;
  };

  const asinIx = col(["asin"]);
  const fsnIx = col(["fsn"]);
  const productIdIx = col(["product id", "productid"]);
  const modelIx = col(["erp model name", "model name", "model"]);
  const blockedIx = col(["blocked"]);
  const hoIx = col(["ho"]);
  const gurgaonIx = col(["gurgaon"]);
  const totalIx = col(["total"]);

  if (asinIx < 0 || hoIx < 0 || gurgaonIx < 0 || totalIx < 0) {
    throw new Error("HO stock sheet must include ASIN, HO, Gurgaon, and Total columns.");
  }

  const parsed: ParsedHoStockRow[] = [];
  const errors: ParsedRowError[] = [];
  const seenKeys = new Set<string>();

  for (let r = headerRowIndex + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    const asin = normalizeAsin(String(row[asinIx] ?? ""));
    const fsnRaw = String(fsnIx >= 0 ? row[fsnIx] ?? "" : "").trim();
    const fsn = splitFsnCell(fsnRaw).join(" / ");
    const erpProductId = String(productIdIx >= 0 ? row[productIdIx] ?? "" : "").trim();
    const modelName = String(modelIx >= 0 ? row[modelIx] ?? "" : "").trim();

    if (!asin && !fsn && !modelName) continue;

    const ho = Math.max(0, asNumber(row[hoIx]));
    const gurgaon = Math.max(0, asNumber(row[gurgaonIx]));
    const total = Math.max(0, asNumber(row[totalIx]));
    const blocked = blockedIx >= 0 ? Math.max(0, asNumber(row[blockedIx])) : 0;

    const rowKey = buildRowKey(asin, fsnRaw, erpProductId, r);
    if (seenKeys.has(rowKey)) {
      errors.push({ rowNumber: r + 1, reason: `Duplicate row key ${rowKey}` });
      continue;
    }
    seenKeys.add(rowKey);

    parsed.push({
      row_key: rowKey,
      asin,
      fsn,
      erp_product_id: erpProductId,
      model_name: modelName || asin || fsn || erpProductId || `Row ${r + 1}`,
      blocked_units: blocked,
      ho_units: ho,
      gurgaon_units: gurgaon,
      total_units: total > 0 ? total : ho + gurgaon,
    });
  }

  if (parsed.length === 0) {
    throw new Error("No stock rows found in the consolidated HO sheet.");
  }

  return { rows: parsed, errors, sheetName };
}
