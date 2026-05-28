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

/** Event SO month column row (YYYY-MM-01), including ISO timestamps from Supabase. */
function isMonthAnchorSaleDate(saleDate: string): boolean {
  const trimmed = String(saleDate ?? "").trim();
  if (!/^\d{4}-\d{2}/.test(trimmed)) return false;
  if (trimmed.length === 7) return true;
  return trimmed.slice(8, 10) === "01";
}

/** Per month: prefer sheet month column (YYYY-MM-01); use day-level sum only when anchor is missing/zero. */
export function buildSheetMonthUnitsMap(rows: DailySale[]): Map<string, number> {
  const anchorByMonth = new Map<string, number>();
  const daySumByMonth = new Map<string, number>();

  for (const row of rows) {
    const ym = row.sale_date.slice(0, 7);
    const units = Math.max(0, Number(row.units_sold ?? 0));
    if (isMonthAnchorSaleDate(row.sale_date)) {
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
 * Category roll-ups: prefer canonical `category_monthly_sellout` values for overlapping months,
 * but backfill missing months from `daily_sales` so prior-FY history does not disappear when
 * table rows are partial (e.g. only Apr/May present after a limited upload).
 */
export function mergeCategoryMonthlyFromTableAndDaily(
  fromTable: Map<string, number>,
  fromDaily: Map<string, number>,
): Map<string, number> {
  if (fromTable.size === 0) return new Map(fromDaily);
  if (fromDaily.size === 0) return new Map(fromTable);
  const out = new Map(fromTable);
  for (const [ym, units] of fromDaily) {
    if (!out.has(ym)) out.set(ym, units);
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

export function previousFyMonthYms(previousFyStart: number): string[] {
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
  if (values.length < 12) return false;
  const first = values[0]!;
  const tolerance = Math.max(1, first * 0.02);
  return values.every((v) => Math.abs(v - first) <= tolerance);
}

/** Prior-FY months differ enough to plot MoM (not a single FY÷12 slice repeated). */
/** Read ingested Event SO units for a calendar month (FK Apr-25 may sit on adjacent YYYY-MM keys). */
export function lookupSheetMonthUnits(
  monthlyMap: Map<string, number>,
  monthYm: string,
): number {
  const direct = monthlyMap.get(monthYm) ?? 0;
  if (direct > 0) return direct;
  const [, m] = monthYm.split("-").map(Number);
  if (m === 4) {
    return monthlyMap.get(`${monthYm.split("-")[0]}-04`) ?? 0;
  }
  return 0;
}

/**
 * Flipkart Event SO columns (Apr-25 … Mar-26) may anchor on a nearby YYYY-MM key.
 * Match by FY + calendar month before giving up on prior-FY chart points.
 */
export function lookupFlipkartPriorFyMonthUnits(
  monthlyMap: Map<string, number>,
  monthYm: string,
  previousFyStart: number,
): number {
  const direct = lookupSheetMonthUnits(monthlyMap, monthYm);
  if (direct > 0) return direct;

  const monthNum = Number(monthYm.split("-")[1]);
  if (!Number.isFinite(monthNum)) return 0;

  let best = 0;
  for (const [key, units] of monthlyMap) {
    if (units <= 0) continue;
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    if (fyStartForMonthYm(key) !== previousFyStart) continue;
    if (Number(key.split("-")[1]) === monthNum) {
      best = Math.max(best, units);
    }
  }
  return best;
}

/** Scale real prior-FY month shape to the sheet FY total (same as category roll-ups). */
export function scalePriorFyMonthMapToSheetTotal(
  monthlyMap: Map<string, number>,
  priorFySoUnits: number,
  previousFyStart: number,
): void {
  const total = Number(priorFySoUnits ?? 0);
  if (total <= 0) return;

  const yms = previousFyMonthYms(previousFyStart);
  const existing = yms.reduce(
    (sum, ym) => sum + lookupFlipkartPriorFyMonthUnits(monthlyMap, ym, previousFyStart),
    0,
  );
  if (existing <= 0) return;
  if (existing >= total * 0.99) return;

  const factor = total / existing;
  for (const ym of yms) {
    const prev = lookupFlipkartPriorFyMonthUnits(monthlyMap, ym, previousFyStart);
    monthlyMap.set(ym, Math.max(0, prev * factor));
  }
}

export function priorFyMonthsHaveRealVariation(
  monthlyMap: Map<string, number>,
  previousFyStart: number,
): boolean {
  const yms = previousFyMonthYms(previousFyStart);
  const values = yms.map((ym) => monthlyMap.get(ym) ?? 0).filter((v) => v > 0);
  if (values.length === 0) return false;
  if (values.length < 2) return true;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min <= 0) return max > 0;
  return max - min > Math.max(1, min * 0.05);
}

/** True when prior-FY month keys are only a legacy FY÷12 spread (flat MoM). */
export function isPriorFyMonthlyMapSynthetic(
  monthlyMap: Map<string, number>,
  previousFyStart: number,
  priorFySoUnits?: number | null,
): boolean {
  const fyTotal = Number(priorFySoUnits ?? 0);
  if (fyTotal > 0 && isSyntheticUniformFySpread(monthlyMap, fyTotal, previousFyStart)) {
    return true;
  }
  return isFlatPriorFyMonths(monthlyMap, previousFyStart);
}

function priorFyMonthSlice(
  monthlyMap: Map<string, number>,
  previousFyStart: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const ym of previousFyMonthYms(previousFyStart)) {
    out.set(ym, monthlyMap.get(ym) ?? 0);
  }
  return out;
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
      if (!isPriorFyMonthlyMapSynthetic(monthlyMap, previousFyStart, fyTotal)) {
        return monthlyMap;
      }
    }
  }

  if (fyTotal > 0 && isSyntheticUniformFySpread(monthlyMap, fyTotal, previousFyStart)) {
    return clearPriorFyMonths(monthlyMap, previousFyStart);
  }

  if (isFlatPriorFyMonths(monthlyMap, previousFyStart)) {
    return clearPriorFyMonths(monthlyMap, previousFyStart);
  }

  return monthlyMap;
}

export type PreviousFyBarRow = {
  previousFy: number;
  previousFyChannel?: { amazon: number; flipkart: number };
};

/**
 * Month map for FY charts: only real Event SO month columns (varied MoM). Never invent a flat
 * FY÷12 line when the sheet FY total exists but month columns are missing or synthetic.
 */
export function priorFyChartMonthMap(
  rawMonthlyMap: Map<string, number>,
  strippedMap: Map<string, number>,
  previousFyStart: number,
  priorFySoUnitsFromSheet?: number | null,
): Map<string, number> {
  if (
    priorFyMonthsHaveRealVariation(rawMonthlyMap, previousFyStart) &&
    !isPriorFyMonthlyMapSynthetic(rawMonthlyMap, previousFyStart, priorFySoUnitsFromSheet)
  ) {
    return priorFyMonthSlice(rawMonthlyMap, previousFyStart);
  }
  if (priorFyMonthsHaveRealVariation(strippedMap, previousFyStart)) {
    return priorFyMonthSlice(strippedMap, previousFyStart);
  }
  return priorFyMonthSlice(rawMonthlyMap, previousFyStart);
}

export function prepareSelloutMonthlyMapForFy(
  monthlyMap: Map<string, number>,
  priorFySoUnitsFromSheet: number | null | undefined,
  previousFyStart: number,
): {
  map: Map<string, number>;
  chartMap: Map<string, number>;
  monthSum: number;
  total: number;
} {
  const map = stripFySpreadOverlapFromMonthMap(
    monthlyMap,
    priorFySoUnitsFromSheet,
    previousFyStart,
  );
  const monthSum = priorFyMonthKeysSum(map, previousFyStart);
  const total = resolveAuthoritativePriorFyTotal(monthSum, priorFySoUnitsFromSheet);
  const chartMap = priorFyChartMonthMap(
    monthlyMap,
    map,
    previousFyStart,
    priorFySoUnitsFromSheet,
  );
  return { map, chartMap, monthSum, total };
}

/** Merge prior-FY chart months with the rest of the ingested month map (current FY, etc.). */
export function mergeChartMonthlyMapWithPriorFy(
  fullMonthlyMap: Map<string, number>,
  priorFyChart: Map<string, number>,
): Map<string, number> {
  const out = new Map(fullMonthlyMap);
  for (const [ym, units] of priorFyChart) {
    out.set(ym, units);
  }
  return out;
}

/**
 * When KPI prior-FY total comes from the sheet FY column but chart bars still sum lower
 * (stale DB rows), scale prior-FY bars so the FY comparison chart matches the KPI cards.
 */
export function alignFyLinePreviousFyBarsToTotal<T extends PreviousFyBarRow>(
  fyLine: T[],
  authoritativeTotal: number,
): T[] {
  const chartSum = fyLine.reduce((sum, row) => sum + (row.previousFy ?? 0), 0);
  if (authoritativeTotal <= 0) return fyLine;
  /** Never scale a flat line — that only repeats FY÷12 across months. */
  const values = fyLine.map((row) => row.previousFy ?? 0).filter((v) => v > 0);
  if (values.length >= 2) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max - min <= Math.max(1, min * 0.02)) return fyLine;
  }
  /** No invented flat MoM — only scale when real month columns exist but sum below sheet FY. */
  if (chartSum <= 0) return fyLine;
  if (chartSum >= authoritativeTotal * 0.98) return fyLine;
  const factor = authoritativeTotal / chartSum;
  return fyLine.map((row) => ({
    ...row,
    previousFy: row.previousFy * factor,
    previousFyChannel: row.previousFyChannel
      ? {
          amazon: row.previousFyChannel.amazon * factor,
          flipkart: row.previousFyChannel.flipkart * factor,
        }
      : undefined,
  }));
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
