import {
  readSelectedSheetsRowArrays,
  readWorkbookSheetNames,
} from "./xlsx-fast";
import { asNumber, normalizeKey } from "./utils";
import type { ParsedRowError } from "./types";

export type ParsedBauRow = {
  product_name: string;
  bau_price: number;
  asin?: string;
  fsn?: string;
};

export type ParsedGmsPlanRow = {
  product_name: string;
  month_ym: string;
  planned_gms: number;
  target_gms: number;
  asin?: string;
  fsn?: string;
};

export type ParsedBauPayload = {
  rows: ParsedBauRow[];
  errors: ParsedRowError[];
};

export type ParsedGmsPlanPayload = {
  rows: ParsedGmsPlanRow[];
  errors: ParsedRowError[];
};

const ASIN_ALIASES = ["asin", "amazon asin", "amazon sku"];
const FSN_ALIASES = ["fsn", "flipkart fsn", "flipkart sku"];
const CODE_ALIASES = ["sku", "product code", "product id", "item id"];
const NAME_ALIASES = ["model name", "model", "product name", "title"];
const BAU_ALIASES = ["bau sp", "bau price", "bau rate", "bau", "mrp bau", "selling price"];
const PLANNED_ALIASES = ["planned gms", "plan gms", "gms plan", "planned", "gms"];
const TARGET_ALIASES = ["target gms", "target", "gms target"];
const GMS_VALUE_ALIASES = ["gms"];
const PLAN_UNITS_ALIASES = ["plan"];

function findCol(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const exact = headers.findIndex((h) => h === alias);
    if (exact >= 0) return exact;
    const inc = headers.findIndex((h) => h && h.includes(alias));
    if (inc >= 0) return inc;
  }
  return -1;
}

function findColInRange(headers: string[], aliases: string[], start: number, end: number): number {
  for (let i = start; i < end; i++) {
    for (const alias of aliases) {
      const h = headers[i];
      if (!h) continue;
      if (h === alias || h.includes(alias)) return i;
    }
  }
  return -1;
}

function findAllCols(headers: string[], aliases: string[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < headers.length; i++) {
    for (const alias of aliases) {
      const h = headers[i];
      if (!h) continue;
      if (h === alias || h.includes(alias)) {
        indices.push(i);
        break;
      }
    }
  }
  return indices;
}

function findExactCols(headers: string[], names: string[]): number[] {
  return headers.map((h, i) => (names.includes(h) ? i : -1)).filter((i) => i >= 0);
}

/** BAU workbooks often have a phantom range to column XEV — only read real columns. */
const BAU_SHEET_MAX_COLS = 32;

function sheetsToParse(names: string[]): string[] {
  const channelTabs = names.filter((name) => sheetChannelHint(name));
  if (channelTabs.length > 0) return channelTabs;
  const hinted = names.filter((name) => {
    const key = normalizeKey(name);
    return (
      key.includes("bau") ||
      key.includes("gms") ||
      key.includes("plan") ||
      key.includes("sellout") ||
      key.includes("so plan")
    );
  });
  return hinted.length > 0 ? hinted : names.slice(0, 6);
}

function readWorkbookSheets(buffer: ArrayBuffer): Array<{ sheetName: string; rows: unknown[][] }> {
  const names = readWorkbookSheetNames(buffer);
  return readSelectedSheetsRowArrays(buffer, sheetsToParse(names), BAU_SHEET_MAX_COLS - 1);
}

function sheetChannelHint(sheetName: string): "amazon" | "flipkart" | null {
  const key = normalizeKey(sheetName);
  if (key.includes("amazon") || key === "az" || key.includes("amz")) return "amazon";
  if (key.includes("flipkart") || key === "fk" || key.includes("flip")) return "flipkart";
  return null;
}

function detectHeaderRow(rows: unknown[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const h = (rows[i] ?? []).slice(0, BAU_SHEET_MAX_COLS).map((c) => normalizeKey(c));
    const score =
      Number(findCol(h, ASIN_ALIASES) >= 0 || findCol(h, FSN_ALIASES) >= 0 || findCol(h, CODE_ALIASES) >= 0) +
      Number(
        findCol(h, BAU_ALIASES) >= 0 ||
          findCol(h, PLANNED_ALIASES) >= 0 ||
          findCol(h, GMS_VALUE_ALIASES) >= 0,
      );
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function parseMonthYm(raw: string): string | null {
  const cleaned = String(raw ?? "").trim();
  const m = /^([A-Za-z]{3,9})[-\s'](\d{2,4})$/i.exec(cleaned);
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const token = m[1].slice(0, 3).toLowerCase();
  const mi = months[token];
  if (mi === undefined) return null;
  const y = Number(m[2]);
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(mi + 1).padStart(2, "0")}`;
}

/** e.g. "MAY SO PLAN.xlsx" or sheet tab "MAY SO PLAN" → 2026-05 */
function parseMonthFromTitle(raw: string): string | null {
  const key = normalizeKey(raw);
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  for (const [token, mi] of Object.entries(months)) {
    if (key.includes(token)) {
      const year = new Date().getFullYear();
      return `${year}-${String(mi + 1).padStart(2, "0")}`;
    }
  }
  return null;
}

function gmsFromCells(gmsCell: number, bau: number, planUnits: number): number {
  if (gmsCell > 0) return gmsCell;
  if (bau > 0 && planUnits > 0) return (bau * planUnits) / 1.18;
  return 0;
}

/** Amazon | Flipkart blocks on one row (ASIN col 0, FSN col ~11, GMS per side). */
function parseGmsPlanSideBySide(rows: unknown[][], monthYm: string): ParsedGmsPlanRow[] {
  if (rows.length === 0) return [];

  const headerRow = detectHeaderRow(rows);
  const rawHeaders = (rows[headerRow] ?? []).slice(0, BAU_SHEET_MAX_COLS).map((c) => String(c ?? "").trim());
  const headers = rawHeaders.map((c) => normalizeKey(c));
  const asinIdx = findCol(headers, ASIN_ALIASES);
  const fsnIdx = findCol(headers, FSN_ALIASES);
  if (asinIdx < 0 || fsnIdx < 0 || fsnIdx <= asinIdx) return [];

  const gmsCols = findAllCols(headers, GMS_VALUE_ALIASES);
  const amazonGmsIdx = gmsCols.find((i) => i < fsnIdx) ?? -1;
  const flipkartGmsIdx = gmsCols.find((i) => i > fsnIdx) ?? -1;
  if (amazonGmsIdx < 0 && flipkartGmsIdx < 0) return [];

  const planCols = findExactCols(headers, PLAN_UNITS_ALIASES);
  const amazonPlanIdx = planCols.find((i) => i < fsnIdx) ?? -1;
  const flipkartPlanIdx = planCols.find((i) => i > fsnIdx) ?? -1;

  const bauCols = findAllCols(headers, BAU_ALIASES);
  const amazonBauIdx = bauCols.find((i) => i < fsnIdx) ?? -1;
  const flipkartBauIdx = bauCols.find((i) => i > fsnIdx) ?? -1;

  const amazonNameIdx = findColInRange(headers, NAME_ALIASES, asinIdx + 1, fsnIdx);
  const flipkartNameIdx = findColInRange(headers, NAME_ALIASES, fsnIdx + 1, headers.length);

  const out: ParsedGmsPlanRow[] = [];

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = (rows[r] ?? []).slice(0, BAU_SHEET_MAX_COLS);
    const asin = normalizeAsin(String(row[asinIdx] ?? ""));
    const fsn = normalizeFsn(String(row[fsnIdx] ?? ""));
    if (!asin && !fsn) continue;

    if (asin) {
      const amazonName =
        amazonNameIdx >= 0 ? String(row[amazonNameIdx] ?? "").trim() : asin;
      const gms = gmsFromCells(
        amazonGmsIdx >= 0 ? asNumber(row[amazonGmsIdx]) : 0,
        amazonBauIdx >= 0 ? asNumber(row[amazonBauIdx]) : 0,
        amazonPlanIdx >= 0 ? asNumber(row[amazonPlanIdx]) : 0,
      );
      if (gms > 0) {
        out.push({
          product_name: amazonName || asin,
          asin,
          month_ym: monthYm,
          planned_gms: gms,
          target_gms: gms,
        });
      }
    }

    if (fsn) {
      const flipkartName =
        flipkartNameIdx >= 0 ? String(row[flipkartNameIdx] ?? "").trim() : fsn;
      const gms = gmsFromCells(
        flipkartGmsIdx >= 0 ? asNumber(row[flipkartGmsIdx]) : 0,
        flipkartBauIdx >= 0 ? asNumber(row[flipkartBauIdx]) : 0,
        flipkartPlanIdx >= 0 ? asNumber(row[flipkartPlanIdx]) : 0,
      );
      if (gms > 0) {
        out.push({
          product_name: flipkartName || fsn,
          fsn,
          month_ym: monthYm,
          planned_gms: gms,
          target_gms: gms,
        });
      }
    }
  }

  return out;
}

function normalizeAsin(raw: string): string {
  return raw.trim();
}

function normalizeFsn(raw: string): string {
  return raw.trim().toUpperCase();
}

function parseBauRowsFromSheet(
  rows: unknown[][],
  sheetName: string,
): ParsedBauRow[] {
  if (rows.length === 0) return [];

  const headerRow = detectHeaderRow(rows);
  const headerCells = (rows[headerRow] ?? []).slice(0, BAU_SHEET_MAX_COLS);
  const headers = headerCells.map((c) => normalizeKey(c));
  const asinIdx = findCol(headers, ASIN_ALIASES);
  const fsnIdx = findCol(headers, FSN_ALIASES);
  const codeIdx = asinIdx < 0 && fsnIdx < 0 ? findCol(headers, CODE_ALIASES) : -1;
  const nameIdx = findCol(headers, NAME_ALIASES);
  const bauIdx = findCol(headers, BAU_ALIASES);
  const channelHint = sheetChannelHint(sheetName);

  if (bauIdx < 0) return [];
  if (asinIdx < 0 && fsnIdx < 0 && codeIdx < 0 && nameIdx < 0) return [];

  const out: ParsedBauRow[] = [];

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = (rows[r] ?? []).slice(0, BAU_SHEET_MAX_COLS);
    if (!row) continue;
    const bau_price = asNumber(row[bauIdx]);
    if (bau_price <= 0) continue;

    let asin = asinIdx >= 0 ? normalizeAsin(String(row[asinIdx] ?? "")) : "";
    let fsn = fsnIdx >= 0 ? normalizeFsn(String(row[fsnIdx] ?? "")) : "";
    const genericCode = codeIdx >= 0 ? String(row[codeIdx] ?? "").trim() : "";
    const product_name =
      nameIdx >= 0
        ? String(row[nameIdx] ?? "").trim()
        : asin || fsn || genericCode;

    if (!product_name && !asin && !fsn && !genericCode) continue;

    if (!asin && !fsn && genericCode) {
      if (/^B0[A-Z0-9]{8,}$/i.test(genericCode)) asin = normalizeAsin(genericCode);
      else fsn = normalizeFsn(genericCode);
    }

    if (channelHint === "amazon" && !asin) continue;
    if (channelHint === "flipkart" && !fsn) continue;
    if (!asin && !fsn && !product_name) continue;

    out.push({
      product_name: product_name || asin || fsn || genericCode,
      bau_price,
      ...(asin ? { asin } : {}),
      ...(fsn ? { fsn } : {}),
    });
  }

  return out;
}

/** Combined Amazon + Flipkart BAU workbook (one or more tabs). */
export async function parseBauPriceFile(file: File): Promise<ParsedBauPayload> {
  const buffer = await file.arrayBuffer();
  const sheets = readWorkbookSheets(buffer);
  const errors: ParsedRowError[] = [];
  const out: ParsedBauRow[] = [];

  let anyBauCol = false;
  for (const { sheetName, rows } of sheets) {
    const headerRow = detectHeaderRow(rows);
    const headers = (rows[headerRow] ?? []).map((c) => normalizeKey(c));
    if (findCol(headers, BAU_ALIASES) >= 0) anyBauCol = true;
    out.push(...parseBauRowsFromSheet(rows, sheetName));
  }

  if (!anyBauCol) {
    throw new Error("BAU sheet must include a BAU / BAU SP price column.");
  }
  if (out.length === 0) {
    throw new Error(
      "No BAU rows found. Use tabs named Amazon / Flipkart with ASIN or FSN and BAU SP columns.",
    );
  }

  return { rows: out, errors };
}

/** Combined plan sheet — same row can list ASIN + FSN; plan applies to both channels. */
export async function parseGmsPlanFile(file: File): Promise<ParsedGmsPlanPayload> {
  const buffer = await file.arrayBuffer();
  const sheets = readWorkbookSheets(buffer);
  const fileMonthYm = parseMonthFromTitle(file.name);
  const errors: ParsedRowError[] = [];
  const out: ParsedGmsPlanRow[] = [];

  for (const { sheetName, rows } of sheets) {
    if (rows.length === 0) continue;

    const monthYm =
      parseMonthFromTitle(sheetName) ?? fileMonthYm ?? new Date().toISOString().slice(0, 7);
    const sideBySide = parseGmsPlanSideBySide(rows, monthYm);
    if (sideBySide.length > 0) {
      out.push(...sideBySide);
      continue;
    }

    const headerRow = detectHeaderRow(rows);
    const rawHeaders = (rows[headerRow] ?? []).slice(0, BAU_SHEET_MAX_COLS).map((c) => String(c ?? "").trim());
    const headers = rawHeaders.map((c) => normalizeKey(c));
    const asinIdx = findCol(headers, ASIN_ALIASES);
    const fsnIdx = findCol(headers, FSN_ALIASES);
    const codeIdx = asinIdx < 0 && fsnIdx < 0 ? findCol(headers, CODE_ALIASES) : -1;
    const nameIdx = findCol(headers, NAME_ALIASES);

    if (asinIdx < 0 && fsnIdx < 0 && codeIdx < 0 && nameIdx < 0) continue;

    const monthCols = rawHeaders
      .map((raw, index) => ({ index, ym: parseMonthYm(raw) }))
      .filter((c): c is { index: number; ym: string } => Boolean(c.ym));

    const plannedIdx = findCol(headers, PLANNED_ALIASES);
    const targetIdx = findCol(headers, TARGET_ALIASES);

    if (monthCols.length === 0 && plannedIdx < 0) continue;

    for (let r = headerRow + 1; r < rows.length; r++) {
    const row = (rows[r] ?? []).slice(0, BAU_SHEET_MAX_COLS);
    if (!row.length) continue;

    const asin =
      asinIdx >= 0 ? normalizeAsin(String(row[asinIdx] ?? "")) : undefined;
    const fsn = fsnIdx >= 0 ? normalizeFsn(String(row[fsnIdx] ?? "")) : undefined;
    const genericCode = codeIdx >= 0 ? String(row[codeIdx] ?? "").trim() : "";
    const product_name =
      nameIdx >= 0
        ? String(row[nameIdx] ?? "").trim()
        : asin || fsn || genericCode;

    if (!product_name && !asin && !fsn && !genericCode) continue;

    const base: Omit<ParsedGmsPlanRow, "month_ym" | "planned_gms" | "target_gms"> = {
      product_name: product_name || asin || fsn || genericCode,
      ...(asin ? { asin } : {}),
      ...(fsn ? { fsn } : {}),
    };

    if (!asin && !fsn && genericCode) {
      if (/^B0[A-Z0-9]{8,}$/i.test(genericCode)) {
        base.asin = normalizeAsin(genericCode);
      } else {
        base.fsn = normalizeFsn(genericCode);
      }
    }

    if (monthCols.length > 0) {
      for (const col of monthCols) {
        const val = asNumber(row[col.index]);
        if (val <= 0) continue;
        out.push({
          ...base,
          month_ym: col.ym,
          planned_gms: val,
          target_gms: val,
        });
      }
    } else {
      const planned = plannedIdx >= 0 ? asNumber(row[plannedIdx]) : 0;
      const target = targetIdx >= 0 ? asNumber(row[targetIdx]) : planned;
      const nowYm = new Date().toISOString().slice(0, 7);
      if (planned > 0 || target > 0) {
        out.push({
          ...base,
          month_ym: nowYm,
          planned_gms: planned,
          target_gms: target,
        });
      }
    }
    }
  }

  if (out.length === 0) {
    throw new Error(
      "GMS plan needs month columns (May-26), Planned/Target GMS columns, or a combined Amazon+Flipkart sheet with ASIN, FSN, and GMS columns.",
    );
  }

  return { rows: out, errors };
}
