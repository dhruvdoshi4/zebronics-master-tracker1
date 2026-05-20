import type { ComputedMetric } from "./types";

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
 * Amazon / Flipkart: prefer ingested sheet month columns; use snapshot KPI cells when history is empty.
 */
export function resolveSelloutMonthUnits(
  monthYm: string,
  fromMonthlyHistory: number,
  snapshotMonthYm: string | null,
  previousSnapshotMonthYm: string | null,
  latestMetric: ComputedMetric | null,
): number {
  if (!latestMetric) return fromMonthlyHistory;

  if (snapshotMonthYm && monthYm === snapshotMonthYm) {
    const mtd = Number(latestMetric.may_mtd_units ?? 0);
    return mtd > 0 ? mtd : fromMonthlyHistory;
  }

  if (previousSnapshotMonthYm && monthYm === previousSnapshotMonthYm) {
    const apr = Number(latestMetric.apr_so_units ?? 0);
    return apr > 0 ? apr : fromMonthlyHistory;
  }

  return fromMonthlyHistory;
}
