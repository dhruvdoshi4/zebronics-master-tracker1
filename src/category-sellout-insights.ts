import {
  priorYearComparableUnits,
  priorYearMonthYm,
  yoyGrowthPct,
} from "./sellout-yoy-compare";
import type { MtdMomSeriesRow } from "./mtd-sellout-dashboard";
import {
  alignFyLinePreviousFyBarsToTotal,
  lookupFlipkartPriorFyMonthUnits,
  lookupSheetMonthUnits,
  priorFyMonthsHaveRealVariation,
  resolveSelloutChartAnchorDate,
  resolveAuthoritativePriorFyTotal,
  scalePriorFyMonthMapToSheetTotal,
  stripFySpreadOverlapFromMonthMap,
} from "./sellout-monthly-map";

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

/** Sheet month column stored as YYYY-MM-DD (always day 01) → YYYY-MM. */
export function sheetMonthSaleDateToKey(saleDate: string): string {
  return saleDate.slice(0, 7);
}

export type CategoryFyChannelUnits = { amazon: number; flipkart: number };

/** May MTD (or current report month MTD) from the master — ongoing month, not a full month column. */
export type CategoryOngoingMonthMtd = {
  monthYm: string;
  amazon: number;
  flipkart: number;
};

/** Previous calendar month SO from the master **Apr SO** (etc.) column when Event SO month headers are missing. */
export type CategoryPreviousMonthSo = {
  monthYm: string;
  amazon: number;
  flipkart: number;
};

export function previousMonthYmFromSnapshot(snapshotDate: string): string {
  const [y, m] = snapshotDate.slice(0, 7).split("-").map(Number);
  const date = new Date(y, m - 2, 1);
  return monthKeyFromDate(date);
}

/** Per-channel monthly units from master sheet columns (Apr-25, May-25, …). */
export type CategorySheetMonthlySellout = {
  skuCountAmazon: number;
  skuCountFlipkart: number;
  skuCount: number;
  channelsActive: { amazon: boolean; flipkart: boolean };
  /** YYYY-MM → units summed from that month's sheet column. */
  monthlyAmazon: Map<string, number>;
  monthlyFlipkart: Map<string, number>;
  monthlyCombined: Map<string, number>;
  /** Latest upload **May MTD** (etc.) cell totals for the report month — used for the in-progress bar. */
  ongoingMonthMtd: CategoryOngoingMonthMtd | null;
  /** Previous month from **Apr SO** cells when **Apr-25**-style Event SO columns were not ingested. */
  previousMonthSo: CategoryPreviousMonthSo | null;
  /** Sum of sheet **FY … SO** column per channel — used to fix legacy double-counted month totals. */
  priorFySoUnits?: number;
  priorFySoUnitsAmazon?: number;
  priorFySoUnitsFlipkart?: number;
  /** Current in-progress FY **FY … SO** column totals per channel. */
  currentFySoUnits?: number;
  currentFySoUnitsAmazon?: number;
  currentFySoUnitsFlipkart?: number;
  /** Latest sellout upload snapshot (sheet “as on”) — aligns FY charts with month columns. */
  reportSnapshotDate?: string | null;
  /** Prior-year MTD through snapshot day, keyed by prior YYYY-MM (e.g. 2025-05). */
  priorYearMtdSliceByYm?: Map<string, number>;
  priorYearMtdAmazonByYm?: Map<string, number>;
  priorYearMtdFlipkartByYm?: Map<string, number>;
};

function sumMaps(maps: Map<string, number>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const map of maps) {
    for (const [ym, units] of map) {
      out.set(ym, (out.get(ym) ?? 0) + units);
    }
  }
  return out;
}

/** Merge per-sub-category roll-ups into one cumulative "All" view. */
export function mergeCategorySheetMonthlySellout(
  parts: CategorySheetMonthlySellout[],
): CategorySheetMonthlySellout {
  if (parts.length === 0) {
    return {
      skuCountAmazon: 0,
      skuCountFlipkart: 0,
      skuCount: 0,
      channelsActive: { amazon: false, flipkart: false },
      monthlyAmazon: new Map(),
      monthlyFlipkart: new Map(),
      monthlyCombined: new Map(),
      ongoingMonthMtd: null,
      previousMonthSo: null,
      priorFySoUnits: 0,
      priorFySoUnitsAmazon: 0,
      priorFySoUnitsFlipkart: 0,
      currentFySoUnits: 0,
      currentFySoUnitsAmazon: 0,
      currentFySoUnitsFlipkart: 0,
      priorYearMtdSliceByYm: new Map(),
      priorYearMtdAmazonByYm: new Map(),
      priorYearMtdFlipkartByYm: new Map(),
    };
  }

  const channelsActive = {
    amazon: parts.some((p) => p.channelsActive.amazon),
    flipkart: parts.some((p) => p.channelsActive.flipkart),
  };

  const monthlyAmazon = sumMaps(parts.map((p) => p.monthlyAmazon));
  const monthlyFlipkart = sumMaps(parts.map((p) => p.monthlyFlipkart));
  const monthlyCombined = sumMaps(parts.map((p) => p.monthlyCombined));

  const ongoingParts = parts
    .map((p) => p.ongoingMonthMtd)
    .filter((v): v is CategoryOngoingMonthMtd => v != null);
  const ongoingMonthMtd =
    ongoingParts.length === 0
      ? null
      : {
          monthYm: ongoingParts[0].monthYm,
          amazon: ongoingParts.reduce((s, p) => s + p.amazon, 0),
          flipkart: ongoingParts.reduce((s, p) => s + p.flipkart, 0),
        };

  const prevParts = parts
    .map((p) => p.previousMonthSo)
    .filter((v): v is CategoryPreviousMonthSo => v != null);
  const previousMonthSo =
    prevParts.length === 0
      ? null
      : {
          monthYm: prevParts[0].monthYm,
          amazon: prevParts.reduce((s, p) => s + p.amazon, 0),
          flipkart: prevParts.reduce((s, p) => s + p.flipkart, 0),
        };

  const reportSnapshotDate =
    parts
      .map((p) => p.reportSnapshotDate)
      .filter((d): d is string => Boolean(d))
      .sort((a, b) => b.localeCompare(a))[0] ?? null;

  return {
    skuCountAmazon: parts.reduce((s, p) => s + p.skuCountAmazon, 0),
    skuCountFlipkart: parts.reduce((s, p) => s + p.skuCountFlipkart, 0),
    skuCount: parts.reduce((s, p) => s + p.skuCount, 0),
    channelsActive,
    monthlyAmazon,
    monthlyFlipkart,
    monthlyCombined,
    ongoingMonthMtd,
    previousMonthSo,
    priorFySoUnits: parts.reduce((s, p) => s + (p.priorFySoUnits ?? 0), 0),
    priorFySoUnitsAmazon: parts.reduce((s, p) => s + (p.priorFySoUnitsAmazon ?? 0), 0),
    priorFySoUnitsFlipkart: parts.reduce((s, p) => s + (p.priorFySoUnitsFlipkart ?? 0), 0),
    currentFySoUnits: parts.reduce((s, p) => s + (p.currentFySoUnits ?? 0), 0),
    currentFySoUnitsAmazon: parts.reduce((s, p) => s + (p.currentFySoUnitsAmazon ?? 0), 0),
    currentFySoUnitsFlipkart: parts.reduce((s, p) => s + (p.currentFySoUnitsFlipkart ?? 0), 0),
    reportSnapshotDate,
    priorYearMtdSliceByYm: sumMaps(parts.map((p) => p.priorYearMtdSliceByYm ?? new Map())),
    priorYearMtdAmazonByYm: sumMaps(parts.map((p) => p.priorYearMtdAmazonByYm ?? new Map())),
    priorYearMtdFlipkartByYm: sumMaps(parts.map((p) => p.priorYearMtdFlipkartByYm ?? new Map())),
  };
}

export type MomSeriesRow = {
  date: Date;
  label: string;
  shortLabel: string;
  monthYearLabel: string;
  units: number;
  channelUnits?: CategoryFyChannelUnits;
  isCurrentMonth: boolean;
  /** True when units come from the sheet MTD column (report month still in progress). */
  isMtdOngoing: boolean;
  barColor: string;
  pctGrowth: number | null;
  priorYearUnits: number;
  priorYearChannelUnits?: CategoryFyChannelUnits;
  trendScore: number;
  trendDelta: number | null;
};

export type CategorySelloutInsights = {
  currentFyStart: number;
  previousFyStart: number;
  currentFyTotal: number;
  previousFyTotal: number;
  currentFyTotalChannel: CategoryFyChannelUnits | null;
  previousFyTotalChannel: CategoryFyChannelUnits | null;
  fyAttainmentVsPriorFullFyPct: number | null;
  fyLine: Array<{
    month: string;
    currentFy: number | null;
    previousFy: number;
    previousFyChannel?: CategoryFyChannelUnits;
    currentFyChannel?: CategoryFyChannelUnits;
  }>;
  trendData: Array<{
    month: string;
    currentFy: number | null;
    previousFy: number;
    currentFyDisplay: number | null;
    isMtdPoint: boolean;
    yoyGrowthPct: number | null;
    previousFyChannel?: CategoryFyChannelUnits;
    currentFyChannel?: CategoryFyChannelUnits;
  }>;
  currentFyMomSeries: MomSeriesRow[];
  previousFyMomSeries: MomSeriesRow[];
  currentFyMonthIndex: number;
  currentMonthLabel: string;
  reportSnapshotDate: string | null;
};

/** Map category MoM rows to the shared product MTD dashboard contract. */
export function mapCategoryMomSeriesToMtdDashboardRows(
  rows: MomSeriesRow[],
): MtdMomSeriesRow[] {
  return rows.map((row) => ({
    label: row.label,
    monthYearLabel: row.monthYearLabel,
    units: row.units,
    priorYearUnits: row.priorYearUnits,
    isMtdOngoing: row.isMtdOngoing,
    pctGrowth: row.pctGrowth,
    trendScore: row.trendScore,
    trendDelta: row.trendDelta,
    barColor: row.barColor,
  }));
}

export function categoryMomChannelLine(
  row: MtdMomSeriesRow,
  source: MomSeriesRow[],
  which: "this" | "prior",
): string | null {
  const src = source.find(
    (s) => s.monthYearLabel === row.monthYearLabel && s.label === row.label,
  );
  if (!src) return null;
  const ch = which === "this" ? src.channelUnits : src.priorYearChannelUnits;
  if (!ch || (ch.amazon <= 0 && ch.flipkart <= 0)) return null;
  return `${ch.amazon} Amazon · ${ch.flipkart} Flipkart`;
}

/** MTD comparison block — uses MoM series when present, else sheet MTD + prior-year MTD column. */
export function buildCategoryMtdDashboardSeries(
  sheet: CategorySheetMonthlySellout,
  insights: CategorySelloutInsights,
): MomSeriesRow[] {
  if (insights.currentFyMomSeries.length > 0) {
    return insights.currentFyMomSeries;
  }

  const mtd = sheet.ongoingMonthMtd;
  const snapIso = sheet.reportSnapshotDate;
  if (!mtd || !snapIso) return [];

  const priorYm = priorYearMonthYm(mtd.monthYm);
  const priorUnits = sheet.priorYearMtdSliceByYm?.get(priorYm) ?? 0;
  const currentUnits = mtd.amazon + mtd.flipkart;
  const date = new Date(`${mtd.monthYm}-15T12:00:00`);
  const baseMonthLabel = date.toLocaleString("en-US", { month: "short", year: "2-digit" });
  const hasChannelSplit = sheet.channelsActive.amazon || sheet.channelsActive.flipkart;

  return [
    {
      date,
      label: date.toLocaleString("en-US", { month: "short", year: "numeric" }),
      shortLabel: date.toLocaleString("en-US", { month: "short" }),
      monthYearLabel: `${baseMonthLabel} MTD`,
      units: currentUnits,
      ...(hasChannelSplit
        ? { channelUnits: { amazon: mtd.amazon, flipkart: mtd.flipkart } }
        : {}),
      isCurrentMonth: true,
      isMtdOngoing: true,
      barColor: "#c7d2fe",
      priorYearUnits: priorUnits,
      ...(hasChannelSplit
        ? {
            priorYearChannelUnits: {
              amazon: sheet.priorYearMtdAmazonByYm?.get(priorYm) ?? 0,
              flipkart: sheet.priorYearMtdFlipkartByYm?.get(priorYm) ?? 0,
            },
          }
        : {}),
      pctGrowth: yoyGrowthPct(currentUnits, priorUnits),
      trendScore: 100,
      trendDelta: null,
    },
  ];
}

export function priorFyMonthYms(referenceIsoDate: string): string[] {
  const reportFyStart = getCurrentFyStart(new Date(`${referenceIsoDate}T12:00:00`));
  return monthSequence(reportFyStart - 1, 3, 12).map((d) => monthKeyFromDate(d));
}

/** When Flipkart has FY SO column but no Apr-25…Mar-26 month columns in daily_sales. */
export function applyPriorFySoToMonthlyMaps(
  maps: CategorySheetMonthlySellout,
  reportSnapshotDate: string,
  priorFyGms: { amazon: number; flipkart: number },
): CategorySheetMonthlySellout {
  const fyMonths = priorFyMonthYms(reportSnapshotDate);
  const monthlyAmazon = new Map(maps.monthlyAmazon);
  const monthlyFlipkart = new Map(maps.monthlyFlipkart);
  const monthlyCombined = new Map(maps.monthlyCombined);

  const fillChannel = (totalGms: number, monthly: Map<string, number>) => {
    if (totalGms <= 0) return;
    const existing = fyMonths.reduce((sum, ym) => sum + (monthly.get(ym) ?? 0), 0);
    if (existing <= 0) return;
    if (existing >= totalGms * 0.99) return;
    /** Scale existing month shape to the sheet FY total — never replace with a flat FY÷12 line. */
    const factor = totalGms / existing;
    for (const ym of fyMonths) {
      const prevCombined = monthlyCombined.get(ym) ?? 0;
      const prevChannel = monthly.get(ym) ?? 0;
      const scaled = Math.max(0, prevChannel * factor);
      monthly.set(ym, scaled);
      monthlyCombined.set(ym, prevCombined - prevChannel + scaled);
    }
  };

  if (maps.channelsActive.amazon) fillChannel(priorFyGms.amazon, monthlyAmazon);
  if (maps.channelsActive.flipkart) fillChannel(priorFyGms.flipkart, monthlyFlipkart);

  return { ...maps, monthlyAmazon, monthlyFlipkart, monthlyCombined };
}

export function applyPreviousMonthSoFromMetrics(
  maps: CategorySheetMonthlySellout,
): CategorySheetMonthlySellout {
  const prev = maps.previousMonthSo;
  if (!prev) return maps;

  const monthlyAmazon = new Map(maps.monthlyAmazon);
  const monthlyFlipkart = new Map(maps.monthlyFlipkart);
  const monthlyCombined = new Map(maps.monthlyCombined);

  /** Sheet **Apr SO** column wins over daily_sales month sums (which can over-count on global roll-ups). */
  const amazon = maps.channelsActive.amazon && prev.amazon > 0 ? prev.amazon : 0;
  const flipkart = maps.channelsActive.flipkart && prev.flipkart > 0 ? prev.flipkart : 0;

  if (amazon > 0) monthlyAmazon.set(prev.monthYm, amazon);
  if (flipkart > 0) monthlyFlipkart.set(prev.monthYm, flipkart);
  if (amazon > 0 || flipkart > 0) monthlyCombined.set(prev.monthYm, amazon + flipkart);

  return { ...maps, monthlyAmazon, monthlyFlipkart, monthlyCombined };
}

export function applyOngoingMtdToMaps(maps: CategorySheetMonthlySellout): CategorySheetMonthlySellout {
  const mtd = maps.ongoingMonthMtd;
  if (!mtd) return maps;

  const monthlyAmazon = new Map(maps.monthlyAmazon);
  const monthlyFlipkart = new Map(maps.monthlyFlipkart);
  const monthlyCombined = new Map(maps.monthlyCombined);

  const amazon = maps.channelsActive.amazon ? mtd.amazon : 0;
  const flipkart = maps.channelsActive.flipkart ? mtd.flipkart : 0;
  const total = amazon + flipkart;

  if (maps.channelsActive.amazon) monthlyAmazon.set(mtd.monthYm, amazon);
  if (maps.channelsActive.flipkart) monthlyFlipkart.set(mtd.monthYm, flipkart);
  monthlyCombined.set(mtd.monthYm, total);

  return { ...maps, monthlyAmazon, monthlyFlipkart, monthlyCombined };
}

function unitsForMonth(
  maps: CategorySheetMonthlySellout,
  ym: string,
): { total: number; amazon: number; flipkart: number } {
  const amazon = maps.channelsActive.amazon ? (maps.monthlyAmazon.get(ym) ?? 0) : 0;
  const flipkart = maps.channelsActive.flipkart ? (maps.monthlyFlipkart.get(ym) ?? 0) : 0;
  return { total: amazon + flipkart, amazon, flipkart };
}

/**
 * Category FY trend + MoM from the uploaded master only — each bar is the sum of that month's
 * sheet column (Apr-25, May-25, Mar-26, …) for all SKUs in the sub-category.
 */
function stripLegacyPriorFySpreadFromSheet(
  sheet: CategorySheetMonthlySellout,
): CategorySheetMonthlySellout {
  const snapshotDate = sheet.reportSnapshotDate
    ? new Date(`${sheet.reportSnapshotDate}T12:00:00`)
    : null;
  const anchorDate = resolveSelloutChartAnchorDate(snapshotDate, sheet.monthlyCombined);
  const previousFyStart = getCurrentFyStart(anchorDate) - 1;
  const monthlyCombined = stripFySpreadOverlapFromMonthMap(
    sheet.monthlyCombined,
    sheet.priorFySoUnits,
    previousFyStart,
  );
  const monthlyAmazon = stripFySpreadOverlapFromMonthMap(
    sheet.monthlyAmazon,
    sheet.priorFySoUnitsAmazon ?? sheet.priorFySoUnits,
    previousFyStart,
  );
  const monthlyFlipkart = stripFySpreadOverlapFromMonthMap(
    sheet.monthlyFlipkart,
    sheet.priorFySoUnitsFlipkart ?? sheet.priorFySoUnits,
    previousFyStart,
  );
  return { ...sheet, monthlyCombined, monthlyAmazon, monthlyFlipkart };
}

export function computeCategorySelloutInsights(
  sheetMonths: CategorySheetMonthlySellout,
): CategorySelloutInsights | null {
  const rawAmazon = new Map(sheetMonths.monthlyAmazon);
  const rawFlipkart = new Map(sheetMonths.monthlyFlipkart);
  const rawCombined = new Map(sheetMonths.monthlyCombined);

  const maps = applyOngoingMtdToMaps(
    applyPreviousMonthSoFromMetrics(stripLegacyPriorFySpreadFromSheet(sheetMonths)),
  );
  const { monthlyCombined, channelsActive, ongoingMonthMtd } = maps;
  if (monthlyCombined.size === 0 && !ongoingMonthMtd) return null;

  const snapshotDate = sheetMonths.reportSnapshotDate
    ? new Date(`${sheetMonths.reportSnapshotDate}T12:00:00`)
    : null;
  const anchorDate = resolveSelloutChartAnchorDate(snapshotDate, monthlyCombined);
  const currentFyStart = getCurrentFyStart(anchorDate);
  const previousFyStart = currentFyStart - 1;
  const currentFyMonthIndex = ((anchorDate.getMonth() - 3 + 12) % 12) + 1;

  const hasChannelSplit = channelsActive.amazon || channelsActive.flipkart;

  const priorFyFlipkartLookup = new Map(rawFlipkart);
  if (channelsActive.flipkart) {
    const priorFyFlipkartTotal =
      sheetMonths.priorFySoUnitsFlipkart ?? sheetMonths.priorFySoUnits ?? 0;
    if (priorFyFlipkartTotal > 0) {
      scalePriorFyMonthMapToSheetTotal(
        priorFyFlipkartLookup,
        priorFyFlipkartTotal,
        previousFyStart,
      );
    }
  }

  const priorFyUnitsForMonth = (ym: string) => ({
    total: lookupSheetMonthUnits(rawCombined, ym),
    amazon: channelsActive.amazon ? lookupSheetMonthUnits(rawAmazon, ym) : 0,
    flipkart: channelsActive.flipkart
      ? lookupFlipkartPriorFyMonthUnits(priorFyFlipkartLookup, ym, previousFyStart)
      : 0,
  });

  const fyLine = FY_MONTHS.map((month, index) => {
    const currentYear = index >= 9 ? currentFyStart + 1 : currentFyStart;
    const prevYear = index >= 9 ? previousFyStart + 1 : previousFyStart;
    const currentMonthKey = `${currentYear}-${String(((index + 3) % 12) + 1).padStart(2, "0")}`;
    const previousMonthKey = `${prevYear}-${String(((index + 3) % 12) + 1).padStart(2, "0")}`;

    const cur = unitsForMonth(maps, currentMonthKey);
    const prev = priorFyUnitsForMonth(previousMonthKey);

    return {
      month,
      currentFy: index + 1 <= currentFyMonthIndex ? cur.total : null,
      previousFy: prev.total,
      ...(hasChannelSplit
        ? {
            previousFyChannel: { amazon: prev.amazon, flipkart: prev.flipkart },
            ...(index + 1 <= currentFyMonthIndex
              ? { currentFyChannel: { amazon: cur.amazon, flipkart: cur.flipkart } }
              : {}),
          }
        : {}),
    };
  });

  const fyPrevMonths = monthSequence(previousFyStart, 3, 12).map((d) => monthKeyFromDate(d));
  const previousFyMonthSum = fyPrevMonths.reduce(
    (sum, key) => sum + lookupSheetMonthUnits(rawCombined, key),
    0,
  );
  const amazonMonthSum = fyPrevMonths.reduce(
    (sum, key) => sum + (maps.channelsActive.amazon ? (maps.monthlyAmazon.get(key) ?? 0) : 0),
    0,
  );
  const flipkartMonthSum = fyPrevMonths.reduce(
    (sum, key) => sum + (maps.channelsActive.flipkart ? (maps.monthlyFlipkart.get(key) ?? 0) : 0),
    0,
  );
  const previousFyTotalChannel: CategoryFyChannelUnits | null = hasChannelSplit
    ? {
        amazon:
          (sheetMonths.priorFySoUnitsAmazon ?? 0) > 0
            ? sheetMonths.priorFySoUnitsAmazon!
            : resolveAuthoritativePriorFyTotal(
                amazonMonthSum,
                sheetMonths.priorFySoUnitsAmazon ?? sheetMonths.priorFySoUnits,
              ),
        flipkart:
          (sheetMonths.priorFySoUnitsFlipkart ?? 0) > 0
            ? sheetMonths.priorFySoUnitsFlipkart!
            : resolveAuthoritativePriorFyTotal(
                flipkartMonthSum,
                sheetMonths.priorFySoUnitsFlipkart ?? sheetMonths.priorFySoUnits,
              ),
      }
    : null;
  const previousFyTotal =
    (sheetMonths.priorFySoUnits ?? 0) > 0
      ? (sheetMonths.priorFySoUnits ?? 0)
      : resolveAuthoritativePriorFyTotal(
          previousFyMonthSum,
          sheetMonths.priorFySoUnits,
        );
  const fyLineAligned = priorFyMonthsHaveRealVariation(rawCombined, previousFyStart)
    ? alignFyLinePreviousFyBarsToTotal(fyLine, previousFyTotal)
    : fyLine;

  let currentFyTotal = fyLineAligned.reduce((sum, row, index) => {
    if (index + 1 > currentFyMonthIndex) return sum;
    return sum + Number(row.currentFy ?? 0);
  }, 0);

  let currentFyTotalChannel: CategoryFyChannelUnits | null = hasChannelSplit
    ? fyLineAligned.reduce((acc, row, index) => {
        if (index + 1 > currentFyMonthIndex) return acc;
        if (!row.currentFyChannel) return acc;
        return {
          amazon: acc.amazon + row.currentFyChannel.amazon,
          flipkart: acc.flipkart + row.currentFyChannel.flipkart,
        };
      }, { amazon: 0, flipkart: 0 })
    : null;

  /** Current FY YTD from sheet **FY … SO** column when ingested; else Apr SO + May MTD. */
  if (
    hasChannelSplit &&
    (sheetMonths.currentFySoUnits ?? 0) > 0 &&
    sheetMonths.currentFySoUnitsAmazon != null &&
    sheetMonths.currentFySoUnitsFlipkart != null
  ) {
    currentFyTotalChannel = {
      amazon: sheetMonths.currentFySoUnitsAmazon,
      flipkart: sheetMonths.currentFySoUnitsFlipkart,
    };
    currentFyTotal = sheetMonths.currentFySoUnits ?? 0;
  } else if (
    hasChannelSplit &&
    sheetMonths.ongoingMonthMtd &&
    currentFyMonthIndex <= 2 &&
    (currentFyMonthIndex === 1 ||
      (currentFyMonthIndex === 2 && sheetMonths.previousMonthSo))
  ) {
    const mtd = sheetMonths.ongoingMonthMtd;
    const prev = sheetMonths.previousMonthSo;
    currentFyTotalChannel = {
      amazon:
        (channelsActive.amazon ? mtd.amazon : 0) +
        (currentFyMonthIndex === 2 && prev && channelsActive.amazon ? prev.amazon : 0),
      flipkart:
        (channelsActive.flipkart ? mtd.flipkart : 0) +
        (currentFyMonthIndex === 2 && prev && channelsActive.flipkart ? prev.flipkart : 0),
    };
    currentFyTotal = currentFyTotalChannel.amazon + currentFyTotalChannel.flipkart;
  } else if (currentFyTotalChannel) {
    currentFyTotal = currentFyTotalChannel.amazon + currentFyTotalChannel.flipkart;
  }

  const fyAttainmentVsPriorFullFyPct =
    previousFyTotal > 0 ? (currentFyTotal / previousFyTotal) * 100 : null;

  const trendData = fyLineAligned.map((row, index) => {
    const currentFy = row.currentFy;
    const previousFy = row.previousFy;
    const yoyGrowthPct =
      currentFy !== null && previousFy > 0 ? ((currentFy - previousFy) / previousFy) * 100 : null;
    return {
      ...row,
      isMtdPoint: index + 1 === currentFyMonthIndex,
      /** Keep null for future FY months so the chart does not drop to zero. */
      currentFyDisplay: currentFy,
      yoyGrowthPct,
    };
  });

  const reportSnapshotDate = sheetMonths.reportSnapshotDate ?? null;
  const priorYearMtdSliceByYm = sheetMonths.priorYearMtdSliceByYm ?? new Map<string, number>();
  const priorYearMtdAmazonByYm = sheetMonths.priorYearMtdAmazonByYm ?? new Map<string, number>();
  const priorYearMtdFlipkartByYm = sheetMonths.priorYearMtdFlipkartByYm ?? new Map<string, number>();

  const getPriorYearChannelUnits = (
    monthYm: string,
    isMtdOngoing: boolean,
  ): CategoryFyChannelUnits => {
    const priorYm = priorYearMonthYm(monthYm);
    if (isMtdOngoing) {
      return {
        amazon: channelsActive.amazon ? (priorYearMtdAmazonByYm.get(priorYm) ?? 0) : 0,
        flipkart: channelsActive.flipkart ? (priorYearMtdFlipkartByYm.get(priorYm) ?? 0) : 0,
      };
    }
    return {
      amazon: channelsActive.amazon ? (maps.monthlyAmazon.get(priorYm) ?? 0) : 0,
      flipkart: channelsActive.flipkart ? (maps.monthlyFlipkart.get(priorYm) ?? 0) : 0,
    };
  };

  const buildFyMomSeries = (
    fyStart: number,
    monthCount: number,
    opts: { highlightCurrentMonth: boolean; compare: "yoy" | "sequential" },
  ): MomSeriesRow[] => {
    const dates = monthSequence(fyStart, 3, monthCount);
    const rows = dates.map((date) => {
      const keyYm = monthKeyFromDate(date);
      const u = unitsForMonth(maps, keyYm);
      const isCurrentMonth =
        opts.highlightCurrentMonth &&
        date.getMonth() === anchorDate.getMonth() &&
        date.getFullYear() === anchorDate.getFullYear();
      /** In-progress calendar month always uses sheet MTD, not a full month column. */
      const isMtdOngoing = opts.highlightCurrentMonth && isCurrentMonth;
      const baseMonthLabel = date.toLocaleString("en-US", { month: "short", year: "2-digit" });
      return {
        date,
        label: date.toLocaleString("en-US", { month: "short", year: "numeric" }),
        shortLabel: date.toLocaleString("en-US", { month: "short" }),
        monthYearLabel: isMtdOngoing ? `${baseMonthLabel} MTD` : baseMonthLabel,
        units: u.total,
        channelUnits: hasChannelSplit ? { amazon: u.amazon, flipkart: u.flipkart } : undefined,
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
      let priorYearChannelUnits: CategoryFyChannelUnits | undefined;

      if (opts.compare === "yoy") {
        priorYearUnits = priorYearComparableUnits({
          monthYm: keyYm,
          isMtdOngoing: row.isMtdOngoing,
          monthlyMap: monthlyCombined,
          dailyRows: [],
          snapshotDate: reportSnapshotDate,
          priorYearMtdSlice: priorYearMtdSliceByYm,
        });
        pctGrowth = yoyGrowthPct(row.units, priorYearUnits);
        if (hasChannelSplit) {
          priorYearChannelUnits = getPriorYearChannelUnits(keyYm, row.isMtdOngoing);
        }
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
      return {
        ...row,
        priorYearUnits,
        priorYearChannelUnits,
        pctGrowth,
        trendScore,
        trendDelta,
      };
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
    reportSnapshotDate,
    currentFyStart,
    previousFyStart,
    currentFyTotal,
    previousFyTotal,
    currentFyTotalChannel,
    previousFyTotalChannel,
    fyAttainmentVsPriorFullFyPct,
    fyLine: fyLineAligned,
    trendData,
    currentFyMomSeries,
    previousFyMomSeries,
    currentFyMonthIndex,
    currentMonthLabel,
  };
}
