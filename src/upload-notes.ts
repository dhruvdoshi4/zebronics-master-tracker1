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
  return JSON.stringify(doc);
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
