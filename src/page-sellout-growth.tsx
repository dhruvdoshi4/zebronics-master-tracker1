import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bar,
  Cell,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CircleHelp,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  getLatestMetricForProduct,
  getProductByCode,
  getProductMonthlySelloutByModel,
} from "./data";
import type { ComputedMetric, DailySale, Marketplace, ProductMaster } from "./types";
import { Card, ChartTooltip, EmptyState, InlineLoader, StatCard } from "./ui";
import { formatDecimal, formatInteger } from "./utils";

const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
const AXIS_TICK = { fill: "#71717a", fontSize: 11 } as const;
const GRID_STROKE = "rgba(113,113,122,0.2)";

function getCurrentFyStart(date: Date): number {
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

export function SelloutGrowthPage() {
  const params = useParams<{ marketplace: string; code: string }>();
  const marketplace = (params.marketplace as Marketplace) ?? "amazon";
  const productCode = params.code ?? "";
  const [product, setProduct] = useState<ProductMaster | null>(null);
  const [monthlyRows, setMonthlyRows] = useState<DailySale[]>([]);
  const [latestMetric, setLatestMetric] = useState<ComputedMetric | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void Promise.all([
      getProductByCode(marketplace, productCode),
      getLatestMetricForProduct(marketplace, productCode),
      getProductByCode(marketplace, productCode).then((productRow) => {
        if (!productRow) return [];
        return getProductMonthlySelloutByModel(marketplace, productRow.product_name);
      }),
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
    if (!sales.length) return null;

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
    const fyCurrentMonthsTillDate = monthSequence(currentFyStart, 3, currentFyMonthIndex).map(
      (d) => monthKey(d),
    );
    const previousFyTotal = fyPrevMonths.reduce(
      (sum, key) => sum + (monthlyMap.get(key) ?? 0),
      0,
    );
    const currentFyTotal = fyCurrentMonthsTillDate.reduce(
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
      const isCurrentMonthPoint = index + 1 === currentFyMonthIndex;
      const currentMonthMtdOverride = latestMetric?.may_mtd_units ?? null;
      const currentFyValue = currentMap.get(currentMonthKey) ?? 0;
      return {
        month,
        currentFy:
          index + 1 <= currentFyMonthIndex
            ? isCurrentMonthPoint && currentMonthMtdOverride !== null
              ? Number(currentMonthMtdOverride)
              : currentFyValue
            : null,
        previousFy: previousMap.get(previousMonthKey) ?? 0,
      };
    });

    const yoy = sales
      .map((item) => {
        const prevYearDate = new Date(item.date.getFullYear() - 1, item.date.getMonth(), 1);
        const prev = sales.find(
          (x) =>
            x.date.getFullYear() === prevYearDate.getFullYear() &&
            x.date.getMonth() === prevYearDate.getMonth(),
        );
        if (!prev) return null;
        const pctGrowth = prev.units > 0 ? ((item.units - prev.units) / prev.units) * 100 : 0;
        return {
          label: item.label,
          units: item.units,
          pctGrowth,
          growthColor: pctGrowth >= 0 ? "#16a34a" : "#dc2626",
          barColor: pctGrowth >= 0 ? "#22c55e" : "#ef4444",
        };
      })
      .filter(
        (
          v,
        ): v is {
          label: string;
          units: number;
          pctGrowth: number;
          growthColor: string;
          barColor: string;
        } => v !== null,
      );

    const mom = sales
      .map((item, index) => {
        if (index === 0) return null;
        const prev = sales[index - 1];
        const pctGrowth = prev.units > 0 ? (item.units / prev.units - 1) * 100 : 0;
        return {
          label: item.label,
          units: item.units,
          pctGrowth,
          growthColor: pctGrowth >= 0 ? "#16a34a" : "#dc2626",
          barColor: pctGrowth >= 0 ? "#22c55e" : "#ef4444",
        };
      })
      .filter(
        (
          v,
        ): v is {
          label: string;
          units: number;
          pctGrowth: number;
          growthColor: string;
          barColor: string;
        } => v !== null,
      );

    return {
      currentFyStart,
      previousFyStart,
      currentFyTotal,
      previousFyTotal,
      fyLine,
      yoy,
      mom,
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
  const salesSinceApr2025 = insights.sales.filter(
    (row) => row.date >= new Date("2025-04-01T00:00:00"),
  );
  const bestMonthPool = salesSinceApr2025.length ? salesSinceApr2025 : insights.sales;
  const bestMonth = bestMonthPool.reduce(
    (best, row) => (row.units > best.units ? row : best),
    bestMonthPool[0],
  );
  const currentMonthMtd = latestMetric?.may_mtd_units ?? 0;
  const previousMonthSo = latestMetric?.apr_so_units ?? 0;
  const drr = latestMetric?.drr_units ?? 0;
  const doc = latestMetric?.doc_days ?? 0;
  const currentMonthName = new Date().toLocaleString("en-US", { month: "short" });
  const previousMonthDate = new Date();
  previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
  const previousMonthName = previousMonthDate.toLocaleString("en-US", { month: "short" });
  const yoyOverlay = insights.fyLine
    .map((row) => {
      if (row.currentFy === null || row.previousFy <= 0) return null;
      const growthPct = ((row.currentFy - row.previousFy) / row.previousFy) * 100;
      return {
        month: row.month,
        prevUnits: row.previousFy,
        currentUnits: row.currentFy,
        growthPct,
        growthColor: growthPct >= 0 ? "#16a34a" : "#dc2626",
      };
    })
    .filter(
      (row): row is {
        month: string;
        prevUnits: number;
        currentUnits: number;
        growthPct: number;
        growthColor: string;
      } => row !== null,
    );
  const yoyYtdPct =
    insights.previousFyTotal > 0
      ? ((insights.currentFyTotal - insights.previousFyTotal) / insights.previousFyTotal) * 100
      : 0;
  const latestMoM = insights.mom.length ? insights.mom[insights.mom.length - 1] : null;
  const highestMoM = insights.mom.reduce(
    (best, row) => (row.pctGrowth > best.pctGrowth ? row : best),
    insights.mom[0] ?? { label: "N/A", pctGrowth: 0, units: 0, growthColor: "#16a34a", barColor: "#22c55e" },
  );
  const positiveMoMCount = insights.mom.filter((row) => row.pctGrowth > 0).length;
  const negativeStreak = (() => {
    let streak = 0;
    for (let i = insights.mom.length - 1; i >= 0; i -= 1) {
      if (insights.mom[i].pctGrowth < 0) streak += 1;
      else break;
    }
    return streak;
  })();
  const weakestMonth = insights.sales.reduce(
    (weakest, row) => (row.units < weakest.units ? row : weakest),
    insights.sales[0],
  );

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
          Professional insights sourced from the Ecom Sellout master sheet.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={`FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)} Total SO`}
          value={formatInteger(insights.previousFyTotal)}
          variant="emerald"
        />
        <StatCard
          label={`FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)} Total SO (Till Date)`}
          value={formatInteger(insights.currentFyTotal)}
          variant="violet"
          hint={`Current FY month: ${insights.currentFyMonthIndex} of 12`}
        />
        <StatCard
          label={`Current Month MTD (${currentMonthName})`}
          value={formatInteger(currentMonthMtd)}
          variant="sky"
        />
        <StatCard
          label={`Previous Month SO (${previousMonthName})`}
          value={formatInteger(previousMonthSo)}
          variant="amber"
        />
        <StatCard label="DRR" value={formatDecimal(drr)} variant="violet" />
        <StatCard label="DOC" value={formatDecimal(doc)} variant="emerald" />
        <StatCard
          label="Average Monthly Sellout"
          value={formatInteger(avgMonthlySellout)}
          variant="sky"
        />
        <StatCard
          label="Best Performing Month (since Apr 2025)"
          value={`${bestMonth.label} (${formatInteger(bestMonth.units)})`}
          variant="amber"
        />
      </div>

      <Card className="p-6">
        <h3 className="mb-3 text-sm font-semibold">Financial Year Sellout Trend (Monthly)</h3>
        <div className="h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={insights.fyLine}>
              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip
                content={
                  <ChartTooltip
                    formatValue={(value) => `${formatInteger(Number(value ?? 0))} units`}
                  />
                }
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="previousFy"
                name="Previous FY"
                stroke="#94a3b8"
                fill="#e2e8f0"
                fillOpacity={0.85}
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="currentFy"
                name="Current FY"
                stroke="#4f46e5"
                strokeWidth={4}
                dot={{ r: 3, fill: "#4f46e5" }}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <h3 className="mb-3 text-sm font-semibold">Year on Year (YoY) Growth (Monthly)</h3>
          <div className="h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={yoyOverlay}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <Tooltip
                  content={
                    <ChartTooltip
                      formatValue={(value) => `${formatDecimal(Number(value ?? 0))}`}
                    />
                  }
                />
                <Legend />
                <Bar yAxisId="left" dataKey="prevUnits" name={`${insights.previousFyStart}`} fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey="currentUnits" name={`${insights.currentFyStart}`} fill="#4f46e5" radius={[4, 4, 0, 0]} />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="growthPct"
                  name="YoY Growth %"
                  stroke="#16a34a"
                  strokeWidth={2}
                  dot={(props) => {
                    const payload = props.payload as { growthColor?: string } | undefined;
                    return (
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={4}
                        fill={payload?.growthColor ?? "#16a34a"}
                        stroke="#ffffff"
                        strokeWidth={1.5}
                      />
                    );
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Month on Month (MoM) Growth</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Track short-term momentum and monthly sellout growth trend
              </p>
            </div>
            <CircleHelp className="h-4 w-4 text-zinc-400" />
          </div>

          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MiniKpiCard
              label={`Latest Month (${currentMonthName} MTD)`}
              value={formatInteger(currentMonthMtd)}
              sub={latestMoM ? `vs ${previousMonthName}: ${formatDecimal(latestMoM.pctGrowth)}%` : "No comparison"}
              icon={<CalendarDays className="h-4 w-4 text-violet-600" />}
              tone="violet"
            />
            <MiniKpiCard
              label="Highest MoM Growth"
              value={`${formatDecimal(highestMoM.pctGrowth)}%`}
              sub={highestMoM.label}
              icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
              tone="emerald"
            />
            <MiniKpiCard
              label="Highest Sellout Month"
              value={formatInteger(bestMonth.units)}
              sub={bestMonth.label}
              icon={<Sparkles className="h-4 w-4 text-amber-600" />}
              tone="amber"
            />
            <MiniKpiCard
              label="Avg Monthly Sellout"
              value={formatInteger(avgMonthlySellout)}
              sub="Since Apr 2025"
              icon={<BarChart3 className="h-4 w-4 text-sky-600" />}
              tone="sky"
            />
            <MiniKpiCard
              label="Positive MoM Months"
              value={`${positiveMoMCount} / ${insights.mom.length}`}
              sub="in selected period"
              icon={<TrendingDown className="h-4 w-4 text-fuchsia-600" />}
              tone="fuchsia"
            />
          </div>

          <div className="h-[430px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={insights.mom}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <Tooltip
                  content={
                    <ChartTooltip
                      formatValue={(value) => `${formatDecimal(Number(value ?? 0))}`}
                    />
                  }
                />
                <Legend />
                <Bar yAxisId="left" dataKey="units" name="Units Sold" radius={[6, 6, 0, 0]}>
                  {insights.mom.map((row) => (
                    <Cell key={`mom-${row.label}`} fill={row.barColor} />
                  ))}
                </Bar>
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="pctGrowth"
                  name="YoY Growth %"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={(props) => {
                    const payload = props.payload as { growthColor?: string } | undefined;
                    return (
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={3}
                        fill={payload?.growthColor ?? "#8b5cf6"}
                      />
                    );
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            {currentMonthName} is MTD (partial). MoM growth compares against full {previousMonthName}.
          </p>
        </Card>
      </div>

      <Card className="p-6">
        <h3 className="mb-3 text-sm font-semibold">Key Insights</h3>
        <div className="grid gap-3 text-sm text-zinc-700 md:grid-cols-2 xl:grid-cols-4">
          <p className="rounded-lg bg-emerald-50 px-3 py-2">
            FY till date is <strong>{formatDecimal(yoyYtdPct)}%</strong>{" "}
            {yoyYtdPct >= 0 ? "higher" : "lower"} than previous FY total.
          </p>
          <p className="rounded-lg bg-violet-50 px-3 py-2">
            Best month is <strong>{bestMonth.label}</strong> with{" "}
            <strong>{formatInteger(bestMonth.units)}</strong> units.
          </p>
          <p className="rounded-lg bg-amber-50 px-3 py-2">
            Weakest month is <strong>{weakestMonth.label}</strong> with{" "}
            <strong>{formatInteger(weakestMonth.units)}</strong> units.
          </p>
          <p className="rounded-lg bg-sky-50 px-3 py-2">
            Latest MoM growth is{" "}
            <strong>{latestMoM ? `${formatDecimal(latestMoM.pctGrowth)}%` : "N/A"}</strong>.
          </p>
          <p className="rounded-lg bg-rose-50 px-3 py-2">
            {negativeStreak > 0 ? (
              <>
                MoM growth has been negative for{" "}
                <strong>{negativeStreak} consecutive month{negativeStreak === 1 ? "" : "s"}</strong>.
              </>
            ) : (
              <>No active negative MoM streak currently.</>
            )}
          </p>
        </div>
      </Card>
    </div>
  );
}

function MiniKpiCard({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  tone: "violet" | "emerald" | "amber" | "sky" | "fuchsia";
}) {
  const toneClass =
    tone === "violet"
      ? "border-violet-200 bg-violet-50"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50"
          : tone === "sky"
            ? "border-sky-200 bg-sky-50"
            : "border-fuchsia-200 bg-fuchsia-50";

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">{label}</p>
        {icon}
      </div>
      <p className="text-2xl font-bold leading-tight">{value}</p>
      <p className="mt-1 text-[11px] text-zinc-600">{sub}</p>
    </div>
  );
}
