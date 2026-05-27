import { getCurrentFyStart } from "./category-sellout-insights";
import type { ComputedMetric } from "./types";
import { lookupFlipkartPriorFyMonthUnits } from "./sellout-monthly-map";

function previousCalendarMonthYm(snapshotDate: string): string {
  const d = new Date(`${snapshotDate}T12:00:00`);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Category roll-ups: month table may anchor Apr-25 on either key. Product charts use {@link flipkartCurrentFyAprilMonthKey}. */
export function flipkartAprilMonthCandidates(fyStart: number): string[] {
  return [`${fyStart}-04`, `${fyStart - 1}-04`];
}

/** Current-FY April only — never max with prior-FY **Apr-25** (different FY, breaks PY chart). */
export function flipkartCurrentFyAprilMonthKey(snapshotDate: string): string {
  const fyStart = getCurrentFyStart(new Date(`${snapshotDate}T12:00:00`));
  return `${fyStart}-04`;
}

export function flipkartAprilUnitsFromMonthMap(
  monthlyMap: Map<string, number>,
  snapshotDate: string,
): number {
  const currentFyApril = monthlyMap.get(flipkartCurrentFyAprilMonthKey(snapshotDate)) ?? 0;
  if (currentFyApril > 0) return currentFyApril;
  const prevYm = previousCalendarMonthYm(snapshotDate);
  return Math.max(monthlyMap.get(prevYm) ?? 0, 0);
}

/** Prefer sheet month columns when KPI cells were parsed from the wrong header (e.g. 26-Apr). */
export function repairFlipkartComputedMetric(
  metric: ComputedMetric,
  monthlyMap: Map<string, number>,
): ComputedMetric {
  const snap = metric.as_of_date?.trim();
  if (!snap) return metric;

  const snapYm = snap.slice(0, 7);
  const aprFromMonths = flipkartAprilUnitsFromMonthMap(monthlyMap, snap);
  const mtdFromMonth = snapYm ? (monthlyMap.get(snapYm) ?? 0) : 0;

  const aprSo = Math.max(Number(metric.apr_so_units ?? 0), aprFromMonths);
  const mayMtd = Math.max(Number(metric.may_mtd_units ?? 0), mtdFromMonth);

  const fyStart = getCurrentFyStart(new Date(`${snap}T12:00:00`));
  const priorFyStart = fyStart - 1;
  const priorFyFromMonths = Array.from({ length: 12 }, (_, i) => {
    const calMonth = (3 + i) % 12;
    const year = i < 9 ? priorFyStart : priorFyStart + 1;
    const ym = `${year}-${String(calMonth + 1).padStart(2, "0")}`;
    return lookupFlipkartPriorFyMonthUnits(monthlyMap, ym, priorFyStart);
  }).reduce((sum, units) => sum + units, 0);
  const priorFySo = Math.max(Number(metric.prior_fy_so_units ?? 0), priorFyFromMonths);

  if (
    aprSo === metric.apr_so_units &&
    mayMtd === metric.may_mtd_units &&
    priorFySo === metric.prior_fy_so_units
  ) {
    return metric;
  }
  return { ...metric, apr_so_units: aprSo, may_mtd_units: mayMtd, prior_fy_so_units: priorFySo };
}

/** Current FY till-date on FK IT (May report) = Apr full month + May MTD. */
export function flipkartCurrentFyTillDateUnits(
  metric: Pick<ComputedMetric, "apr_so_units" | "may_mtd_units"> | null,
  currentFyMonthIndex: number,
): number {
  if (!metric || currentFyMonthIndex < 2) return 0;
  return (
    Math.max(0, Number(metric.apr_so_units ?? 0)) +
    Math.max(0, Number(metric.may_mtd_units ?? 0))
  );
}
