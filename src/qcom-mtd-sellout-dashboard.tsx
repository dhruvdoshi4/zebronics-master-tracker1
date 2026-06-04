import type { QcomMomSeriesRow } from "./qcom-category-sellout-insights";
import { formatQcomChannelUnitsLine } from "./qcom-channel-format";
import { MtdSelloutDashboard, type MtdMomSeriesRow } from "./mtd-sellout-dashboard";
import type { QcomMarketplace } from "./types";

export type QcomMtdSelloutDashboardProps = {
  momChartSeries: QcomMomSeriesRow[];
  channelsActive: Record<QcomMarketplace, boolean>;
  showChannelBreakdown?: boolean;
  reportSnapshotDate: string | null;
  lastMonthUnits: number;
  lastMonthLabel: string;
  positiveYoyMonths: number;
  totalYoyMonths: number;
};

export function QcomMtdSelloutDashboard({
  momChartSeries,
  channelsActive,
  showChannelBreakdown = false,
  reportSnapshotDate,
  lastMonthUnits,
  lastMonthLabel,
  positiveYoyMonths,
  totalYoyMonths,
}: QcomMtdSelloutDashboardProps) {
  return (
    <MtdSelloutDashboard
      momChartSeries={momChartSeries as MtdMomSeriesRow[]}
      reportSnapshotDate={reportSnapshotDate}
      lastMonthUnits={lastMonthUnits}
      lastMonthLabel={lastMonthLabel}
      positiveYoyMonths={positiveYoyMonths}
      totalYoyMonths={totalYoyMonths}
      formatThisYearChannelLine={(row) => {
        const qcomRow = row as QcomMomSeriesRow;
        if (!showChannelBreakdown || !qcomRow.channelUnits) return null;
        return formatQcomChannelUnitsLine(qcomRow.channelUnits, channelsActive) ?? null;
      }}
      formatPriorYearChannelLine={() => null}
    />
  );
}
