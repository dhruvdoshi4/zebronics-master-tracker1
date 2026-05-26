import { getCurrentFyStart } from "./category-sellout-insights";
import type { ComputedMetric } from "./types";

function previousCalendarMonthYm(snapshotDate: string): string {
  const d = new Date(`${snapshotDate}T12:00:00`);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** April YYYY-MM keys that may hold FK **Apr-25** totals depending on snapshot FY. */
export function flipkartAprilMonthCandidates(fyStart: number): string[] {
  return [`${fyStart}-04`, `${fyStart - 1}-04`];
}

export function flipkartAprilUnitsFromMonthMap(
  monthlyMap: Map<string, number>,
  snapshotDate: string,
): number {
  const snap = new Date(`${snapshotDate}T12:00:00`);
  const fyStart = getCurrentFyStart(snap);
  let best = 0;
  for (const ym of flipkartAprilMonthCandidates(fyStart)) {
    best = Math.max(best, monthlyMap.get(ym) ?? 0);
  }
  const prevYm = previousCalendarMonthYm(snapshotDate);
  best = Math.max(best, monthlyMap.get(prevYm) ?? 0);
  return best;
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

  if (aprSo === metric.apr_so_units && mayMtd === metric.may_mtd_units) {
    return metric;
  }
  return { ...metric, apr_so_units: aprSo, may_mtd_units: mayMtd };
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
