import type { DailySale } from "./types";
import { asNumber } from "./utils";

/** FY start year for a calendar month (Apr–Mar). */
export function fyStartForMonthYm(monthYm: string): number {
  const [y, m] = monthYm.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

/** Sum Event SO month columns (Apr-25, …) on this row that fall in the given FY. */
export function monthColumnSumForFy(
  row: unknown[],
  monthlyColumns: Array<{ index: number; date: string }>,
  fyStart: number,
): number {
  let sum = 0;
  for (const col of monthlyColumns) {
    if (fyStartForMonthYm(col.date.slice(0, 7)) !== fyStart) continue;
    sum += asNumber(row[col.index]);
  }
  return sum;
}

function monthColumnUnitsAtSaleDate(
  row: unknown[],
  monthlyColumns: Array<{ index: number; date: string }>,
  saleDate: string,
): number {
  for (const col of monthlyColumns) {
    if (col.date === saleDate) return asNumber(row[col.index]);
  }
  return 0;
}

/** Per month: prefer sheet month column (YYYY-MM-01); use day-level sum only when anchor is missing/zero. */
export function buildSheetMonthUnitsMap(rows: DailySale[]): Map<string, number> {
  const anchorByMonth = new Map<string, number>();
  const daySumByMonth = new Map<string, number>();

  for (const row of rows) {
    const ym = row.sale_date.slice(0, 7);
    const units = Math.max(0, Number(row.units_sold ?? 0));
    if (/-01$/.test(row.sale_date)) {
      anchorByMonth.set(ym, (anchorByMonth.get(ym) ?? 0) + units);
    } else {
      daySumByMonth.set(ym, (daySumByMonth.get(ym) ?? 0) + units);
    }
  }

  const out = new Map<string, number>();
  const months = new Set([...anchorByMonth.keys(), ...daySumByMonth.keys()]);
  for (const ym of months) {
    const anchor = anchorByMonth.get(ym) ?? 0;
    const days = daySumByMonth.get(ym) ?? 0;
    out.set(ym, anchor > 0 ? anchor : days);
  }
  return out;
}

/** Merge maps — keep the larger value per month (table vs daily_sales fallback). */
export function mergeMonthUnitMapsMax(...sources: Map<string, number>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const map of sources) {
    for (const [ym, units] of map) {
      out.set(ym, Math.max(out.get(ym) ?? 0, units));
    }
  }
  return out;
}

export function rebuildMonthlyCombined(
  amazon: Map<string, number>,
  flipkart: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [ym, units] of amazon) out.set(ym, (out.get(ym) ?? 0) + units);
  for (const [ym, units] of flipkart) out.set(ym, (out.get(ym) ?? 0) + units);
  return out;
}

/**
 * Legacy uploads spread prior-FY SO ÷ 12 into each month and also stored real month columns.
 * When a month is ~2× the FY spread slice, subtract the spread portion.
 */
export function stripFySpreadOverlapFromMonthMap(
  monthlyMap: Map<string, number>,
  priorFySoUnits: number | null | undefined,
  previousFyStart: number,
): Map<string, number> {
  const fyTotal = Number(priorFySoUnits ?? 0);
  if (fyTotal <= 0) return monthlyMap;

  const perMonth = fyTotal / 12;
  if (perMonth <= 0) return monthlyMap;

  const out = new Map(monthlyMap);
  for (let i = 0; i < 12; i += 1) {
    const calMonth = (3 + i) % 12;
    const year = i < 9 ? previousFyStart : previousFyStart + 1;
    const ym = `${year}-${String(calMonth + 1).padStart(2, "0")}`;
    const stored = out.get(ym) ?? 0;
    if (stored <= 0) continue;
    const ratio = stored / perMonth;
    if (ratio >= 1.85) {
      out.set(ym, Math.max(0, stored - perMonth));
    }
  }
  return out;
}

/**
 * FY chart anchor: use upload snapshot, but if month columns extend further (e.g. picker
 * year wrong), align FY boundaries to the newest month in ingested data.
 */
export function resolveSelloutChartAnchorDate(
  snapshotDate: Date | null,
  monthlyMap: Map<string, number>,
): Date {
  const today = new Date();
  let newest: Date | null = null;
  for (const ym of monthlyMap.keys()) {
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const d = new Date(`${ym}-15T12:00:00`);
    if (!newest || d > newest) newest = d;
  }
  if (snapshotDate && newest) {
    return newest > snapshotDate ? newest : snapshotDate;
  }
  return snapshotDate ?? newest ?? today;
}

export { monthColumnUnitsAtSaleDate };
