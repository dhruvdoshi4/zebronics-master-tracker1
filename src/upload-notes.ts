import type { ParsedUploadPayload } from "./types";

export type UploadLatestDaySellout = {
  saleDate: string;
  totalUnits: number;
};

export function buildSelloutUploadNotes(payload: ParsedUploadPayload): string {
  const doc: Record<string, unknown> = {
    processedRows: payload.validCount,
  };
  if (payload.channelLatestDaySellout && payload.channelLatestDaySellout.totalUnits > 0) {
    doc.latestDaySellout = payload.channelLatestDaySellout;
  }
  return JSON.stringify(doc);
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
