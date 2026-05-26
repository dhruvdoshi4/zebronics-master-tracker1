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

/**
 * Category roll-ups: prefer `category_monthly_sellout` when present (canonical ingest).
 * Using max() against stale `daily_sales` FY-spread rows inflated or distorted charts.
 */
export function mergeCategoryMonthlyFromTableAndDaily(
  fromTable: Map<string, number>,
  fromDaily: Map<string, number>,
): Map<string, number> {
  if (fromTable.size > 0) return new Map(fromTable);
  return new Map(fromDaily);
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

function previousFyMonthYms(previousFyStart: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const calMonth = (3 + i) % 12;
    const year = i < 9 ? previousFyStart : previousFyStart + 1;
    return `${year}-${String(calMonth + 1).padStart(2, "0")}`;
  });
}

function priorFyMonthKeysSum(
  monthlyMap: Map<string, number>,
  previousFyStart: number,
): number {
  return previousFyMonthYms(previousFyStart).reduce(
    (sum, ym) => sum + (monthlyMap.get(ym) ?? 0),
    0,
  );
}

/**
 * Prefer summed month columns when they match the sheet **FY … SO** cell; otherwise trust the
 * sheet total (e.g. after legacy spread stripping undervalued real months).
 */
export function resolveAuthoritativePriorFyTotal(
  monthSum: number,
  priorFySoUnitsFromSheet: number | null | undefined,
): number {
  const sheet = Number(priorFySoUnitsFromSheet ?? 0);
  if (sheet <= 0) return monthSum;
  if (monthSum <= 0) return sheet;
  if (monthSum >= sheet * 0.98) return monthSum;
  return sheet;
}

/** All prior-FY months equal (±2%) — typical FY-total÷12 spread with no real month columns. */
function isFlatPriorFyMonths(
  monthlyMap: Map<string, number>,
  previousFyStart: number,
): boolean {
  const yms = previousFyMonthYms(previousFyStart);
  const values = yms.map((ym) => monthlyMap.get(ym) ?? 0).filter((v) => v > 0);
  if (values.length < 10) return false;
  const first = values[0]!;
  const tolerance = Math.max(1, first * 0.02);
  return values.every((v) => Math.abs(v - first) <= tolerance);
}

function clearPriorFyMonths(
  monthlyMap: Map<string, number>,
  previousFyStart: number,
): Map<string, number> {
  const out = new Map(monthlyMap);
  for (const ym of previousFyMonthYms(previousFyStart)) {
    out.set(ym, 0);
  }
  return out;
}

/** FY total was spread ÷12 with no real month columns — flat bars are not real MoM data. */
function isSyntheticUniformFySpread(
  monthlyMap: Map<string, number>,
  fyTotal: number,
  previousFyStart: number,
): boolean {
  const perMonth = fyTotal / 12;
  if (perMonth <= 0) return false;

  const yms = previousFyMonthYms(previousFyStart);
  let sum = 0;
  for (const ym of yms) {
    const stored = monthlyMap.get(ym) ?? 0;
    if (stored <= 0) return false;
    sum += stored;
    const ratio = stored / perMonth;
    if (ratio < 0.97 || ratio > 1.03) return false;
  }
  return sum >= fyTotal * 0.97 && sum <= fyTotal * 1.03;
}

/**
 * Legacy uploads spread prior-FY SO ÷ 12 into each month and also stored real month columns.
 * When a month is ~2× the FY spread slice, subtract the spread portion.
 * When every prior-FY month is only the spread slice, clear those months (no invented MoM).
 */
export function stripFySpreadOverlapFromMonthMap(
  monthlyMap: Map<string, number>,
  priorFySoUnits: number | null | undefined,
  previousFyStart: number,
): Map<string, number> {
  const fyTotal = Number(priorFySoUnits ?? 0);

  if (fyTotal > 0) {
    const rawPriorFySum = priorFyMonthKeysSum(monthlyMap, previousFyStart);
    if (rawPriorFySum >= fyTotal * 0.98 && rawPriorFySum <= fyTotal * 1.02) {
      return monthlyMap;
    }
  }

  if (fyTotal > 0 && isSyntheticUniformFySpread(monthlyMap, fyTotal, previousFyStart)) {
    return clearPriorFyMonths(monthlyMap, previousFyStart);
  }

  if (isFlatPriorFyMonths(monthlyMap, previousFyStart)) {
    return clearPriorFyMonths(monthlyMap, previousFyStart);
  }

  if (fyTotal <= 0) return monthlyMap;

  const perMonth = fyTotal / 12;
  if (perMonth <= 0) return monthlyMap;

  const out = new Map(monthlyMap);
  for (const ym of previousFyMonthYms(previousFyStart)) {
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
  /** Never advance the FY window past the upload snapshot (stray future month keys in DB). */
  if (snapshotDate) {
    return snapshotDate;
  }
  return newest ?? today;
}

export { monthColumnUnitsAtSaleDate };
