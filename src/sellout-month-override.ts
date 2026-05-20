import type { ComputedMetric } from "./types";

/**
 * Prefer ingested sheet month columns; only replace with snapshot KPI cells when they have data.
 * (QCom apr_so_units was 0 and wiped Apr-26 column totals in charts.)
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
