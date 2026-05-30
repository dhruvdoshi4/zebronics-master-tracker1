import * as XLSX from "xlsx";
import {
  readSelectedSheetsRowArrays,
  readWorkbookSheetNames,
} from "./xlsx-fast";
import {
  findAllColumnIndices,
  findColumnIndex,
  findColumnIndexInRange,
  findExactColumnIndices,
} from "./parser-columns";
import { gmsFromBauAndSo, gmsFromFlipkartDrr, gmsFromFlipkartSellout } from "./gms";
import { asNumber, normalizeKey } from "./utils";
import type { ParsedRowError } from "./types";

export type ParsedBauRow = {
  product_name: string;
  bau_sp: number;
  event_sp: number;
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

export type ParsedAmazonGmsAvsMonth = {
  month_ym: string;
  gms_inr: number;
};

/** One ASIN row from GMS_AVS — all months from sheet columns (never BAU×SO). */
export type ParsedAmazonGmsAvsRow = {
  asin: string;
  sheet_category: string | null;
  sheet_sub_category: string | null;
  /** Authoritative report-month MTD from the "May MTD" column (when present). */
  may_mtd_inr: number;
  months: ParsedAmazonGmsAvsMonth[];
};

const ASIN_ALIASES = ["asin", "amazon asin", "amazon sku"];
const FSN_ALIASES = ["fsn", "flipkart fsn", "flipkart sku"];
const CODE_ALIASES = ["sku", "product code", "product id", "item id"];
const NAME_ALIASES = ["model name", "model", "product name", "title"];
const BAU_ALIASES = [
  "bau sp",
  "bau price",
  "bau rate",
  "bau",
  "mrp bau",
  "selling price",
  "sp",
  "selling sp",
];
const PLANNED_ALIASES = ["planned gms", "plan gms", "gms plan", "planned", "gms"];
const TARGET_ALIASES = ["target gms", "target", "gms target"];
const GMS_VALUE_ALIASES = ["gms"];
const PLAN_UNITS_ALIASES = ["plan"];
const DRR_ALIASES = ["drr", "7 days avg", "15 days avg"];
const EVENT_SP_ALIASES = [
  "event sp",
  "event price",
  "event selling price",
  "event mrp",
  "promo sp",
  "promotional sp",
  "deal sp",
];

/** BAU workbooks often have a phantom range to column XEV — only read real columns. */
const BAU_SHEET_MAX_COLS = 32;

function isPriceLikeHeader(header: string): boolean {
  return Boolean(header) && /(sp|price|mrp|rate)/i.test(header);
}

function isIdentifierHeader(header: string): boolean {
  if (!header) return false;
  return (
    ASIN_ALIASES.some((alias) => header.includes(alias)) ||
    FSN_ALIASES.some((alias) => header.includes(alias)) ||
    CODE_ALIASES.some((alias) => header.includes(alias)) ||
    NAME_ALIASES.some((alias) => header.includes(alias))
  );
}

/** Event / promo price columns — excludes bare "sp" matching on "event sp" for BAU. */
function isEventPriceHeader(header: string): boolean {
  if (!header || !isPriceLikeHeader(header)) return false;
  if (EVENT_SP_ALIASES.some((alias) => header === alias || header.includes(alias))) {
    return true;
  }
  if (/^event(?:\s|$)/.test(header)) return true;
  if (/^(promo|promotional|deal|offer)(?:\s|$)/.test(header)) return true;
  return false;
}

function listPriceColumnIndices(headers: string[], excludeIndices: ReadonlySet<number>): number[] {
  return headers
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => {
      if (!header || excludeIndices.has(index)) return false;
      if (isIdentifierHeader(header)) return false;
      return isPriceLikeHeader(header);
    })
    .map(({ index }) => index);
}

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
      Number(findColumnIndex(h, ASIN_ALIASES) >= 0 || findColumnIndex(h, FSN_ALIASES) >= 0 || findColumnIndex(h, CODE_ALIASES) >= 0) +
      Number(
        findColumnIndex(h, BAU_ALIASES) >= 0 ||
          findColumnIndex(h, PLANNED_ALIASES) >= 0 ||
          findColumnIndex(h, GMS_VALUE_ALIASES) >= 0,
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

function gmsFromCells(
  gmsCell: number,
  bau: number,
  planUnits: number,
  drr: number,
  eventSp: number,
  marketplace: "amazon" | "flipkart",
): number {
  if (gmsCell > 0) return gmsCell;
  if (marketplace === "flipkart" && drr > 0) {
    return gmsFromFlipkartDrr(bau, eventSp, drr);
  }
  if (marketplace === "flipkart" && planUnits > 0) {
    return gmsFromFlipkartSellout(bau, eventSp, planUnits);
  }
  if (bau > 0 && planUnits > 0) return gmsFromBauAndSo(bau, planUnits);
  return 0;
}

/** Amazon | Flipkart blocks on one row (ASIN col 0, FSN col ~11, GMS per side). */
function parseGmsPlanSideBySide(rows: unknown[][], monthYm: string): ParsedGmsPlanRow[] {
  if (rows.length === 0) return [];

  const headerRow = detectHeaderRow(rows);
  const rawHeaders = (rows[headerRow] ?? []).slice(0, BAU_SHEET_MAX_COLS).map((c) => String(c ?? "").trim());
  const headers = rawHeaders.map((c) => normalizeKey(c));
  const asinIdx = findColumnIndex(headers, ASIN_ALIASES);
  const fsnIdx = findColumnIndex(headers, FSN_ALIASES);
  if (asinIdx < 0 || fsnIdx < 0 || fsnIdx <= asinIdx) return [];

  const gmsCols = findAllColumnIndices(headers, GMS_VALUE_ALIASES);
  const amazonGmsIdx = gmsCols.find((i) => i < fsnIdx) ?? -1;
  const flipkartGmsIdx = gmsCols.find((i) => i > fsnIdx) ?? -1;
  if (amazonGmsIdx < 0 && flipkartGmsIdx < 0) return [];

  const planCols = findExactColumnIndices(headers, PLAN_UNITS_ALIASES);
  const amazonPlanIdx = planCols.find((i) => i < fsnIdx) ?? -1;
  const flipkartPlanIdx = planCols.find((i) => i > fsnIdx) ?? -1;

  const bauCols = findAllColumnIndices(headers, BAU_ALIASES);
  const amazonBauIdx = bauCols.find((i) => i < fsnIdx) ?? -1;
  const flipkartBauIdx = bauCols.find((i) => i > fsnIdx) ?? -1;

  const drrCols = findAllColumnIndices(headers, DRR_ALIASES);
  const amazonDrrIdx = drrCols.find((i) => i < fsnIdx) ?? -1;
  const flipkartDrrIdx = drrCols.find((i) => i > fsnIdx) ?? -1;

  const eventSpCols = findAllColumnIndices(headers, EVENT_SP_ALIASES);
  const amazonEventSpIdx = eventSpCols.find((i) => i < fsnIdx) ?? -1;
  const flipkartEventSpIdx = eventSpCols.find((i) => i > fsnIdx) ?? -1;

  const amazonNameIdx = findColumnIndexInRange(headers, NAME_ALIASES, asinIdx + 1, fsnIdx);
  const flipkartNameIdx = findColumnIndexInRange(headers, NAME_ALIASES, fsnIdx + 1, headers.length);

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
        amazonDrrIdx >= 0 ? asNumber(row[amazonDrrIdx]) : 0,
        amazonEventSpIdx >= 0 ? asNumber(row[amazonEventSpIdx]) : 0,
        "amazon",
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
        flipkartDrrIdx >= 0 ? asNumber(row[flipkartDrrIdx]) : 0,
        flipkartEventSpIdx >= 0 ? asNumber(row[flipkartEventSpIdx]) : 0,
        "flipkart",
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

function pickPriceColumnPair(
  headers: string[],
): { bauIdx: number; eventIdx: number } {
  let eventIdx = findColumnIndex(headers, EVENT_SP_ALIASES);
  if (eventIdx < 0) {
    eventIdx = headers.findIndex((header) => isEventPriceHeader(header));
  }

  const bauIdx = findColumnIndex(headers, BAU_ALIASES, {
    headerFilter: (header) => !isEventPriceHeader(header),
  });

  if (bauIdx >= 0) {
    let resolvedEvent = eventIdx;
    if (resolvedEvent < 0 || resolvedEvent === bauIdx) {
      const priceCols = listPriceColumnIndices(headers, new Set([bauIdx]));
      const eventLike = priceCols.find((index) => isEventPriceHeader(headers[index] ?? ""));
      const afterBau = priceCols.find((index) => index > bauIdx);
      resolvedEvent =
        eventLike ??
        afterBau ??
        (priceCols.length === 1 ? priceCols[0]! : -1);
    }
    if (resolvedEvent === bauIdx) resolvedEvent = -1;
    return { bauIdx, eventIdx: resolvedEvent };
  }

  const fallbackCandidates = listPriceColumnIndices(headers, new Set());
  if (fallbackCandidates.length === 0) return { bauIdx: -1, eventIdx: -1 };
  if (fallbackCandidates.length === 1) {
    return { bauIdx: fallbackCandidates[0]!, eventIdx: -1 };
  }
  return {
    bauIdx: fallbackCandidates[fallbackCandidates.length - 2]!,
    eventIdx: fallbackCandidates[fallbackCandidates.length - 1]!,
  };
}

function sidePricePair(
  headers: string[],
  start: number,
  end: number,
): { bauIdx: number; eventIdx: number } {
  const sliceHeaders = headers.slice(start, end);
  const { bauIdx, eventIdx } = pickPriceColumnPair(sliceHeaders);
  return {
    bauIdx: bauIdx >= 0 ? start + bauIdx : -1,
    eventIdx: eventIdx >= 0 ? start + eventIdx : -1,
  };
}

/** Amazon | Flipkart price blocks on one row (ASIN left, FSN right). */
function parseBauSideBySide(rows: unknown[][]): ParsedBauRow[] {
  if (rows.length === 0) return [];

  const headerRow = detectHeaderRow(rows);
  const headers = (rows[headerRow] ?? []).slice(0, BAU_SHEET_MAX_COLS).map((c) => normalizeKey(c));
  const asinIdx = findColumnIndex(headers, ASIN_ALIASES);
  const fsnIdx = findColumnIndex(headers, FSN_ALIASES);
  if (asinIdx < 0 || fsnIdx < 0 || fsnIdx <= asinIdx) return [];

  const amazonPrices = sidePricePair(headers, asinIdx + 1, fsnIdx);
  const flipkartPrices = sidePricePair(headers, fsnIdx + 1, headers.length);
  if (amazonPrices.bauIdx < 0 && flipkartPrices.bauIdx < 0) return [];

  const amazonNameIdx = findColumnIndexInRange(headers, NAME_ALIASES, asinIdx + 1, fsnIdx);
  const flipkartNameIdx = findColumnIndexInRange(headers, NAME_ALIASES, fsnIdx + 1, headers.length);

  const out: ParsedBauRow[] = [];

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = (rows[r] ?? []).slice(0, BAU_SHEET_MAX_COLS);
    const asin = normalizeAsin(String(row[asinIdx] ?? ""));
    const fsn = normalizeFsn(String(row[fsnIdx] ?? ""));
    if (!asin && !fsn) continue;

    if (asin && amazonPrices.bauIdx >= 0) {
      const bau_sp = asNumber(row[amazonPrices.bauIdx]);
      const event_sp =
        amazonPrices.eventIdx >= 0 ? asNumber(row[amazonPrices.eventIdx]) : 0;
      if (bau_sp > 0 || event_sp > 0) {
        out.push({
          product_name:
            (amazonNameIdx >= 0 ? String(row[amazonNameIdx] ?? "").trim() : "") || asin,
          bau_sp,
          event_sp,
          asin,
        });
      }
    }

    if (fsn && flipkartPrices.bauIdx >= 0) {
      const bau_sp = asNumber(row[flipkartPrices.bauIdx]);
      const event_sp =
        flipkartPrices.eventIdx >= 0 ? asNumber(row[flipkartPrices.eventIdx]) : 0;
      if (bau_sp > 0 || event_sp > 0) {
        out.push({
          product_name:
            (flipkartNameIdx >= 0 ? String(row[flipkartNameIdx] ?? "").trim() : "") || fsn,
          bau_sp,
          event_sp,
          fsn,
        });
      }
    }
  }

  return out;
}

function parseBauRowsFromSheet(
  rows: unknown[][],
  sheetName: string,
): ParsedBauRow[] {
  if (rows.length === 0) return [];

  const headerRow = detectHeaderRow(rows);
  const headerCells = (rows[headerRow] ?? []).slice(0, BAU_SHEET_MAX_COLS);
  const headers = headerCells.map((c) => normalizeKey(c));
  const asinIdx = findColumnIndex(headers, ASIN_ALIASES);
  const fsnIdx = findColumnIndex(headers, FSN_ALIASES);
  const codeIdx = asinIdx < 0 && fsnIdx < 0 ? findColumnIndex(headers, CODE_ALIASES) : -1;
  const nameIdx = findColumnIndex(headers, NAME_ALIASES);
  const { bauIdx, eventIdx } = pickPriceColumnPair(headers);
  const channelHint = sheetChannelHint(sheetName);

  if (bauIdx < 0) return [];
  if (asinIdx < 0 && fsnIdx < 0 && codeIdx < 0 && nameIdx < 0) return [];

  const out: ParsedBauRow[] = [];

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = (rows[r] ?? []).slice(0, BAU_SHEET_MAX_COLS);
    if (!row) continue;
    const bau_sp = asNumber(row[bauIdx]);
    const event_sp = eventIdx >= 0 ? asNumber(row[eventIdx]) : 0;
    if (bau_sp <= 0 && event_sp <= 0) continue;

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
      bau_sp,
      event_sp,
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
    if (findColumnIndex(headers, BAU_ALIASES, { headerFilter: (h) => !isEventPriceHeader(h) }) >= 0) {
      anyBauCol = true;
    }
    const sideBySide = parseBauSideBySide(rows);
    if (sideBySide.length > 0) {
      out.push(...sideBySide);
      continue;
    }
    out.push(...parseBauRowsFromSheet(rows, sheetName));
  }

  if (!anyBauCol) {
    throw new Error(
      "BAU sheet must include an SP/BAU price column (Event SP optional).",
    );
  }
  if (out.length === 0) {
    throw new Error(
      "No BAU rows found. Use tabs named Amazon / Flipkart with ASIN or FSN and SP / BAU SP columns.",
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
    const asinIdx = findColumnIndex(headers, ASIN_ALIASES);
    const fsnIdx = findColumnIndex(headers, FSN_ALIASES);
    const codeIdx = asinIdx < 0 && fsnIdx < 0 ? findColumnIndex(headers, CODE_ALIASES) : -1;
    const nameIdx = findColumnIndex(headers, NAME_ALIASES);

    if (asinIdx < 0 && fsnIdx < 0 && codeIdx < 0 && nameIdx < 0) continue;

    const monthCols = rawHeaders
      .map((raw, index) => ({ index, ym: parseMonthYm(raw) }))
      .filter((c): c is { index: number; ym: string } => Boolean(c.ym));

    const plannedIdx = findColumnIndex(headers, PLANNED_ALIASES);
    const targetIdx = findColumnIndex(headers, TARGET_ALIASES);

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

function findGmsAvsSheetName(names: string[]): string | undefined {
  const entries = names.map((raw) => ({ raw, key: normalizeKey(raw) }));
  const exact = entries.find(
    (e) => e.key === "gms avs" || e.key === "gms_avs" || e.key.replace(/\s/g, "") === "gmsavs",
  );
  if (exact) return exact.raw;
  const partial = entries.find((e) => e.key.includes("gms") && e.key.includes("avs"));
  if (partial) return partial.raw;
  return entries.find((e) => e.key === "gms")?.raw;
}

function findMayMtdColumnIndex(headers: string[]): number {
  const exact = headers.findIndex((h) => h === "may mtd");
  if (exact >= 0) return exact;
  const fuzzy = headers.findIndex(
    (h) =>
      h.includes("may mtd") ||
      h === "maymtd" ||
      (h.includes("may") && h.includes("mtd") && !h.includes("apr")),
  );
  if (fuzzy >= 0) return fuzzy;
  return headers.findIndex((h) => /\b20\d{2}\b/.test(h) && h.includes("may") && h.includes("mtd"));
}

const MONTH_TOKEN_TO_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Map GMS_AVS header → YYYY-MM using report snapshot date. */
function monthYmFromGmsAvsHeader(header: unknown, snapshotDate: string): string | null {
  const reportYm = snapshotDate.slice(0, 7);
  const [reportYear, reportMonth] = reportYm.split("-").map(Number);
  if (!reportYear || !reportMonth) return null;

  const fromLabel = parseMonthYm(String(header ?? ""));
  if (fromLabel) return fromLabel;

  const key = normalizeKey(header);
  if (!key) return null;
  if (key === "may mtd" || key.includes("may mtd")) return reportYm;

  const single = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/.exec(key);
  if (single) {
    const mi = MONTH_TOKEN_TO_INDEX[single[1]];
    if (mi === undefined) return null;
    let year = reportYear;
    if (mi + 1 > reportMonth) year -= 1;
    return `${year}-${String(mi + 1).padStart(2, "0")}`;
  }
  return null;
}

function excelSerialToMonthYm(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 40000) return null;
  const dc = XLSX.SSF.parse_date_code(serial);
  if (!dc?.y || !dc?.m) return null;
  return `${dc.y}-${String(dc.m).padStart(2, "0")}`;
}

/** Amazon consolidated report → official monthly GMS from GMS_AVS (all months on sheet). */
export async function parseAmazonGmsAvsFile(
  file: File,
  snapshotDate: string,
): Promise<{
  rows: ParsedAmazonGmsAvsRow[];
  errors: ParsedRowError[];
}> {
  const buffer = await file.arrayBuffer();
  const names = readWorkbookSheetNames(buffer);
  const sheetName = findGmsAvsSheetName(names);
  if (!sheetName) {
    throw new Error(
      'Sheet "GMS_AVS" was not found. Use the consolidated Amazon sellout workbook (tab GMS_AVS with a "May MTD" column).',
    );
  }
  const [sheet] = readSelectedSheetsRowArrays(buffer, [sheetName], 220);
  const rows = sheet?.rows ?? [];
  if (rows.length === 0) {
    throw new Error(`Sheet "${sheetName}" is empty.`);
  }
  const headerRow = detectHeaderRow(rows);
  const headers = (rows[headerRow] ?? []).map((c) => normalizeKey(c));
  const asinIdx = findColumnIndex(headers, ASIN_ALIASES);
  const mayMtdIdx = findMayMtdColumnIndex(headers);
  const categoryIdx = headers.findIndex((h) => h === "category" || h.includes("product category"));
  const subCategoryIdx = headers.findIndex(
    (h) => h === "sub category" || h === "subcategory" || h.includes("sub category"),
  );
  if (asinIdx < 0) {
    throw new Error(`Sheet "${sheetName}" must include an ASIN column.`);
  }

  const rawHeaders = rows[headerRow] ?? [];
  const namedMonthCols: Array<{ col: number; month_ym: string }> = [];
  const dailyCols: Array<{ col: number; month_ym: string }> = [];

  for (let c = 0; c < rawHeaders.length; c++) {
    const raw = rawHeaders[c];
    const monthFromName = monthYmFromGmsAvsHeader(raw, snapshotDate);
    if (monthFromName) {
      const headerKey = normalizeKey(raw);
      if (headerKey === "may mtd" || headerKey.includes("may mtd")) {
        continue;
      }
      namedMonthCols.push({ col: c, month_ym: monthFromName });
      continue;
    }
    if (typeof raw === "number") {
      const monthYm = excelSerialToMonthYm(raw);
      if (monthYm) dailyCols.push({ col: c, month_ym: monthYm });
    }
  }

  if (namedMonthCols.length === 0 && dailyCols.length === 0 && mayMtdIdx < 0) {
    const tabHint =
      normalizeKey(sheetName) === "gms"
        ? ` Tab "${sheetName}" has no month GMS columns.`
        : "";
    throw new Error(
      `Sheet "${sheetName}" must include month GMS (e.g. "May MTD", "Apr") or daily GMS columns.${tabHint}`,
    );
  }

  const out: ParsedAmazonGmsAvsRow[] = [];
  const errors: ParsedRowError[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const asin = normalizeAsin(String(row[asinIdx] ?? ""));
    if (!asin) continue;

    const byMonth = new Map<string, number>();

    for (const { col, month_ym } of dailyCols) {
      const v = asNumber(row[col]);
      if (v <= 0) continue;
      byMonth.set(month_ym, (byMonth.get(month_ym) ?? 0) + v);
    }

    for (const { col, month_ym } of namedMonthCols) {
      const v = asNumber(row[col]);
      if (v < 0) {
        errors.push({
          rowNumber: r + 1,
          reason: `Negative GMS for ${month_ym}`,
          payload: { asin, month_ym, gms_inr: v },
        });
        continue;
      }
      if (v > 0 || !byMonth.has(month_ym)) byMonth.set(month_ym, Math.max(0, v));
    }

    const reportYm = snapshotDate.slice(0, 7);
    let mayMtdInr = 0;
    if (mayMtdIdx >= 0) {
      const v = asNumber(row[mayMtdIdx]);
      if (v < 0) {
        errors.push({
          rowNumber: r + 1,
          reason: "Negative May MTD GMS",
          payload: { asin, gms_inr: v },
        });
      } else {
        mayMtdInr = Math.max(0, v);
        if (mayMtdInr > 0) byMonth.set(reportYm, mayMtdInr);
      }
    }

    if (byMonth.size === 0) continue;

    const sheet_category =
      categoryIdx >= 0 ? String(row[categoryIdx] ?? "").trim() || null : null;
    const sheet_sub_category =
      subCategoryIdx >= 0 ? String(row[subCategoryIdx] ?? "").trim() || null : null;

    out.push({
      asin,
      sheet_category,
      sheet_sub_category,
      may_mtd_inr: mayMtdInr,
      months: [...byMonth.entries()].map(([month_ym, gms_inr]) => ({ month_ym, gms_inr })),
    });
  }
  if (out.length === 0) {
    throw new Error("No ASIN rows with GMS values were found in GMS_AVS.");
  }
  return { rows: out, errors };
}
