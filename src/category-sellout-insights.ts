import type { DailySale } from "./types";

const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

export function getCurrentFyStart(date: Date): number {
  const year = date.getFullYear();
  return date.getMonth() >= 3 ? year : year - 1;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseSaleDate(saleDate: string): Date {
  return new Date(`${saleDate}T00:00:00`);
}

function getMonthLabel(date: Date): string {
  return date.toLocaleString("en-US", { month: "short", year: "2-digit" });
}

function monthSequence(startYear: number, startMonth: number, count: number): Date[] {
  return Array.from({ length: count }, (_, idx) => {
    const date = new Date(startYear, startMonth + idx, 1);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
}

function monthlyUnitsMap(rows: DailySale[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const d = parseSaleDate(row.sale_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    map.set(key, (map.get(key) ?? 0) + Number(row.units_sold ?? 0));
  }
  return map;
}

export type MomSeriesRow = {
  date: Date;
  label: string;
  shortLabel: string;
  monthYearLabel: string;
  units: number;
  /** Present when category roll-up includes per-channel daily rows (Amazon vs Flipkart). */
  channelUnits?: { amazon: number; flipkart: number };
  isCurrentMonth: boolean;
  barColor: string;
  pctGrowth: number | null;
  trendScore: number;
  trendDelta: number | null;
};

export type CategorySelloutChannelDaily = {
  amazon: DailySale[];
  flipkart: DailySale[];
};

export type CategorySelloutInsights = {
  currentFyStart: number;
  previousFyStart: number;
  currentFyTotal: number;
  previousFyTotal: number;
  fyAttainmentVsPriorFullFyPct: number | null;
  fyLine: Array<{ month: string; currentFy: number | null; previousFy: number }>;
  trendData: Array<{
    month: string;
    currentFy: number | null;
    previousFy: number;
    currentFyDisplay: number;
    isMtdPoint: boolean;
    yoyGrowthPct: number | null;
  }>;
  currentFyMomSeries: MomSeriesRow[];
  previousFyMomSeries: MomSeriesRow[];
  currentFyMonthIndex: number;
  currentMonthLabel: string;
};

/**
 * FY + MoM insights from daily_sales rows (aggregated per day for a category or single SKU).
 * No computed_metrics snapshot overrides — pure summed history.
 */
export function computeCategorySelloutInsights(
  monthlyRows: DailySale[],
  channelDaily?: CategorySelloutChannelDaily,
): CategorySelloutInsights | null {
  const monthlyMap = new Map<string, number>();
  for (const row of monthlyRows) {
    const d = parseSaleDate(row.sale_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + Number(row.units_sold ?? 0));
  }

  const sales = [...monthlyMap.entries()]
    .map(([key, units]) => {
      const [year, month] = key.split("-").map(Number);
      const date = new Date(year, month - 1, 1);
      return { date, units, label: getMonthLabel(date) };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (sales.length === 0) return null;

  const now = new Date();
  const currentFyStart = getCurrentFyStart(now);
  const previousFyStart = currentFyStart - 1;
  const currentFyMonthIndex = ((now.getMonth() - 3 + 12) % 12) + 1;

  const currentFyEnd = new Date(currentFyStart + 1, 3, 1);
  const previousFyEnd = new Date(previousFyStart + 1, 3, 1);

  const currentFySales = sales.filter(
    (item) => item.date >= new Date(currentFyStart, 3, 1) && item.date < currentFyEnd,
  );
  const previousFySales = sales.filter(
    (item) => item.date >= new Date(previousFyStart, 3, 1) && item.date < previousFyEnd,
  );

  const fyPrevMonths = monthSequence(previousFyStart, 3, 12).map((d) => monthKey(d));
  const previousFyTotal = fyPrevMonths.reduce((sum, key) => sum + (monthlyMap.get(key) ?? 0), 0);

  const currentMap = new Map(currentFySales.map((item) => [monthKey(item.date), item.units]));
  const previousMap = new Map(previousFySales.map((item) => [monthKey(item.date), item.units]));

  const fyLine = FY_MONTHS.map((month, index) => {
    const currentYear = index >= 9 ? currentFyStart + 1 : currentFyStart;
    const prevYear = index >= 9 ? previousFyStart + 1 : previousFyStart;
    const currentMonthKey = `${currentYear}-${String(((index + 3) % 12) + 1).padStart(2, "0")}`;
    const previousMonthKey = `${prevYear}-${String(((index + 3) % 12) + 1).padStart(2, "0")}`;

    const currentFyValue = currentMap.get(currentMonthKey) ?? 0;

    return {
      month,
      currentFy: index + 1 <= currentFyMonthIndex ? currentFyValue : null,
      previousFy: previousMap.get(previousMonthKey) ?? 0,
    };
  });

  const currentFyTotal = fyLine.reduce((sum, row, index) => {
    if (index + 1 > currentFyMonthIndex) return sum;
    return sum + Number(row.currentFy ?? 0);
  }, 0);

  const fyAttainmentVsPriorFullFyPct =
    previousFyTotal > 0 ? (currentFyTotal / previousFyTotal) * 100 : null;

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

  const channelMonthly =
    channelDaily != null
      ? {
          amazon: monthlyUnitsMap(channelDaily.amazon),
          flipkart: monthlyUnitsMap(channelDaily.flipkart),
        }
      : undefined;

  const buildFyMomSeries = (
    fyStart: number,
    monthCount: number,
    opts: { highlightCurrentMonth: boolean },
  ): MomSeriesRow[] => {
    const dates = monthSequence(fyStart, 3, monthCount);
    const rows = dates.map((date) => {
      const keyYm = monthKey(date);
      const units = monthlyMap.get(keyYm) ?? 0;
      const isCurrentMonth =
        opts.highlightCurrentMonth &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();
      const channelUnits =
        channelMonthly != null
          ? {
              amazon: channelMonthly.amazon.get(keyYm) ?? 0,
              flipkart: channelMonthly.flipkart.get(keyYm) ?? 0,
            }
          : undefined;
      return {
        date,
        label: date.toLocaleString("en-US", { month: "short", year: "numeric" }),
        shortLabel: date.toLocaleString("en-US", { month: "short" }),
        monthYearLabel: date.toLocaleString("en-US", { month: "short", year: "2-digit" }),
        units,
        ...(channelUnits !== undefined ? { channelUnits } : {}),
        isCurrentMonth,
        barColor: isCurrentMonth ? "#c7d2fe" : "#a78bfa",
      };
    });

    const maxUnits = Math.max(1, ...rows.map((row) => row.units));
    return rows.map((row, index) => {
      const prev = index > 0 ? rows[index - 1] : null;
      const pctGrowth = prev && prev.units > 0 ? ((row.units - prev.units) / prev.units) * 100 : null;
      const trendScore = (row.units / maxUnits) * 100;
      const prevTrendScore = prev ? (prev.units / maxUnits) * 100 : null;
      const trendDelta = prevTrendScore !== null ? trendScore - prevTrendScore : null;
      return { ...row, pctGrowth, trendScore, trendDelta };
    });
  };

  const currentFyMomSeries = buildFyMomSeries(currentFyStart, currentFyMonthIndex, {
    highlightCurrentMonth: true,
  });
  const previousFyMomSeries = buildFyMomSeries(previousFyStart, 12, {
    highlightCurrentMonth: false,
  });

  const currentMonthName = now.toLocaleString("en-US", { month: "short" });
  const currentMonthLabel = FY_MONTHS[currentFyMonthIndex - 1] ?? currentMonthName;

  return {
    currentFyStart,
    previousFyStart,
    currentFyTotal,
    previousFyTotal,
    fyAttainmentVsPriorFullFyPct,
    fyLine,
    trendData,
    currentFyMomSeries,
    previousFyMomSeries,
    currentFyMonthIndex,
    currentMonthLabel,
  };
}
