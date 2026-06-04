import type { ReactNode } from "react";
import {
  MtdSelloutDashboard,
  type MtdMomSeriesRow,
  type MtdSelloutDashboardProps,
} from "./mtd-sellout-dashboard";

export type { MtdMomSeriesRow };

export function computeSelloutMtdDashboardProps(
  series: MtdMomSeriesRow[],
  reportSnapshotDate: string | null,
  options?: {
    lastMonthUnits?: number;
    lastMonthLabel?: string;
    formatThisYearChannelLine?: MtdSelloutDashboardProps["formatThisYearChannelLine"];
    formatPriorYearChannelLine?: MtdSelloutDashboardProps["formatPriorYearChannelLine"];
    channelsActive?: MtdSelloutDashboardProps["channelsActive"];
  },
): MtdSelloutDashboardProps | null {
  if (series.length === 0) return null;

  const yoyComparable = series.filter(
    (row): row is MtdMomSeriesRow & { pctGrowth: number } => row.pctGrowth !== null,
  );
  const positiveYoyMonths = yoyComparable.filter((row) => row.pctGrowth > 0).length;
  const prevRow = series.length >= 2 ? series[series.length - 2] : null;

  return {
    momChartSeries: series,
    reportSnapshotDate,
    lastMonthUnits: options?.lastMonthUnits ?? prevRow?.units ?? 0,
    lastMonthLabel: options?.lastMonthLabel ?? prevRow?.label ?? "Last month",
    positiveYoyMonths,
    totalYoyMonths: yoyComparable.length,
    formatThisYearChannelLine: options?.formatThisYearChannelLine,
    formatPriorYearChannelLine: options?.formatPriorYearChannelLine,
    channelsActive: options?.channelsActive,
  };
}

export type SelloutMtdSectionProps = {
  series: MtdMomSeriesRow[];
  reportSnapshotDate: string | null;
  sectionId?: string;
  className?: string;
  lastMonthUnits?: number;
  lastMonthLabel?: string;
  formatThisYearChannelLine?: MtdSelloutDashboardProps["formatThisYearChannelLine"];
  formatPriorYearChannelLine?: MtdSelloutDashboardProps["formatPriorYearChannelLine"];
  channelsActive?: MtdSelloutDashboardProps["channelsActive"];
  /** Rendered when there is no MTD series (e.g. missing upload). */
  fallback?: ReactNode;
};

/**
 * Standard MTD sellout comparison block — use on every marketplace sellout / growth view
 * (category analysis, product sellout & growth). QCom wraps {@link MtdSelloutDashboard} separately.
 */
export function SelloutMtdSection({
  series,
  reportSnapshotDate,
  sectionId = "mtd-sellout",
  className,
  lastMonthUnits,
  lastMonthLabel,
  formatThisYearChannelLine,
  formatPriorYearChannelLine,
  channelsActive,
  fallback = null,
}: SelloutMtdSectionProps) {
  const props = computeSelloutMtdDashboardProps(series, reportSnapshotDate, {
    lastMonthUnits,
    lastMonthLabel,
    formatThisYearChannelLine,
    formatPriorYearChannelLine,
    channelsActive,
  });
  if (!props) return fallback;

  return (
    <section id={sectionId} className={className ?? "scroll-mt-6"}>
      <MtdSelloutDashboard {...props} />
    </section>
  );
}
