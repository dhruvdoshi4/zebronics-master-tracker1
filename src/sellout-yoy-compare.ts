import type { DailySale } from "./types";

/** `category_monthly_sellout.month_ym` suffix for YoY MTD totals parsed from prior-year daily columns. */
export const PRIOR_YEAR_MTD_MONTH_YM_SUFFIX = "-mtd";

export function priorYearMtdCategoryMonthKey(priorMonthYm: string): string {
  return `${priorMonthYm}${PRIOR_YEAR_MTD_MONTH_YM_SUFFIX}`;
}

export function isPriorYearMtdCategoryMonthKey(monthYm: string): boolean {
  return monthYm.endsWith(PRIOR_YEAR_MTD_MONTH_YM_SUFFIX);
}

/** Calendar month key for the same month one year earlier (2026-05 → 2025-05). */
export function priorYearMonthYm(monthYm: string): string {
  const [y, m] = monthYm.split("-").map(Number);
  return `${y - 1}-${String(m).padStart(2, "0")}`;
}

/** Inclusive ISO date range for prior-year MTD through the snapshot day-of-month. */
export function priorYearMtdRangeFromSnapshot(snapshotDate: string): {
  priorMonthYm: string;
  start: string;
  end: string;
} {
  const snap = new Date(`${snapshotDate}T12:00:00`);
  const y = snap.getFullYear() - 1;
  const m = snap.getMonth() + 1;
  const d = snap.getDate();
  const priorMonthYm = `${y}-${String(m).padStart(2, "0")}`;
  return {
    priorMonthYm,
    start: `${priorMonthYm}-01`,
    end: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  };
}

/** Human-readable prior-year MTD window aligned to the snapshot day (e.g. May 1–20, 2025). */
export function formatPriorYearMtdPeriodLabel(snapshotDate: string): string {
  const { start, end } = priorYearMtdRangeFromSnapshot(snapshotDate);
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

function monthHasDayLevelRows(rows: DailySale[], monthYm: string): boolean {
  return rows.some(
    (r) => r.sale_date.startsWith(monthYm) && !/-01$/.test(r.sale_date),
  );
}

/**
 * Sum sellout between start and end (inclusive). Skips month-anchor rows (-01) when
 * day-level rows exist for that month so Apr-25 columns are not double-counted.
 */
/** YoY MTD slice — day-level cells only (never month anchors like May-25 → 2025-05-01). */
export function sumDailySelloutMtdInRange(
  rows: DailySale[],
  start: string,
  end: string,
): number {
  let total = 0;
  for (const row of rows) {
    if (row.sale_date < start || row.sale_date > end) continue;
    if (/-01$/.test(row.sale_date)) continue;
    total += Math.max(0, Number(row.units_sold ?? 0));
  }
  return total;
}

export function sumDailySelloutInRange(
  rows: DailySale[],
  start: string,
  end: string,
): number {
  const monthsInRange = new Set<string>();
  for (const row of rows) {
    if (row.sale_date >= start && row.sale_date <= end) {
      monthsInRange.add(row.sale_date.slice(0, 7));
    }
  }
  const dayLevelMonths = new Set(
    [...monthsInRange].filter((ym) => monthHasDayLevelRows(rows, ym)),
  );

  let total = 0;
  for (const row of rows) {
    if (row.sale_date < start || row.sale_date > end) continue;
    if (/-01$/.test(row.sale_date) && dayLevelMonths.has(row.sale_date.slice(0, 7))) {
      continue;
    }
    total += Math.max(0, Number(row.units_sold ?? 0));
  }
  return total;
}

/** Prior-year full month from monthly map, or prorated anchor when only a month total exists. */
export function priorYearFullMonthUnits(
  monthYm: string,
  monthlyMap: Map<string, number>,
  snapshotDate: string | null,
): number {
  const priorYm = priorYearMonthYm(monthYm);
  const full = monthlyMap.get(priorYm) ?? 0;
  if (!snapshotDate || monthYm !== snapshotDate.slice(0, 7)) return full;

  const snap = new Date(`${snapshotDate}T12:00:00`);
  const daysInMonth = new Date(snap.getFullYear(), snap.getMonth() + 1, 0).getDate();
  if (daysInMonth <= 0 || full <= 0) return full;
  return (full * snap.getDate()) / daysInMonth;
}

export function priorYearComparableUnits(opts: {
  monthYm: string;
  isMtdOngoing: boolean;
  monthlyMap: Map<string, number>;
  dailyRows: DailySale[];
  snapshotDate: string | null;
  priorYearMtdSlice?: Map<string, number>;
}): number {
  const { monthYm, isMtdOngoing, monthlyMap, dailyRows, snapshotDate, priorYearMtdSlice } =
    opts;
  const priorYm = priorYearMonthYm(monthYm);

  if (isMtdOngoing) {
    /** Prefer **2025 May MTD** (etc.) from the master — same period last year, not full prior month. */
    const fromSlice = priorYearMtdSlice?.get(priorYm) ?? 0;
    if (fromSlice > 0) return fromSlice;
    if (snapshotDate) {
      const { start, end } = priorYearMtdRangeFromSnapshot(snapshotDate);
      const fromDaily = sumDailySelloutMtdInRange(dailyRows, start, end);
      if (fromDaily > 0) return fromDaily;
    }
    if (priorYearMtdSlice !== undefined) return 0;
    return priorYearFullMonthUnits(monthYm, monthlyMap, snapshotDate);
  }

  return monthlyMap.get(priorYm) ?? 0;
}

export function yoyGrowthPct(current: number, priorYear: number): number | null {
  if (priorYear <= 0) return null;
  return ((current - priorYear) / priorYear) * 100;
}

/** Per-product prior-year MTD from ingested `YYYY-MM-mtd-01` daily_sales anchors. */
export function buildPriorYearMtdSliceFromDailyRows(rows: DailySale[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const match = /^(\d{4}-\d{2})-mtd-01$/.exec(row.sale_date);
    if (!match) continue;
    const ym = match[1];
    out.set(ym, (out.get(ym) ?? 0) + Math.max(0, Number(row.units_sold ?? 0)));
  }
  return out;
}
