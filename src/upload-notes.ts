import type { ParsedUploadPayload } from "./types";

export type UploadLatestDaySellout = {
  saleDate: string;
  totalUnits: number;
};

export function buildSelloutUploadNotes(payload: ParsedUploadPayload): string {
  const doc: Record<string, unknown> = {
    processedRows: payload.validCount,
    cartridgeRows: payload.cartridgeRowCount ?? 0,
  };
  if (payload.channelLatestDaySellout && payload.channelLatestDaySellout.totalUnits > 0) {
    doc.latestDaySellout = payload.channelLatestDaySellout;
  }
  if (
    payload.sheetCategoryKpis?.byCategory &&
    Object.keys(payload.sheetCategoryKpis.byCategory).length > 0
  ) {
    doc.sheetCategoryKpis = payload.sheetCategoryKpis;
  }
  if (
    payload.pravinPowerBankAmazonMonthTotals &&
    Object.keys(payload.pravinPowerBankAmazonMonthTotals).length > 0
  ) {
    doc.pravinPowerBankAmazonMonthTotals = payload.pravinPowerBankAmazonMonthTotals;
  }
  if (payload.pravinAmazonCocobluProductCodes?.length) {
    doc.pravinAmazonCocobluProductCodes = payload.pravinAmazonCocobluProductCodes;
  }
  if (payload.pravinPowerBankAmazonSheetKpis) {
    doc.pravinPowerBankAmazonSheetKpis = payload.pravinPowerBankAmazonSheetKpis;
  }
  return JSON.stringify(doc);
}

export type PravinPowerBankAmazonSheetKpis = {
  listingCount: number;
  may_mtd_units: number;
  /** Prior FY = sheet **2025 SO** column sum (this master has no Apr-25 month headers). */
  prior_fy_from_month_columns: number;
  /** Current FY = sheet **2026 SO** column sum. */
  current_fy_from_month_columns: number;
};

export function parsePravinPowerBankAmazonSheetKpisFromUploadNotes(
  notes: string | null | undefined,
): PravinPowerBankAmazonSheetKpis | null {
  const raw = String(notes ?? "").trim();
  if (!raw.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw) as {
      pravinPowerBankAmazonSheetKpis?: PravinPowerBankAmazonSheetKpis;
    };
    const block = parsed.pravinPowerBankAmazonSheetKpis;
    if (!block || typeof block !== "object") return null;
    const listingCount = Number(block.listingCount ?? 0);
    const may_mtd_units = Number(block.may_mtd_units ?? 0);
    const prior_fy_from_month_columns = Number(block.prior_fy_from_month_columns ?? 0);
    const current_fy_from_month_columns = Number(block.current_fy_from_month_columns ?? 0);
    if (
      !Number.isFinite(listingCount) ||
      !Number.isFinite(may_mtd_units) ||
      !Number.isFinite(prior_fy_from_month_columns) ||
      !Number.isFinite(current_fy_from_month_columns)
    ) {
      return null;
    }
    return {
      listingCount,
      may_mtd_units,
      prior_fy_from_month_columns,
      current_fy_from_month_columns,
    };
  } catch {
    return null;
  }
}

export function parsePravinAmazonCocobluProductCodesFromUploadNotes(
  notes: string | null | undefined,
): string[] {
  const raw = String(notes ?? "").trim();
  if (!raw.startsWith("{")) return [];
  try {
    const parsed = JSON.parse(raw) as { pravinAmazonCocobluProductCodes?: string[] };
    const list = parsed.pravinAmazonCocobluProductCodes;
    if (!Array.isArray(list)) return [];
    return list.map((c) => String(c ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Month-column roll-up stored at Pravin Amazon ingest (Click_tect + Cocoblu). */
export function parsePravinPowerBankAmazonMonthTotalsFromUploadNotes(
  notes: string | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  const raw = String(notes ?? "").trim();
  if (!raw.startsWith("{")) return out;
  try {
    const parsed = JSON.parse(raw) as {
      pravinPowerBankAmazonMonthTotals?: Record<string, number>;
    };
    const block = parsed.pravinPowerBankAmazonMonthTotals;
    if (!block || typeof block !== "object") return out;
    for (const [ym, units] of Object.entries(block)) {
      const n = Number(units ?? 0);
      if (/^\d{4}-\d{2}$/.test(ym) && Number.isFinite(n) && n > 0) {
        out.set(ym, n);
      }
    }
  } catch {
    return out;
  }
  return out;
}

export function parseLatestDaySelloutFromUploadNotes(
  notes: string | null | undefined,
): UploadLatestDaySellout | null {
  const raw = String(notes ?? "").trim();
  if (!raw.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw) as {
      latestDaySellout?: { saleDate?: string; totalUnits?: unknown };
    };
    const block = parsed.latestDaySellout;
    const saleDate = String(block?.saleDate ?? "").trim();
    const totalUnits = Number(block?.totalUnits ?? 0);
    if (!saleDate || !Number.isFinite(totalUnits) || totalUnits <= 0) return null;
    return { saleDate, totalUnits };
  } catch {
    return null;
  }
}
