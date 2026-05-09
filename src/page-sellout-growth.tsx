import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Area,
  AreaChart,
  Cell,
  Line,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  CalendarDays,
  CircleHelp,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  getLatestMetricForProduct,
  getPeersForSelloutChannel,
  getProductByCode,
  getProductMonthlySellout,
} from "./data";
import type { ComputedMetric, DailySale, Marketplace, ProductMaster } from "./types";
import { Card, EmptyState, InlineLoader, StatCard } from "./ui";
import { cn, formatDecimal, formatInteger } from "./utils";

const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
const AXIS_TICK = { fill: "#71717a", fontSize: 11 } as const;
const GRID_STROKE = "rgba(113,113,122,0.2)";
const CURRENT_FY_COLOR = "#4f46e5";
const PREVIOUS_FY_COLOR = "#94a3b8";

function getCurrentFyStart(date: Date): number {
  const year = date.getFullYear();
  return date.getMonth() >= 3 ? year : year - 1;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** YYYY-MM for calendar bucket (matches computed_metrics snapshot months). */
function yyyymm(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

export function SelloutGrowthPage() {
  const params = useParams<{ marketplace: string; code: string }>();
  const marketplace = (params.marketplace as Marketplace) ?? "amazon";
  const productCode = params.code ?? "";
  const [product, setProduct] = useState<ProductMaster | null>(null);
  const [monthlyRows, setMonthlyRows] = useState<DailySale[]>([]);
  const [latestMetric, setLatestMetric] = useState<ComputedMetric | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [momFyScope, setMomFyScope] = useState<"current" | "previous">("current");
  const [channelPeers, setChannelPeers] = useState<{
    amazon: ProductMaster | null;
    flipkart: ProductMaster | null;
  } | null>(null);
  const [peersLoading, setPeersLoading] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void Promise.all([
      getProductByCode(marketplace, productCode),
      getLatestMetricForProduct(marketplace, productCode),
      getProductMonthlySellout(marketplace, productCode),
    ])
      .then(([productRow, metricRow, monthly]) => {
        setProduct(productRow);
        setLatestMetric(metricRow);
        setMonthlyRows(monthly);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load sellout and growth data."),
      )
      .finally(() => setIsLoading(false));
  }, [marketplace, productCode]);

  useEffect(() => {
    if (!product?.product_name) {
      setChannelPeers(null);
      setPeersLoading(false);
      return;
    }
    setPeersLoading(true);
    void getPeersForSelloutChannel(product.product_name)
      .then(setChannelPeers)
      .catch(() => setChannelPeers({ amazon: null, flipkart: null }))
      .finally(() => setPeersLoading(false));
  }, [product?.product_name]);

  const insights = useMemo(() => {
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

    /** Must match KPI cards (same cells as apr_so_units / may_mtd_units). */
    const snapshotDate =
      latestMetric?.as_of_date != null ? new Date(`${latestMetric.as_of_date}T12:00:00`) : null;
    const snapshotMonthYm = snapshotDate ? yyyymm(snapshotDate) : null;
    const previousSnapshotMonthYm = snapshotDate
      ? yyyymm(new Date(snapshotDate.getFullYear(), snapshotDate.getMonth() - 1, 1))
      : null;

    const hasMonthlyHistory = monthlyRows.length > 0;
    const hasSnapshotMetric = snapshotDate !== null && latestMetric !== null;
    if (!hasMonthlyHistory && !hasSnapshotMetric) return null;

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
    const previousFyTotal = fyPrevMonths.reduce(
      (sum, key) => sum + (monthlyMap.get(key) ?? 0),
      0,
    );

    const currentMap = new Map(currentFySales.map((item) => [monthKey(item.date), item.units]));
    const previousMap = new Map(previousFySales.map((item) => [monthKey(item.date), item.units]));

    const fyLine = FY_MONTHS.map((month, index) => {
      const currentYear = index >= 9 ? currentFyStart + 1 : currentFyStart;
      const prevYear = index >= 9 ? previousFyStart + 1 : previousFyStart;
      const currentMonthKey = `${currentYear}-${String(((index + 3) % 12) + 1).padStart(2, "0")}`;
      const previousMonthKey = `${prevYear}-${String(((index + 3) % 12) + 1).padStart(2, "0")}`;

      let currentFyValue = currentMap.get(currentMonthKey) ?? 0;
      if (snapshotMonthYm && currentMonthKey === snapshotMonthYm && latestMetric) {
        currentFyValue = Number(latestMetric.may_mtd_units ?? 0);
      } else if (previousSnapshotMonthYm && currentMonthKey === previousSnapshotMonthYm && latestMetric) {
        currentFyValue = Number(latestMetric.apr_so_units ?? 0);
      }

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
        let units = monthlyMap.get(keyYm) ?? 0;
        if (snapshotMonthYm && keyYm === snapshotMonthYm && latestMetric) {
          units = Number(latestMetric.may_mtd_units ?? 0);
        } else if (
          previousSnapshotMonthYm &&
          keyYm === previousSnapshotMonthYm &&
          latestMetric
        ) {
          units = Number(latestMetric.apr_so_units ?? 0);
        }
        const isCurrentMonth =
          opts.highlightCurrentMonth &&
          date.getMonth() === now.getMonth() &&
          date.getFullYear() === now.getFullYear();
        return {
          date,
          label: date.toLocaleString("en-US", { month: "short", year: "numeric" }),
          shortLabel: date.toLocaleString("en-US", { month: "short" }),
          monthYearLabel: date.toLocaleString("en-US", { month: "short", year: "2-digit" }),
          units,
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

    return {
      currentFyStart,
      previousFyStart,
      currentFyTotal,
      previousFyTotal,
      fyLine,
      currentFyMomSeries,
      previousFyMomSeries,
      currentFyMonthIndex,
      sales,
    };
  }, [monthlyRows, latestMetric]);

  if (isLoading) return <InlineLoader text="Loading Sellout & Growth..." />;
  if (error) return <EmptyState title="Unable to load data" description={error} />;
  if (!product || !insights) {
    return (
      <EmptyState
        title="Model Data Not Found in Ecom Sheet"
        description="No monthly values were found for this model in the Ecom Sellout source."
      />
    );
  }

  const avgMonthlySellout =
    insights.currentFyMonthIndex > 0
      ? insights.currentFyTotal / insights.currentFyMonthIndex
      : 0;
  const currentMonthMtd = latestMetric?.may_mtd_units ?? 0;
  const previousMonthSo = latestMetric?.apr_so_units ?? 0;
  const snapshotAsOf =
    latestMetric?.as_of_date != null ? new Date(`${latestMetric.as_of_date}T12:00:00`) : null;
  const kpiMtdMonthLabel = snapshotAsOf
    ? snapshotAsOf.toLocaleString("en-US", { month: "short" })
    : new Date().toLocaleString("en-US", { month: "short" });
  const kpiPrevMonthLabel = snapshotAsOf
    ? new Date(snapshotAsOf.getFullYear(), snapshotAsOf.getMonth() - 1, 1).toLocaleString("en-US", {
        month: "short",
      })
    : (() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return d.toLocaleString("en-US", { month: "short" });
      })();
  const currentMonthName = new Date().toLocaleString("en-US", { month: "short" });
  const fyAttainmentVsPriorFullFyPct =
    insights.previousFyTotal > 0
      ? (insights.currentFyTotal / insights.previousFyTotal) * 100
      : null;
  const peakCurrentFyTillDate = insights.fyLine
    .slice(0, insights.currentFyMonthIndex)
    .reduce(
      (best, row) => {
        const units = Number(row.currentFy ?? 0);
        return units > best.units ? { month: row.month, units } : best;
      },
      { month: "Apr", units: 0 },
    );
  const currentMonthLabel = FY_MONTHS[insights.currentFyMonthIndex - 1] ?? currentMonthName;
  const currentMonthGrowthVsPrevious =
    (() => {
      const monthRow = insights.fyLine[insights.currentFyMonthIndex - 1];
      if (!monthRow || monthRow.currentFy === null || monthRow.previousFy <= 0) return null;
      return ((monthRow.currentFy - monthRow.previousFy) / monthRow.previousFy) * 100;
    })();
  const selectedMomSeries =
    momFyScope === "current" ? insights.currentFyMomSeries : insights.previousFyMomSeries;
  const selectedFyLabel =
    momFyScope === "current"
      ? `FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)}`
      : `FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)}`;
  const latestMom = selectedMomSeries.length ? selectedMomSeries[selectedMomSeries.length - 1] : null;
  const momRangeStart = selectedMomSeries[0]?.label ?? "N/A";
  const momRangeEnd = selectedMomSeries[selectedMomSeries.length - 1]?.label ?? "N/A";
  const momComparable = selectedMomSeries.filter(
    (row): row is (typeof selectedMomSeries)[number] & { pctGrowth: number } =>
      row.pctGrowth !== null,
  );
  const highestMom = momComparable.length
    ? momComparable.reduce((best, row) => (row.pctGrowth > best.pctGrowth ? row : best), momComparable[0])
    : null;
  const highestMomMonthText = highestMom ? highestMom.label : "N/A";
  const bestSelloutMonthFromMom = selectedMomSeries.reduce(
    (best, row) => (row.units > best.units ? row : best),
    selectedMomSeries[0],
  );
  const positiveMomMonths = momComparable.filter((row) => row.pctGrowth > 0).length;
  const negativeStreak = (() => {
    let streak = 0;
    for (let i = selectedMomSeries.length - 1; i >= 1; i -= 1) {
      const value = selectedMomSeries[i].pctGrowth;
      if (value !== null && value < 0) streak += 1;
      else break;
    }
    return streak;
  })();

  const trendData = insights.fyLine.map((row, index) => {
    const currentFy = row.currentFy;
    const previousFy = row.previousFy;
    const yoyGrowthPct =
      currentFy !== null && previousFy > 0 ? ((currentFy - previousFy) / previousFy) * 100 : null;
    return {
      ...row,
      isMtdPoint: index + 1 === insights.currentFyMonthIndex,
      currentFyDisplay: currentFy ?? 0,
      yoyGrowthPct,
    };
  });

  const customTooltip = ({ active, payload, label }: { active?: boolean; payload?: ReadonlyArray<{ payload?: { currentFy: number | null; previousFy: number; yoyGrowthPct: number | null } }>; label?: string | number; }) => {
    if (!active || !payload || payload.length === 0) return null;
    const data = payload[0]?.payload;
    if (!data) return null;
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{String(label ?? "")}</p>
        <p className="mt-1 text-xs text-zinc-600">
          Previous FY: <span className="font-semibold text-zinc-900">{formatInteger(data.previousFy)} units</span>
        </p>
        <p className="text-xs text-zinc-600">
          Current FY:{" "}
          <span className="font-semibold text-zinc-900">
            {data.currentFy === null ? "N/A" : `${formatInteger(data.currentFy)} units`}
          </span>
        </p>
        {data.yoyGrowthPct !== null ? (
          <p className="mt-1 text-xs text-zinc-600">
            YoY Growth:{" "}
            <span className={data.yoyGrowthPct >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-rose-600"}>
              {data.yoyGrowthPct >= 0 ? "+" : ""}
              {formatDecimal(data.yoyGrowthPct)}%
            </span>
          </p>
        ) : null}
      </div>
    );
  };

  const chartLegendFormatter = (value: string) => (
    <span className="text-xs font-medium text-zinc-600">{value}</span>
  );

  const otherMarketplace: Marketplace = marketplace === "amazon" ? "flipkart" : "amazon";
  const otherListing =
    channelPeers?.[otherMarketplace] ??
    null;
  const directOtherSelloutHref = otherListing
    ? `/app/product/${otherMarketplace}/${encodeURIComponent(otherListing.product_code)}/sellout-growth`
    : null;
  const otherChannelLabel = otherMarketplace === "amazon" ? "Amazon" : "Flipkart";
  const currentChannelLabel = marketplace === "amazon" ? "Amazon" : "Flipkart";

  return (
    <div className="space-y-8 rounded-3xl border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-white p-6 text-zinc-900 shadow-xl">
      <Link
        to={`/app/product/${marketplace}/${encodeURIComponent(productCode)}`}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Model Workspace
      </Link>

      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Sellout Intelligence</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Product: {product.product_name}</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Figures use this listing only (same ASIN/FSN as above), including FY totals and charts—so they match Apr / May MTD from your latest upload.
        </p>

        <div className="mt-4 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200">
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">{currentChannelLabel}</span>
          {" "}sellout & growth for this listing (same ASIN/FSN as above).
          {peersLoading ? (
            <span className="ml-2 text-zinc-500">Checking for a matched {otherChannelLabel} listing…</span>
          ) : directOtherSelloutHref ? (
            <Link
              to={directOtherSelloutHref}
              className="ml-2 font-medium text-violet-600 underline-offset-2 hover:underline dark:text-violet-400"
            >
              Open {otherChannelLabel} sellout instead →
            </Link>
          ) : (
            <span className="ml-2 text-zinc-500 dark:text-zinc-400">
              No linked {otherChannelLabel} row for this model name yet.
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label={`FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)} Total SO`}
          value={formatInteger(insights.previousFyTotal)}
          variant="violet"
        />
        <StatCard
          label={`FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)} Total SO (Till Date)`}
          value={formatInteger(insights.currentFyTotal)}
          variant="violet"
          hint={`Current FY month: ${insights.currentFyMonthIndex} of 12`}
        />
        <StatCard
          label={`Current Month MTD (${kpiMtdMonthLabel})`}
          value={formatInteger(currentMonthMtd)}
          variant="emerald"
        />
        <StatCard
          label={`Previous Month SO (${kpiPrevMonthLabel})`}
          value={formatInteger(previousMonthSo)}
          variant="amber"
        />
        <StatCard
          label="Average Monthly SO (Till Date)"
          value={formatInteger(avgMonthlySellout)}
          variant="sky"
        />
      </div>

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-zinc-900">Financial Year Sellout Trend</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Monthly sellout comparison between Current FY and Previous FY
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700">
              Units
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700">
              <CalendarDays className="h-3.5 w-3.5" />
              FY {insights.currentFyStart}-{String(insights.currentFyStart + 1).slice(-2)}
            </span>
          </div>
        </div>
        <div className="h-[380px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="currentFyArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CURRENT_FY_COLOR} stopOpacity={0.26} />
                  <stop offset="95%" stopColor={CURRENT_FY_COLOR} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip content={customTooltip} />
              <Legend formatter={chartLegendFormatter} />
              <Area
                type="natural"
                dataKey="currentFyDisplay"
                name={`Current FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)}`}
                stroke="none"
                fill="url(#currentFyArea)"
                legendType="none"
              />
              <Line
                type="natural"
                dataKey="previousFy"
                name={`Previous FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)}`}
                stroke={PREVIOUS_FY_COLOR}
                strokeDasharray="5 5"
                strokeWidth={2.2}
                dot={{ r: 3, fill: PREVIOUS_FY_COLOR, stroke: "#ffffff", strokeWidth: 1.2 }}
                activeDot={{ r: 4 }}
              />
              <Line
                type="natural"
                dataKey="currentFy"
                name={`Current FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)}`}
                stroke={CURRENT_FY_COLOR}
                strokeWidth={3.4}
                dot={(props) => {
                  const point = props.payload as { isMtdPoint?: boolean };
                  const isMtdPoint = Boolean(point?.isMtdPoint);
                  return (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={isMtdPoint ? 5 : 4}
                      fill={CURRENT_FY_COLOR}
                      fillOpacity={isMtdPoint ? 0.55 : 1}
                      stroke="#ffffff"
                      strokeWidth={isMtdPoint ? 2.2 : 1.5}
                      strokeDasharray={isMtdPoint ? "2 2" : "0"}
                    />
                  );
                }}
                activeDot={{ r: 6, fill: CURRENT_FY_COLOR, stroke: "#ffffff", strokeWidth: 2 }}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 flex flex-col gap-4">
          <FyAttainmentSummaryCard
            pct={fyAttainmentVsPriorFullFyPct}
            tillLabel={`Till ${currentMonthLabel} ${insights.currentFyStart + (insights.currentFyMonthIndex >= 10 ? 1 : 0)}`}
            previousFyRangeLabel={`FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)}`}
            previousFyTotalUnits={insights.previousFyTotal}
            currentYtdUnits={insights.currentFyTotal}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <MiniInsightCard
              variant="emphasis"
              label="Avg Monthly Sellout"
              value={formatInteger(avgMonthlySellout)}
              sub="Current FY till date"
            />
            <MiniInsightCard
              variant="emphasis"
              label="Peak Month (Current FY till date)"
              value={peakCurrentFyTillDate.month}
              sub={`${formatInteger(peakCurrentFyTillDate.units)} units`}
              icon={<TrendingUp className="h-5 w-5 text-violet-600" />}
            />
          </div>
        </div>
        <p className="mt-4 text-sm font-semibold leading-relaxed text-zinc-700">
          MTD = Current month partial data. {currentMonthLabel} is shown with a lighter marker.
          {currentMonthGrowthVsPrevious !== null
            ? ` YoY in ${currentMonthLabel}: ${currentMonthGrowthVsPrevious >= 0 ? "+" : ""}${formatDecimal(currentMonthGrowthVsPrevious)}%.`
            : ""}
        </p>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1">
              <h3 className="text-base font-semibold text-zinc-900">Month on Month (MoM) Growth</h3>
              <CircleHelp className="h-4 w-4 text-zinc-400" />
            </div>
            <p className="mt-1 text-xs text-zinc-500">Track short term momentum and monthly sellout growth trend</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Tracking window: {momRangeStart} to {momRangeEnd} ({selectedFyLabel})
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-0.5">
              <button
                type="button"
                onClick={() => setMomFyScope("current")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  momFyScope === "current"
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                This FY
              </button>
              <button
                type="button"
                onClick={() => setMomFyScope("previous")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  momFyScope === "previous"
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                Previous FY
              </button>
            </div>
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700">
              {selectedFyLabel}
            </span>
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700">
              Units
            </span>
          </div>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MiniInsightCard
            label={`Latest Month${momFyScope === "current" ? ` (${currentMonthLabel} MTD)` : ""}`}
            value={formatInteger(Number(latestMom?.units ?? (momFyScope === "current" ? currentMonthMtd : 0)))}
            sub={latestMom?.pctGrowth !== null && latestMom?.pctGrowth !== undefined ? `MoM ${formatDecimal(latestMom.pctGrowth)}%` : "No previous month to compare"}
            icon={<TrendingUp className="h-4 w-4 text-violet-500" />}
          />
          <MiniInsightCard
            label="Highest MoM Growth"
            value={highestMom ? `${highestMom.pctGrowth >= 0 ? "+" : ""}${formatDecimal(highestMom.pctGrowth)}%` : "N/A"}
            sub={highestMomMonthText}
            positive={highestMom ? highestMom.pctGrowth >= 0 : undefined}
          />
          <MiniInsightCard
            label="Highest Sellout Month"
            value={formatInteger(bestSelloutMonthFromMom.units)}
            sub={bestSelloutMonthFromMom.label}
            icon={<Sparkles className="h-4 w-4 text-amber-500" />}
          />
          <MiniInsightCard
            label="Avg Monthly Sellout"
            value={formatInteger(
              selectedMomSeries.reduce((sum, row) => sum + row.units, 0) / Math.max(1, selectedMomSeries.length),
            )}
            sub={selectedFyLabel}
          />
          <MiniInsightCard
            label="Positive MoM Months"
            value={`${positiveMomMonths} / ${momComparable.length}`}
            sub="Months"
            icon={<TrendingDown className="h-4 w-4 text-fuchsia-500" />}
          />
        </div>

        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={selectedMomSeries}>
              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="monthYearLabel"
                tick={{ ...AXIS_TICK, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <YAxis yAxisId="left" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                unit="%"
                domain={[0, 100]}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const row = payload[0]?.payload as
                    | {
                        units?: number;
                        pctGrowth?: number | null;
                        trendScore?: number;
                        isCurrentMonth?: boolean;
                      }
                    | undefined;
                  if (!row) return null;
                  return (
                    <div className="rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{String(label ?? "")}</p>
                      <p className="mt-1 text-xs text-zinc-600">
                        Sellout Units: <span className="font-semibold text-zinc-900">{formatInteger(Number(row.units ?? 0))}</span>
                      </p>
                      {row.pctGrowth !== null && row.pctGrowth !== undefined ? (
                        <p className="text-xs text-zinc-600">
                          MoM Growth:{" "}
                          <span className={row.pctGrowth >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-rose-600"}>
                            {row.pctGrowth >= 0 ? "+" : ""}
                            {formatDecimal(row.pctGrowth)}%
                          </span>
                        </p>
                      ) : null}
                      <p className="text-xs text-zinc-600">
                        Trend Index: <span className="font-semibold text-zinc-900">{formatDecimal(Number(row.trendScore ?? 0))}%</span>
                      </p>
                      {row.isCurrentMonth ? (
                        <p className="mt-1 text-[11px] text-zinc-500">Current month is MTD (partial)</p>
                      ) : null}
                    </div>
                  );
                }}
              />
              <Legend formatter={chartLegendFormatter} />
              <Bar yAxisId="left" dataKey="units" name="Sellout Units" radius={[6, 6, 0, 0]}>
                {selectedMomSeries.map((row) => (
                  <Cell key={`mom-bar-${row.label}`} fill={row.barColor} />
                ))}
              </Bar>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="trendScore"
                name="Sellout Trend Index"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={(props) => {
                  const payload = props.payload as { trendDelta?: number | null } | undefined;
                  const delta = payload?.trendDelta ?? 0;
                  return (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={3.5}
                      fill={delta >= 0 ? "#16a34a" : "#dc2626"}
                      stroke="#ffffff"
                      strokeWidth={1.2}
                    />
                  );
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 grid gap-3 text-sm text-zinc-700 md:grid-cols-2 xl:grid-cols-4">
          <p className="rounded-lg bg-emerald-50 px-3 py-2">
            Strongest MoM month: <strong>{highestMom ? `${formatDecimal(highestMom.pctGrowth)}%` : "N/A"}</strong> in{" "}
            <strong>{highestMomMonthText}</strong>.
          </p>
          <p className="rounded-lg bg-amber-50 px-3 py-2">
            Highest sellout in this range: <strong>{bestSelloutMonthFromMom.label}</strong> with{" "}
            <strong>{formatInteger(bestSelloutMonthFromMom.units)}</strong> units.
          </p>
          <p className="rounded-lg bg-rose-50 px-3 py-2">
            {negativeStreak > 0 ? (
              <>
                MoM has been negative for <strong>{negativeStreak} consecutive month{negativeStreak === 1 ? "" : "s"}</strong>.
              </>
            ) : (
              <>No active negative MoM streak.</>
            )}
          </p>
          <p className="rounded-lg bg-violet-50 px-3 py-2">
            {momFyScope === "current"
              ? `${currentMonthLabel} is MTD (partial month), so latest MoM is measured against full ${kpiPrevMonthLabel}.`
              : `${selectedFyLabel} shows complete month-on-month movement for that financial year.`}
          </p>
        </div>
      </Card>
    </div>
  );
}

function FyAttainmentSummaryCard({
  pct,
  tillLabel,
  previousFyRangeLabel,
  previousFyTotalUnits,
  currentYtdUnits,
}: {
  pct: number | null;
  tillLabel: string;
  previousFyRangeLabel: string;
  previousFyTotalUnits: number;
  currentYtdUnits: number;
}) {
  return (
    <div className="rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-100/90 via-white to-violet-50/50 px-5 py-5 shadow-md ring-1 ring-violet-200/60">
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-900">
        FY sellout vs prior full year
      </p>
      <div className="mt-5 space-y-4 border-t-2 border-violet-200/80 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-zinc-900">Previous FY total unit sales</p>
            <p className="mt-0.5 text-sm font-bold text-zinc-600">
              {previousFyRangeLabel} (full year)
            </p>
          </div>
          <span className="text-lg font-extrabold tabular-nums text-zinc-950">
            {formatInteger(previousFyTotalUnits)} units
          </span>
        </div>
        <div className="border-t border-violet-200/60 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 gap-y-1">
            <span className="text-base font-bold text-zinc-900">This FY till date sales</span>
            <span className="text-lg font-extrabold tabular-nums text-zinc-950">
              {formatInteger(currentYtdUnits)} units
            </span>
          </div>
          <p className="mt-2 text-sm font-bold text-zinc-700">{tillLabel}</p>
        </div>
        <p className="text-lg font-extrabold leading-snug text-zinc-950">
          {pct !== null ? (
            <>
              You have obtained{" "}
              <span className="text-violet-800 tabular-nums">{formatDecimal(pct)}%</span> of the previous
              financial year&apos;s unit sales.
            </>
          ) : (
            "—"
          )}
        </p>
      </div>
    </div>
  );
}

function MiniInsightCard({
  label,
  value,
  sub,
  icon,
  positive,
  variant = "default",
}: {
  label: string;
  value: string;
  sub: string;
  icon?: React.ReactNode;
  positive?: boolean;
  variant?: "default" | "emphasis";
}) {
  const emphasis = variant === "emphasis";
  return (
    <div
      className={cn(
        "rounded-2xl border shadow-sm",
        emphasis
          ? "border-2 border-zinc-300 bg-white px-5 py-5 shadow-md ring-1 ring-zinc-200/80"
          : "border border-zinc-200 bg-zinc-50/70 px-3 py-2",
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p
          className={cn(
            "font-bold uppercase tracking-wide text-zinc-900",
            emphasis ? "text-xs leading-tight" : "text-[10px] font-semibold text-zinc-600",
          )}
        >
          {label}
        </p>
        {icon}
      </div>
      <p
        className={cn(
          "leading-tight",
          emphasis ? "text-3xl font-extrabold tabular-nums" : "text-xl font-bold",
          positive === undefined ? "text-zinc-900" : positive ? "text-emerald-600" : "text-rose-600",
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          "mt-2",
          emphasis ? "text-sm font-bold text-zinc-800" : "text-[11px] font-normal text-zinc-600",
        )}
      >
        {sub}
      </p>
    </div>
  );
}
