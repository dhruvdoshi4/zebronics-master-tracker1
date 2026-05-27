import * as XLSX from "xlsx";
import { supabase } from "./supabase";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Database write failed.";
}

const FAST_READ_OPTS = {
  cellFormula: false,
  cellHTML: false,
  cellNF: false,
  cellStyles: false,
  cellDates: false,
} as const;

export function readWorkbookSheetNames(buffer: ArrayBuffer): string[] {
  return XLSX.read(buffer, { type: "array", bookSheets: true }).SheetNames;
}

/**
 * Shrink `!ref` to populated cells only. Many marketplace exports declare the full Excel
 * grid (1,048,576 × 16,384) because of a stray formatted cell — without this, parsers
 * iterate a million empty rows and appear hung at "Parsing workbook in background…".
 */
export function tightenWorksheetRange(ws: XLSX.WorkSheet): void {
  let maxR = 0;
  let maxC = 0;
  for (const key of Object.keys(ws)) {
    if (key[0] === "!") continue;
    const cell = XLSX.utils.decode_cell(key);
    if (cell.r >= 100_000) continue;
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c > maxC) maxC = cell.c;
  }
  if (maxC < 0) return;
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxR, c: maxC },
  });
}

export function readWorksheetCellValue(
  worksheet: XLSX.WorkSheet,
  row: number,
  col: number,
): unknown {
  const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell) return "";
  if (cell.t === "n" && typeof cell.v === "number") return cell.v;
  if (cell.w != null) return cell.w;
  return cell.v ?? "";
}

export function readWorksheetRowSlice(
  worksheet: XLSX.WorkSheet,
  row: number,
  maxCol: number,
): unknown[] {
  const out = new Array<unknown>(maxCol + 1);
  for (let col = 0; col <= maxCol; col += 1) {
    out[col] = readWorksheetCellValue(worksheet, row, col);
  }
  return out;
}

/** Read one sheet as row arrays without parsing the full workbook. */
export function readSingleSheetRowArrays(
  buffer: ArrayBuffer,
  sheetName: string,
  maxCol?: number,
): unknown[][] {
  const workbook = XLSX.read(buffer, {
    type: "array",
    sheets: [sheetName],
    ...FAST_READ_OPTS,
  });
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet?.["!ref"]) return [];

  const range = XLSX.utils.decode_range(worksheet["!ref"]);
  const lastCol = maxCol !== undefined ? Math.min(range.e.c, maxCol) : range.e.c;
  const rows: unknown[][] = [];
  for (let row = 0; row <= range.e.r; row += 1) {
    rows.push(readWorksheetRowSlice(worksheet, row, lastCol));
  }
  return rows;
}

/** Header / layout probe — only first rows & columns (no full-sheet JSON). */
export function readSheetProbeRows(
  buffer: ArrayBuffer,
  sheetName: string,
  maxRows = 30,
  maxCol = 100,
): unknown[][] {
  const workbook = XLSX.read(buffer, {
    type: "array",
    sheets: [sheetName],
    sheetRows: maxRows,
    ...FAST_READ_OPTS,
  });
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet?.["!ref"]) return [];

  const range = XLSX.utils.decode_range(worksheet["!ref"]);
  const lastRow = Math.min(range.e.r, maxRows - 1);
  const lastCol = Math.min(range.e.c, maxCol);
  const rows: unknown[][] = [];
  for (let row = 0; row <= lastRow; row += 1) {
    rows.push(readWorksheetRowSlice(worksheet, row, lastCol));
  }
  return rows;
}

/** Read a bounded set of tabs from a workbook (skips unrelated sheets). */
export function readSelectedSheetsRowArrays(
  buffer: ArrayBuffer,
  sheetNames: string[],
  maxCol?: number,
): Array<{ sheetName: string; rows: unknown[][] }> {
  const unique = [...new Set(sheetNames.filter(Boolean))];
  if (unique.length === 0) return [];

  const workbook = XLSX.read(buffer, {
    type: "array",
    sheets: unique,
    ...FAST_READ_OPTS,
  });

  return unique.map((sheetName) => ({
    sheetName,
    rows: (() => {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet?.["!ref"]) return [];
      const range = XLSX.utils.decode_range(worksheet["!ref"]);
      const lastCol = maxCol !== undefined ? Math.min(range.e.c, maxCol) : range.e.c;
      const rows: unknown[][] = [];
      for (let row = 0; row <= range.e.r; row += 1) {
        rows.push(readWorksheetRowSlice(worksheet, row, lastCol));
      }
      return rows;
    })(),
  }));
}

export async function upsertSupabaseParallel(
  table: string,
  rows: unknown[],
  onConflict: string,
  options?: { batchSize?: number; concurrency?: number },
): Promise<void> {
  if (rows.length === 0) return;
  const batchSize = options?.batchSize ?? 600;
  const concurrency = options?.concurrency ?? 4;
  const chunks: unknown[][] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    chunks.push(rows.slice(i, i + batchSize));
  }

  for (let wave = 0; wave < chunks.length; wave += concurrency) {
    await Promise.all(
      chunks.slice(wave, wave + concurrency).map(async (chunk) => {
        const { error } = await supabase.from(table).upsert(chunk, { onConflict });
        if (error) throw new Error(getErrorMessage(error));
      }),
    );
  }
}
