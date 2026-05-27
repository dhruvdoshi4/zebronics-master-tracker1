import { flipkartAprilUnitsFromMonthMap, flipkartCurrentFyAprilMonthKey } from "./flipkart-sellout-kpi";
import type { ComputedMetric, Marketplace } from "./types";

/**
 * Quick Commerce: completed months use Apr-26 / Mar-26 columns; the report month uses May MTD.
 * Prefer sheet month rows when present; otherwise use MTD / prior-month SO from computed_metrics.
 */
export function resolveQcomMonthUnits(
  monthYm: string,
  fromMonthlyHistory: number,
  snapshotMonthYm: string | null,
  previousSnapshotMonthYm: string | null,
  latestMetric: ComputedMetric | null,
): number {
  if (fromMonthlyHistory > 0) return fromMonthlyHistory;

  if (snapshotMonthYm && monthYm === snapshotMonthYm && latestMetric) {
    return Number(latestMetric.may_mtd_units ?? 0);
  }

  if (previousSnapshotMonthYm && monthYm === previousSnapshotMonthYm && latestMetric) {
    return Number(latestMetric.apr_so_units ?? 0);
  }

  return fromMonthlyHistory;
}

/**
 * Amazon / Flipkart: KPI cells (May MTD / Apr SO) match the master; FK **Apr-25** may sit on
 * a different YYYY-MM bucket than calendar prior month — see {@link resolveFlipkartFySlotUnits}.
 */
export function resolveSelloutMonthUnits(
  monthYm: string,
  fromMonthlyHistory: number,
  snapshotMonthYm: string | null,
  previousSnapshotMonthYm: string | null,
  latestMetric: ComputedMetric | null,
  options?: {
    marketplace?: Marketplace;
    monthlyMap?: Map<string, number>;
    snapshotDate?: string | null;
  },
): number {
  if (!latestMetric) return fromMonthlyHistory;

  const marketplace = options?.marketplace;
  const monthlyMap = options?.monthlyMap;
  const snapshotDate = options?.snapshotDate;

  if (snapshotMonthYm && monthYm === snapshotMonthYm) {
    const mtd = Number(latestMetric.may_mtd_units ?? 0);
    const mtdFromMonth =
      marketplace === "flipkart" && monthlyMap && snapshotDate
        ? Math.max(mtd, monthlyMap.get(snapshotMonthYm) ?? 0)
        : mtd;
    if (marketplace === "flipkart") {
      return mtdFromMonth > 0 ? mtdFromMonth : fromMonthlyHistory;
    }
    return mtd > 0 ? mtd : fromMonthlyHistory;
  }

  if (previousSnapshotMonthYm && monthYm === previousSnapshotMonthYm) {
    const apr = Number(latestMetric.apr_so_units ?? 0);
    let aprResolved = apr;
    if (marketplace === "flipkart" && monthlyMap && snapshotDate) {
      aprResolved = Math.max(apr, flipkartAprilUnitsFromMonthMap(monthlyMap, snapshotDate));
    }
    if (marketplace === "flipkart") {
      return aprResolved > 0 ? aprResolved : fromMonthlyHistory;
    }
    return apr > 0 ? apr : fromMonthlyHistory;
  }

  return fromMonthlyHistory;
}

/** FK IT current-FY chart: slot 0 = Apr-25 SO, last slot = report-month MTD (not always calendar YYYY-MM). */
export function resolveFlipkartFySlotUnits(
  fyMonthIndex: number,
  currentFyMonthIndex: number,
  fromMonthlyHistory: number,
  latestMetric: ComputedMetric | null,
  monthlyMap: Map<string, number>,
  snapshotDate: string,
): number {
  if (!latestMetric) return fromMonthlyHistory;

  if (fyMonthIndex === 0 && currentFyMonthIndex >= 1) {
    const currentFyAprilYm = flipkartCurrentFyAprilMonthKey(snapshotDate);
    const apr = Math.max(
      Number(latestMetric.apr_so_units ?? 0),
      monthlyMap.get(currentFyAprilYm) ?? 0,
      flipkartAprilUnitsFromMonthMap(monthlyMap, snapshotDate),
      fromMonthlyHistory,
    );
    return apr;
  }

  if (fyMonthIndex + 1 === currentFyMonthIndex) {
    const mtd = Math.max(
      Number(latestMetric.may_mtd_units ?? 0),
      fromMonthlyHistory,
    );
    return mtd;
  }

  return fromMonthlyHistory;
}
