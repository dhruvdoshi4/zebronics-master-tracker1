import {
  priorYearComparableUnits,
  yoyGrowthPct,
} from "./sellout-yoy-compare";
import type { QcomMarketplace } from "./types";
import { QCOM_MARKETPLACES } from "./types";

const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

export function getCurrentFyStart(date: Date): number {
  const year = date.getFullYear();
  return date.getMonth() >= 3 ? year : year - 1;
}

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthSequence(startYear: number, startMonth: number, count: number): Date[] {
  return Array.from({ length: count }, (_, idx) => {
    const date = new Date(startYear, startMonth + idx, 1);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
}

export type QcomChannelUnits = Record<QcomMarketplace, number>;

export function emptyQcomChannelUnits(): QcomChannelUnits {
  return { zepto: 0, blinkit: 0, bigbasket: 0, instamart: 0 };
}

export function sumQcomChannelUnits(parts: QcomChannelUnits[]): QcomChannelUnits {
  const out = emptyQcomChannelUnits();
  for (const p of parts) {
    for (const ch of QCOM_MARKETPLACES) {
      out[ch] += p[ch] ?? 0;
    }
  }
  return out;
}

export type QcomCategoryOngoingMonthMtd = {
  monthYm: string;
  channels: QcomChannelUnits;
};

export type QcomCategoryPreviousMonthSo = {
  monthYm: string;
  channels: QcomChannelUnits;
};

export type QcomCategorySheetMonthlySellout = {
  skuCountByChannel: QcomChannelUnits;
  skuCount: number;
  channelsActive: Record<QcomMarketplace, boolean>;
  monthlyByChannel: Record<QcomMarketplace, Map<string, number>>;
  monthlyCombined: Map<string, number>;
  ongoingMonthMtd: QcomCategoryOngoingMonthMtd | null;
  previousMonthSo: QcomCategoryPreviousMonthSo | null;
  /** Latest sheet as-on date across channels (drives MTD month + FY progress). */
  reportSnapshotDate: string | null;
  /** Prior-year MTD through snapshot day-of-month, keyed by prior YYYY-MM (e.g. 2025-05). */
  priorYearMtdSliceByYm: Map<string, number>;
};

export type QcomMomSeriesRow = {
  date: Date;
  label: string;
  shortLabel: string;
  monthYearLabel: string;
  units: number;
  channelUnits?: QcomChannelUnits;
  isCurrentMonth: boolean;
  isMtdOngoing: boolean;
  barColor: string;
  pctGrowth: number | null;
  priorYearUnits: number;
  trendScore: number;
  trendDelta: number | null;
};

export type QcomCategorySelloutInsights = {
  currentFyStart: number;
  previousFyStart: number;
  currentFyTotal: number;
  previousFyTotal: number;
  currentFyTotalChannel: QcomChannelUnits | null;
  previousFyTotalChannel: QcomChannelUnits | null;
  fyAttainmentVsPriorFullFyPct: number | null;
  fyLine: Array<{
    month: string;
    currentFy: number | null;
    previousFy: number;
    previousFyChannel?: QcomChannelUnits;
    currentFyChannel?: QcomChannelUnits;
  }>;
  trendData: Array<{
    month: string;
    currentFy: number | null;
    previousFy: number;
    currentFyDisplay: number;
    isMtdPoint: boolean;
    yoyGrowthPct: number | null;
    previousFyChannel?: QcomChannelUnits;
    currentFyChannel?: QcomChannelUnits;
  }>;
  currentFyMomSeries: QcomMomSeriesRow[];
  previousFyMomSeries: QcomMomSeriesRow[];
  currentFyMonthIndex: number;
  currentMonthLabel: string;
};

export function previousMonthYmFromSnapshot(snapshotDate: string): string {
  const [y, m] = snapshotDate.slice(0, 7).split("-").map(Number);
  const date = new Date(y, m - 2, 1);
  return monthKeyFromDate(date);
}

function applyOngoingMtdToMaps(maps: QcomCategorySheetMonthlySellout): QcomCategorySheetMonthlySellout {
  const mtd = maps.ongoingMonthMtd;
  if (!mtd) return maps;

  const monthlyByChannel = { ...maps.monthlyByChannel } as Record<QcomMarketplace, Map<string, number>>;
  const monthlyCombined = new Map(maps.monthlyCombined);

  for (const ch of QCOM_MARKETPLACES) {
    if (!maps.channelsActive[ch]) continue;
    const channelMap = new Map(monthlyByChannel[ch]);
    channelMap.set(mtd.monthYm, mtd.channels[ch] ?? 0);
    monthlyByChannel[ch] = channelMap;
  }

  const total = QCOM_MARKETPLACES.reduce(
    (sum, ch) => sum + (maps.channelsActive[ch] ? (mtd.channels[ch] ?? 0) : 0),
    0,
  );
  monthlyCombined.set(mtd.monthYm, total);

  return { ...maps, monthlyByChannel, monthlyCombined };
}

function applyPreviousMonthSoFromMetrics(
  maps: QcomCategorySheetMonthlySellout,
): QcomCategorySheetMonthlySellout {
  const prev = maps.previousMonthSo;
  if (!prev) return maps;

  const monthlyByChannel = { ...maps.monthlyByChannel } as Record<QcomMarketplace, Map<string, number>>;
  const monthlyCombined = new Map(maps.monthlyCombined);

  for (const ch of QCOM_MARKETPLACES) {
    if (!maps.channelsActive[ch]) continue;
    const units = prev.channels[ch] ?? 0;
    if (units <= 0) continue;
    const channelMap = new Map(monthlyByChannel[ch]);
    if ((channelMap.get(prev.monthYm) ?? 0) > 0) continue;
    channelMap.set(prev.monthYm, units);
    monthlyByChannel[ch] = channelMap;
    monthlyCombined.set(prev.monthYm, (monthlyCombined.get(prev.monthYm) ?? 0) + units);
  }

  return { ...maps, monthlyByChannel, monthlyCombined };
}

function unitsForMonth(
  maps: QcomCategorySheetMonthlySellout,
  ym: string,
): { total: number; channels: QcomChannelUnits } {
  const channels = emptyQcomChannelUnits();
  for (const ch of QCOM_MARKETPLACES) {
    if (maps.channelsActive[ch]) {
      channels[ch] = maps.monthlyByChannel[ch].get(ym) ?? 0;
    }
  }
  const total = QCOM_MARKETPLACES.reduce((sum, ch) => sum + channels[ch], 0);
  return { total, channels };
}

export function computeQcomCategorySelloutInsights(
  sheetMonths: QcomCategorySheetMonthlySellout,
): QcomCategorySelloutInsights | null {
  const maps = applyOngoingMtdToMaps(applyPreviousMonthSoFromMetrics({
    ...sheetMonths,
    priorYearMtdSliceByYm:
      sheetMonths.priorYearMtdSliceByYm ?? new Map<string, number>(),
  }));
  const { monthlyCombined, channelsActive, ongoingMonthMtd, reportSnapshotDate } = maps;
  if (monthlyCombined.size === 0 && !ongoingMonthMtd) return null;

  const anchorDate = reportSnapshotDate
    ? new Date(`${reportSnapshotDate}T12:00:00`)
    : new Date();
  const currentFyStart = getCurrentFyStart(anchorDate);
  const previousFyStart = currentFyStart - 1;
  const currentFyMonthIndex = ((anchorDate.getMonth() - 3 + 12) % 12) + 1;

  const hasChannelSplit = QCOM_MARKETPLACES.some((ch) => channelsActive[ch]);

  const fyLine = FY_MONTHS.map((month, index) => {
    const currentYear = index >= 9 ? currentFyStart + 1 : currentFyStart;
    const prevYear = index >= 9 ? previousFyStart + 1 : previousFyStart;
    const currentMonthKey = `${currentYear}-${String(((index + 3) % 12) + 1).padStart(2, "0")}`;
    const previousMonthKey = `${prevYear}-${String(((index + 3) % 12) + 1).padStart(2, "0")}`;

    const cur = unitsForMonth(maps, currentMonthKey);
    const prev = unitsForMonth(maps, previousMonthKey);

    return {
      month,
      currentFy: index + 1 <= currentFyMonthIndex ? cur.total : null,
      previousFy: prev.total,
      ...(hasChannelSplit
        ? {
            previousFyChannel: prev.channels,
            ...(index + 1 <= currentFyMonthIndex ? { currentFyChannel: cur.channels } : {}),
          }
        : {}),
    };
  });

  const fyPrevMonths = monthSequence(previousFyStart, 3, 12).map((d) => monthKeyFromDate(d));
  const previousFyTotal = fyPrevMonths.reduce(
    (sum, key) => sum + unitsForMonth(maps, key).total,
    0,
  );

  const currentFyTotal = fyLine.reduce((sum, row, index) => {
    if (index + 1 > currentFyMonthIndex) return sum;
    return sum + Number(row.currentFy ?? 0);
  }, 0);

  const fyAttainmentVsPriorFullFyPct =
    previousFyTotal > 0 ? (currentFyTotal / previousFyTotal) * 100 : null;

  const previousFyTotalChannel: QcomChannelUnits | null = hasChannelSplit
    ? fyLine.reduce(
        (acc, row) =>
          row.previousFyChannel ? sumQcomChannelUnits([acc, row.previousFyChannel]) : acc,
        emptyQcomChannelUnits(),
      )
    : null;

  const currentFyTotalChannel: QcomChannelUnits | null = hasChannelSplit
    ? fyLine.reduce((acc, row, index) => {
        if (index + 1 > currentFyMonthIndex || !row.currentFyChannel) return acc;
        return sumQcomChannelUnits([acc, row.currentFyChannel]);
      }, emptyQcomChannelUnits())
    : null;

  const trendData = fyLine.map((row, index) => {
    const currentFy = row.currentFy;
    const previousFy = row.previousFy;
    const yoyGrowthPct =
      currentFy !== null && previousFy > 0 ? ((currentFy - previousFy) / previousFy) * 100 : null;
    return {
      ...row,
      isMtdPoint: index + 1 === currentFyMonthIndex,
      currentFyDisplay: currentFy ?? 0,
      yoyGrowthPct,
    };
  });

  const buildFyMomSeries = (
    fyStart: number,
    monthCount: number,
    opts: { highlightCurrentMonth: boolean; compare: "yoy" | "sequential" },
  ): QcomMomSeriesRow[] => {
    const dates = monthSequence(fyStart, 3, monthCount);
    const rows = dates.map((date) => {
      const keyYm = monthKeyFromDate(date);
      const u = unitsForMonth(maps, keyYm);
      const isCurrentMonth =
        opts.highlightCurrentMonth &&
        date.getMonth() === anchorDate.getMonth() &&
        date.getFullYear() === anchorDate.getFullYear();
      const isMtdOngoing = opts.highlightCurrentMonth && isCurrentMonth;
      const baseMonthLabel = date.toLocaleString("en-US", { month: "short", year: "2-digit" });
      return {
        date,
        label: date.toLocaleString("en-US", { month: "short", year: "numeric" }),
        shortLabel: date.toLocaleString("en-US", { month: "short" }),
        monthYearLabel: isMtdOngoing ? `${baseMonthLabel} MTD` : baseMonthLabel,
        units: u.total,
        channelUnits: hasChannelSplit ? u.channels : undefined,
        isCurrentMonth,
        isMtdOngoing,
        barColor: isCurrentMonth ? "#c7d2fe" : "#a78bfa",
      };
    });

    const maxUnits = Math.max(1, ...rows.map((row) => row.units));
    return rows.map((row, index) => {
      const keyYm = monthKeyFromDate(row.date);
      let priorYearUnits = 0;
      let pctGrowth: number | null = null;
      if (opts.compare === "yoy") {
        priorYearUnits = priorYearComparableUnits({
          monthYm: keyYm,
          isMtdOngoing: row.isMtdOngoing,
          monthlyMap: monthlyCombined,
          dailyRows: [],
          snapshotDate: reportSnapshotDate,
          priorYearMtdSlice: maps.priorYearMtdSliceByYm,
        });
        pctGrowth = yoyGrowthPct(row.units, priorYearUnits);
      } else {
        const prev = index > 0 ? rows[index - 1] : null;
        priorYearUnits = prev?.units ?? 0;
        pctGrowth =
          prev && prev.units > 0 ? ((row.units - prev.units) / prev.units) * 100 : null;
      }
      const trendScore = (row.units / maxUnits) * 100;
      const compareUnits =
        opts.compare === "yoy" ? priorYearUnits : index > 0 ? rows[index - 1].units : 0;
      const priorTrendScore = compareUnits > 0 ? (compareUnits / maxUnits) * 100 : null;
      const trendDelta = priorTrendScore !== null ? trendScore - priorTrendScore : null;
      return { ...row, priorYearUnits, pctGrowth, trendScore, trendDelta };
    });
  };

  const currentFyMomSeries = buildFyMomSeries(currentFyStart, currentFyMonthIndex, {
    highlightCurrentMonth: true,
    compare: "yoy",
  });
  const previousFyMomSeries = buildFyMomSeries(previousFyStart, 12, {
    highlightCurrentMonth: false,
    compare: "sequential",
  });

  const currentMonthName = anchorDate.toLocaleString("en-US", { month: "short" });
  const currentMonthLabel = FY_MONTHS[currentFyMonthIndex - 1] ?? currentMonthName;

  return {
    currentFyStart,
    previousFyStart,
    currentFyTotal,
    previousFyTotal,
    currentFyTotalChannel,
    previousFyTotalChannel,
    fyAttainmentVsPriorFullFyPct,
    fyLine,
    trendData,
    currentFyMomSeries,
    previousFyMomSeries,
    currentFyMonthIndex,
    currentMonthLabel,
  };
}
