import * as XLSX from "xlsx";
import { findColumnIndex } from "./parser-columns";
import { normalizeMarginFraction } from "./pricing";
import { asNumber, normalizeKey } from "./utils";
import type { ParsedRowError } from "./types";

export type ParsedProductPricingRow = {
  product_name: string;
  asin?: string;
  fsn?: string;
  exclusivity?: "amazon" | "flipkart" | null;
  bau_sp: number;
  bau_margin_amazon: number;
  bau_margin_flipkart: number;
  event_sp: number;
  event_margin_amazon: number;
  event_margin_flipkart: number;
  top_up_ibd: number;
  is_flat_price: boolean;
};

export type ParsedProductPricingPayload = {
  rows: ParsedProductPricingRow[];
  errors: ParsedRowError[];
};

const ASIN_ALIASES = ["asin", "amazon asin"];
const FSN_ALIASES = ["fsn", "flipkart fsn"];
const NAME_ALIASES = ["model name", "model", "product name", "title"];
const BAU_SP_ALIASES = ["bau sp", "bau price", "bau rate", "bau"];
const EVENT_SP_ALIASES = [
  "rd suggested sp",
  "event sp",
  "event price",
  "event selling price",
  "promo sp",
];
const TOP_UP_IBD_ALIASES = ["top up ibd", "topup ibd", "top-up ibd"];
const FLAT_PRICE_ALIASES = ["flat price", "flat", "is flat", "flat pricing"];
const EXCLUSIVITY_ALIASES = ["exclusivity", "exclusive", "channel"];

const SHEET_MAX_COLS = 40;

function parseFlatPriceCell(raw: unknown): boolean {
  const key = normalizeKey(raw);
  if (!key) return false;
  return key === "y" || key === "yes" || key === "true" || key === "1" || key === "flat";
}

function parseFlatFromSheetRow(
  row: unknown[],
  remarksIdx: number,
  typeIdx: number,
  flatIdx: number,
): boolean {
  if (flatIdx >= 0 && parseFlatPriceCell(row[flatIdx])) return true;
  if (remarksIdx >= 0 && /\bflat\b/i.test(String(row[remarksIdx] ?? ""))) return true;
  if (typeIdx >= 0 && /\bflat\b/i.test(String(row[typeIdx] ?? ""))) return true;
  return false;
}

/** MF_HA has no Event SP column — only flat SKUs copy BAU → event at ingest. */
function finalizeParsedPricingRow(row: ParsedProductPricingRow): ParsedProductPricingRow {
  if (!row.is_flat_price || row.bau_sp <= 0) return row;
  return {
    ...row,
    event_sp: row.event_sp > 0 ? row.event_sp : row.bau_sp,
    event_margin_amazon:
      row.event_margin_amazon > 0 ? row.event_margin_amazon : row.bau_margin_amazon,
    event_margin_flipkart:
      row.event_margin_flipkart > 0 ? row.event_margin_flipkart : row.bau_margin_flipkart,
  };
}

function parseExclusivity(raw: unknown): "amazon" | "flipkart" | null {
  const key = normalizeKey(raw);
  if (key === "az" || key === "amazon" || key === "amz") return "amazon";
  if (key === "fk" || key === "flipkart" || key === "flip") return "flipkart";
  return null;
}

const PRIMARY_HEADER_FIELDS = new Set(
  [
    ...ASIN_ALIASES,
    ...FSN_ALIASES,
    ...NAME_ALIASES,
    ...BAU_SP_ALIASES,
    ...EVENT_SP_ALIASES,
    ...TOP_UP_IBD_ALIASES,
    ...FLAT_PRICE_ALIASES,
    ...EXCLUSIVITY_ALIASES,
    "vertical",
    "base ibd",
    "nep",
    "ho stock",
  ].map((alias) => normalizeKey(alias)),
);

function fieldIsPrimaryHeader(field: string): boolean {
  const f = normalizeKey(field);
  if (!f) return false;
  // Channel sub-columns under a group row (Margin % / Basic / etc.)
  if (f === "az" || f === "fk") return false;
  if (PRIMARY_HEADER_FIELDS.has(f)) return true;
  return [...PRIMARY_HEADER_FIELDS].some((alias) => {
    if (alias.length < 4) return false;
    return f === alias || f.includes(alias);
  });
}

function buildCompositeHeaders(groupRow: string[], fieldRow: string[]): string[] {
  let lastGroup = "";
  return fieldRow.map((field, index) => {
    if (fieldIsPrimaryHeader(field)) {
      lastGroup = "";
    } else {
      const groupRaw = String(groupRow[index] ?? "").trim();
      if (groupRaw) lastGroup = groupRaw;
    }
    const g = normalizeKey(lastGroup);
    const f = normalizeKey(field);
    if (!g && !f) return "";
    if (!g) return f;
    if (!f) return g;
    return `${g} ${f}`;
  });
}

function marginColumnIndex(
  headers: string[],
  channel: "amazon" | "flipkart",
  pass: "bau" | "event",
  exclude: ReadonlySet<number>,
): number {
  const channelToken = channel === "amazon" ? "az" : "fk";
  const candidates = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => {
      if (!header || exclude.has(index)) return false;
      if (!header.includes("margin")) return false;
      if (!header.includes(channelToken)) return false;
      if (header.includes("basic")) return false;
      return true;
    });
  if (pass === "bau") {
    const eventCol = headers.findIndex(
      (h) => h.includes("rd suggested") || h.includes("event sp"),
    );
    const beforeEvent =
      eventCol >= 0 ? candidates.filter(({ index }) => index < eventCol) : candidates;
    return beforeEvent[0]?.index ?? candidates[0]?.index ?? -1;
  }
  if (pass === "event") {
    const eventCol = headers.findIndex(
      (h) => h.includes("rd suggested") || h.includes("event sp"),
    );
    if (eventCol < 0) return -1;
    const afterEvent = candidates.find(({ index }) => index > eventCol);
    return afterEvent?.index ?? -1;
  }
  return -1;
}

function detectPricingHeaderLayout(
  rows: unknown[][],
): { fieldRowIndex: number; groupRowIndex: number } | null {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const fieldRow = (rows[i] ?? [])
      .slice(0, SHEET_MAX_COLS)
      .map((c) => normalizeKey(c));
    const hasBau =
      fieldRow.some((f) => f === "bau sp" || f.endsWith(" bau sp") || f === "az bau sp") ||
      findColumnIndex(fieldRow, BAU_SP_ALIASES) >= 0;
    const hasId =
      findColumnIndex(fieldRow, ASIN_ALIASES) >= 0 ||
      findColumnIndex(fieldRow, FSN_ALIASES) >= 0;
    if (hasBau && hasId) {
      return { fieldRowIndex: i, groupRowIndex: Math.max(0, i - 1) };
    }
  }
  return null;
}

function findExactFieldColumn(fieldRow: string[], label: string): number {
  const target = normalizeKey(label);
  return fieldRow.findIndex((field) => normalizeKey(field) === target);
}

function readSharedBauSp(
  row: unknown[],
  fieldRow: string[],
  headers: string[],
): number {
  const sharedIdx = findExactFieldColumn(fieldRow, "bau sp");
  const azIdx = findExactFieldColumn(fieldRow, "az bau sp");
  const shared = sharedIdx >= 0 ? asNumber(row[sharedIdx]) : 0;
  if (shared > 0) return shared;
  const azOnly = azIdx >= 0 ? asNumber(row[azIdx]) : 0;
  if (azOnly > 0) return azOnly;
  const fallbackIdx = findColumnIndex(headers, BAU_SP_ALIASES);
  return fallbackIdx >= 0 ? asNumber(row[fallbackIdx]) : 0;
}

/**
 * Jan ART (2-row) and MF_HA / ZEB (3-row) layouts.
 * Detects the header row dynamically, then reads BAU SP + AZ/FK margins.
 */
function parsePricingTemplateRows(rows: unknown[][]): ParsedProductPricingRow[] {
  const layout = detectPricingHeaderLayout(rows);
  if (!layout) return [];

  const groupRow = (rows[layout.groupRowIndex] ?? [])
    .slice(0, SHEET_MAX_COLS)
    .map((c) => String(c ?? "").trim());
  const fieldRow = (rows[layout.fieldRowIndex] ?? [])
    .slice(0, SHEET_MAX_COLS)
    .map((c) => normalizeKey(c));
  if (findColumnIndex(fieldRow, ASIN_ALIASES) < 0 && findColumnIndex(fieldRow, FSN_ALIASES) < 0) {
    return [];
  }

  const headers = buildCompositeHeaders(groupRow, fieldRow);

  const asinIdx = findColumnIndex(headers, ASIN_ALIASES);
  const fsnIdx = findColumnIndex(headers, FSN_ALIASES);
  const nameIdx = findColumnIndex(headers, NAME_ALIASES);
  const eventSpIdx = findColumnIndex(headers, EVENT_SP_ALIASES);
  const topUpIdx = findColumnIndex(headers, TOP_UP_IBD_ALIASES);
  const flatIdx = findColumnIndex(headers, FLAT_PRICE_ALIASES);
  const exclIdx = findColumnIndex(headers, EXCLUSIVITY_ALIASES);
  const remarksIdx = findExactFieldColumn(fieldRow, "remarks");
  const typeIdx = findExactFieldColumn(fieldRow, "type");

  const bauMarginAzIdx = marginColumnIndex(headers, "amazon", "bau", new Set());
  const bauMarginFkIdx = marginColumnIndex(
    headers,
    "flipkart",
    "bau",
    new Set([bauMarginAzIdx]),
  );
  const eventMarginAzIdx = marginColumnIndex(
    headers,
    "amazon",
    "event",
    new Set([bauMarginAzIdx, bauMarginFkIdx]),
  );
  const eventMarginFkIdx = marginColumnIndex(
    headers,
    "flipkart",
    "event",
    new Set([bauMarginAzIdx, bauMarginFkIdx, eventMarginAzIdx]),
  );

  const out: ParsedProductPricingRow[] = [];
  const dataStartRow = layout.fieldRowIndex + 1;

  for (let r = dataStartRow; r < rows.length; r++) {
    const row = (rows[r] ?? []).slice(0, SHEET_MAX_COLS);
    const asin = asinIdx >= 0 ? String(row[asinIdx] ?? "").trim() : "";
    const fsn =
      fsnIdx >= 0 ? String(row[fsnIdx] ?? "").trim().toUpperCase() : "";
    const product_name =
      (nameIdx >= 0 ? String(row[nameIdx] ?? "").trim() : "") || asin || fsn;
    if (!asin && !fsn && !product_name) continue;

    const bau_sp = readSharedBauSp(row, fieldRow, headers);
    const event_sp = eventSpIdx >= 0 ? asNumber(row[eventSpIdx]) : 0;
    if (bau_sp <= 0 && event_sp <= 0) continue;

    const readMargin = (idx: number) =>
      idx >= 0 ? normalizeMarginFraction(asNumber(row[idx])) : 0;

    out.push(
      finalizeParsedPricingRow({
        product_name,
        ...(asin ? { asin } : {}),
        ...(fsn ? { fsn } : {}),
        exclusivity: exclIdx >= 0 ? parseExclusivity(row[exclIdx]) : null,
        bau_sp,
        bau_margin_amazon: readMargin(bauMarginAzIdx),
        bau_margin_flipkart: readMargin(bauMarginFkIdx),
        event_sp,
        event_margin_amazon: readMargin(eventMarginAzIdx),
        event_margin_flipkart: readMargin(eventMarginFkIdx),
        top_up_ibd: topUpIdx >= 0 ? asNumber(row[topUpIdx]) : 0,
        is_flat_price: parseFlatFromSheetRow(row, remarksIdx, typeIdx, flatIdx),
      }),
    );
  }

  return out;
}

function bauRowsToPricingRows(
  bauRows: Array<{
    product_name: string;
    asin?: string;
    fsn?: string;
    bau_sp: number;
    event_sp: number;
  }>,
): ParsedProductPricingRow[] {
  const byKey = new Map<string, ParsedProductPricingRow>();

  for (const row of bauRows) {
    const key = `${row.asin ?? ""}|${row.fsn ?? ""}|${row.product_name}`;
    const existing = byKey.get(key) ?? {
      product_name: row.product_name,
      bau_sp: row.bau_sp,
      bau_margin_amazon: 0,
      bau_margin_flipkart: 0,
      event_sp: row.event_sp,
      event_margin_amazon: 0,
      event_margin_flipkart: 0,
      top_up_ibd: 0,
      is_flat_price: false,
      exclusivity: null as "amazon" | "flipkart" | null,
    };

    if (row.asin) existing.asin = row.asin;
    if (row.fsn) existing.fsn = row.fsn;
    if (row.bau_sp > 0) existing.bau_sp = row.bau_sp;
    if (row.event_sp > 0) existing.event_sp = row.event_sp;

    byKey.set(key, existing);
  }

  return [...byKey.values()];
}

function readWorkbookPricingSheets(buffer: ArrayBuffer): unknown[][][] {
  const wb = XLSX.read(buffer, { type: "array", sheetRows: 0 });
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: true,
    }) as unknown[][];
  });
}

/** Parse manager BAU / Jan ART pricing workbook (Amazon + Flipkart, not Qcom). */
export async function parseProductPricingBauFile(file: File): Promise<ParsedProductPricingPayload> {
  const buffer = await file.arrayBuffer();
  const sheetRows = readWorkbookPricingSheets(buffer);
  const templateRows: ParsedProductPricingRow[] = [];

  for (const rows of sheetRows) {
    templateRows.push(...parsePricingTemplateRows(rows));
  }

  if (templateRows.length > 0) {
    return { rows: templateRows, errors: [] };
  }

  const legacy = await import("./parsers-gms").then((m) => m.parseBauPriceFile(file));
  return {
    rows: bauRowsToPricingRows(legacy.rows),
    errors: legacy.errors,
  };
}
