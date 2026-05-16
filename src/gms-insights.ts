import {
  computeCategorySelloutInsights,
  type CategorySheetMonthlySellout,
} from "./category-sellout-insights";

/** Category roll-up values in INR (GMS), same structure as sellout month maps. */
export type CategoryGmsMonthlySellout = CategorySheetMonthlySellout;

export function computeCategoryGmsInsights(sheetMonths: CategoryGmsMonthlySellout) {
  return computeCategorySelloutInsights(sheetMonths);
}

const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

function getCurrentFyStart(date: Date): number {
  const year = date.getFullYear();
  return date.getMonth() >= 3 ? year : year - 1;
}

function monthSequence(startYear: number, startMonth: number, count: number): Date[] {
  return Array.from({ length: count }, (_, idx) => {
    const date = new Date(startYear, startMonth + idx, 1);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export type ProductGmsInsights = ReturnType<typeof computeProductGmsInsights>;

/** FY + MoM chart series for a single SKU (values in INR). */
export function computeProductGmsInsights(
  months: Array<{ month_ym: string; gms_inr: number }>,
  mtdGms: number,
) {
  const monthlyMap = new Map<string, number>();
  for (const row of months) {
    monthlyMap.set(row.month_ym, Number(row.gms_inr ?? 0));
  }

  const sales = [...monthlyMap.entries()]
    .map(([key, gms]) => {
      const [year, month] = key.split("-").map(Number);
      const date = new Date(year, month - 1, 1);
      return {
        date,
        gms,
        label: date.toLocaleString("en-US", { month: "short", year: "2-digit" }),
      };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (sales.length === 0 && mtdGms <= 0) return null;

  const now = new Date();
  const nowYm = monthKey(now);
  if (mtdGms > 0) monthlyMap.set(nowYm, mtdGms);

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
  const previousFyTotal = fyPrevMonths.reduce(
    (sum, key) => sum + (monthlyMap.get(key) ?? 0),
    0,
  );

  const currentMap = new Map(currentFySales.map((item) => [monthKey(item.date), item.gms]));
  const previousMap = new Map(previousFySales.map((item) => [monthKey(item.date), item.gms]));

  const fyLine = FY_MONTHS.map((month, index) => {
    const currentYear = index >= 9 ? currentFyStart + 1 : currentFyStart;
    const prevYear = index >= 9 ? previousFyStart + 1 : previousFyStart;
    const currentMonthKey = `${currentYear}-${String(((index + 3) % 12) + 1).padStart(2, "0")}`;
    const previousMonthKey = `${prevYear}-${String(((index + 3) % 12) + 1).padStart(2, "0")}`;

    let currentFyValue = currentMap.get(currentMonthKey) ?? 0;
    if (currentMonthKey === nowYm && mtdGms > 0) currentFyValue = mtdGms;

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

  const buildFyMomSeries = (
    fyStart: number,
    monthCount: number,
    opts: { highlightCurrentMonth: boolean },
  ) => {
    const dates = monthSequence(fyStart, 3, monthCount);
    const rows = dates.map((date) => {
      const keyYm = monthKey(date);
      let gms = monthlyMap.get(keyYm) ?? 0;
      if (opts.highlightCurrentMonth && keyYm === nowYm && mtdGms > 0) gms = mtdGms;
      const isCurrentMonth =
        opts.highlightCurrentMonth &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();
      return {
        date,
        label: date.toLocaleString("en-US", { month: "short", year: "numeric" }),
        shortLabel: date.toLocaleString("en-US", { month: "short" }),
        monthYearLabel: date.toLocaleString("en-US", { month: "short", year: "2-digit" }),
        units: gms,
        isCurrentMonth,
        isMtdOngoing: isCurrentMonth && mtdGms > 0,
        barColor: isCurrentMonth ? "#c7d2fe" : "#a78bfa",
      };
    });

    const maxUnits = Math.max(1, ...rows.map((row) => row.units));
    return rows.map((row, index) => {
      const prev = index > 0 ? rows[index - 1] : null;
      const pctGrowth =
        prev && prev.units > 0 ? ((row.units - prev.units) / prev.units) * 100 : null;
      const trendScore = (row.units / maxUnits) * 100;
      const prevTrendScore = prev ? (prev.units / maxUnits) * 100 : null;
      const trendDelta = prevTrendScore !== null ? trendScore - prevTrendScore : null;
      return { ...row, pctGrowth, trendScore, trendDelta };
    });
  };

  return {
    currentFyStart,
    previousFyStart,
    currentFyTotal,
    previousFyTotal,
    fyLine,
    currentFyMomSeries: buildFyMomSeries(currentFyStart, currentFyMonthIndex, {
      highlightCurrentMonth: true,
    }),
    previousFyMomSeries: buildFyMomSeries(previousFyStart, 12, {
      highlightCurrentMonth: false,
    }),
    currentFyMonthIndex,
  };
}
