import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  ImageIcon,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "date-fns";
import { getProductSelloutHistory } from "./data";
import type {
  ComputedMetric,
  DailySale,
  Marketplace,
  ProductMaster,
} from "./types";
import {
  Card,
  ChartTooltip,
  EmptyState,
  InlineLoader,
  Logo,
  StatCard,
} from "./ui";
import { cn, formatDecimal, formatInteger } from "./utils";

const AXIS_TICK = { fill: "#71717a", fontSize: 11 } as const;
const GRID_STROKE = "rgba(113,113,122,0.25)";

type Granularity = "daily" | "monthly";

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

function formatAsOfLabel(value: string): string {
  try {
    return format(new Date(`${value}T00:00:00`), "dd MMM");
  } catch {
    return value;
  }
}

function formatMonthLabel(value: string): string {
  try {
    return format(new Date(`${value}-01T00:00:00`), "MMM yyyy");
  } catch {
    return value;
  }
}

function aggregateMonthly(
  daily: DailySale[],
): { monthKey: string; label: string; units: number }[] {
  const buckets = new Map<string, number>();
  for (const entry of daily) {
    const monthKey = entry.sale_date.slice(0, 7);
    buckets.set(monthKey, (buckets.get(monthKey) ?? 0) + entry.units_sold);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, units]) => ({
      monthKey,
      label: formatMonthLabel(monthKey),
      units,
    }));
}

export function SelloutReportPage() {
  const params = useParams<{ marketplace: string; code: string }>();
  const marketplace = (params.marketplace as Marketplace) ?? "amazon";
  const productCode = (params.code ?? "").toUpperCase();

  const [product, setProduct] = useState<ProductMaster | null>(null);
  const [history, setHistory] = useState<ComputedMetric[]>([]);
  const [dailySales, setDailySales] = useState<DailySale[]>([]);
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void getProductSelloutHistory(marketplace, productCode)
      .then((data) => {
        setProduct(data.product);
        setHistory(data.history);
        setDailySales(data.dailySales);
      })
      .catch((e: unknown) =>
        setError(
          e instanceof Error
            ? e.message
            : "Failed to load sellout history.",
        ),
      )
      .finally(() => setIsLoading(false));
  }, [marketplace, productCode]);

  const codeLabel = getCodeLabel(marketplace);
  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => a.as_of_date.localeCompare(b.as_of_date)),
    [history],
  );
  const sortedDaily = useMemo(
    () => [...dailySales].sort((a, b) => a.sale_date.localeCompare(b.sale_date)),
    [dailySales],
  );

  const dailySeries = useMemo(
    () =>
      sortedDaily.map((row) => ({
        date: row.sale_date,
        label: formatAsOfLabel(row.sale_date),
        units: row.units_sold,
      })),
    [sortedDaily],
  );

  const monthlySeries = useMemo(
    () =>
      aggregateMonthly(sortedDaily).map((row) => ({
        date: row.monthKey,
        label: row.label,
        units: row.units,
      })),
    [sortedDaily],
  );

  const trendSeries = granularity === "daily" ? dailySeries : monthlySeries;

  const inventorySeries = useMemo(
    () =>
      sortedHistory.map((row) => ({
        date: row.as_of_date,
        label: formatAsOfLabel(row.as_of_date),
        inventory: row.inventory_units,
        targetStock: Number((row.drr_units * 45).toFixed(2)),
        po: Math.max(0, row.purchase_order_units),
      })),
    [sortedHistory],
  );

  const summary = useMemo(() => {
    if (sortedHistory.length === 0) return null;
    const latest = sortedHistory[sortedHistory.length - 1];

    const totalLifetimeFromDaily = sortedDaily.reduce(
      (sum, entry) => sum + entry.units_sold,
      0,
    );
    const days = sortedDaily.length;
    const lastDay = sortedDaily.length
      ? sortedDaily[sortedDaily.length - 1]
      : null;
    const last30Total = sortedDaily
      .slice(-30)
      .reduce((sum, entry) => sum + entry.units_sold, 0);

    return {
      latest,
      snapshotCount: sortedHistory.length,
      totalLifetimeFromDaily,
      dayCount: days,
      lastDay,
      last30Total,
    };
  }, [sortedHistory, sortedDaily]);

  const hasDaily = sortedDaily.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to="/app/asin"
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Lookup
        </Link>
      </div>

      <Card className="border-2 border-violet-200 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 dark:border-violet-900/60 dark:from-violet-950/40 dark:via-zinc-900 dark:to-fuchsia-950/30">
        <div className="flex items-start gap-4">
          <Logo size={56} className="ring-1 ring-violet-200 dark:ring-violet-900/60" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TrendingUp className="h-4 w-4 text-violet-600 dark:text-violet-300" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
                Historical Sellout Report
              </p>
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {product?.product_name ?? productCode}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Daily and monthly sellout for this {codeLabel} on{" "}
              {marketplace === "amazon" ? "Amazon" : "Flipkart"}.
            </p>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <InlineLoader text="Loading sellout history..." />
      ) : error ? (
        <EmptyState title="Could not load report" description={error} />
      ) : sortedHistory.length === 0 && !hasDaily ? (
        <EmptyState
          title="No history found"
          description={`No upload snapshots were found for ${productCode}. Make sure the ${codeLabel} exists in a recent upload.`}
        />
      ) : (
        <>
          <Card className="grid gap-5 md:grid-cols-[180px_1fr]">
            <div className="flex h-44 w-44 items-center justify-center overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-50 to-zinc-100 text-zinc-400 dark:border-zinc-700 dark:from-zinc-900 dark:to-zinc-950">
              {product?.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.product_name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-1 text-xs">
                  <ImageIcon className="h-6 w-6" />
                  No Image
                </div>
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                  {codeLabel}
                </span>
                <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
                  {productCode}
                </span>
                {product?.sub_category ? (
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                    {product.sub_category}
                  </span>
                ) : null}
              </div>
              <h2 className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                {product?.product_name ?? productCode}
              </h2>

              {summary ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <StatCard
                    label="Latest Total SO"
                    value={formatInteger(summary.latest.total_so_units)}
                    variant="emerald"
                    hint={`As of ${formatAsOfLabel(summary.latest.as_of_date)}`}
                  />
                  <StatCard
                    label="Last 30 Days Sellout"
                    value={formatInteger(summary.last30Total)}
                    variant="violet"
                    hint={
                      summary.lastDay
                        ? `Through ${formatAsOfLabel(summary.lastDay.sale_date)}`
                        : `${summary.dayCount} day${summary.dayCount === 1 ? "" : "s"} of data`
                    }
                  />
                  <StatCard
                    label="Latest PO"
                    value={formatInteger(summary.latest.purchase_order_units)}
                    variant="amber"
                    hint={`DRR ${formatDecimal(summary.latest.drr_units)} / day`}
                  />
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-violet-500" />
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Sellout Trend
                </h3>
                <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                  {granularity === "daily" ? "Daily" : "Monthly"} units sold
                </span>
              </div>
              <div className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 p-0.5 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-900">
                {(["daily", "monthly"] as Granularity[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setGranularity(option)}
                    className={cn(
                      "rounded-full px-3 py-1 capitalize transition",
                      granularity === option
                        ? "bg-violet-600 text-white shadow-sm"
                        : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            {hasDaily ? (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={trendSeries}
                    margin={{ top: 10, right: 16, bottom: 10, left: 0 }}
                  >
                    <defs>
                      <linearGradient id="selloutFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={GRID_STROKE}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={granularity === "daily" ? 24 : 8}
                    />
                    <YAxis
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={
                        <ChartTooltip
                          formatValue={(value) =>
                            `${formatInteger(Number(value ?? 0))} units`
                          }
                          labelPrefix={granularity === "daily" ? "Day" : "Month"}
                        />
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="units"
                      name={granularity === "daily" ? "Daily units" : "Monthly units"}
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      fill="url(#selloutFill)"
                      dot={granularity === "daily" ? false : { r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                title="No daily sellout data"
                description="Daily sales are read from the dated columns in the Consolidated sheet. Re-upload the latest report to populate this chart."
              />
            )}
          </Card>

          {inventorySeries.length > 0 ? (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Inventory & Target Stock
                </h3>
                <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">
                  Stock vs DRR &times; 45
                </span>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={inventorySeries}
                    margin={{ top: 10, right: 16, bottom: 10, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={GRID_STROKE}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={
                        <ChartTooltip
                          formatValue={(value) =>
                            `${formatInteger(Number(value ?? 0))}`
                          }
                          labelPrefix="As of"
                        />
                      }
                    />
                    <Legend
                      iconType="circle"
                      wrapperStyle={{ fontSize: 12, color: "#71717a" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="inventory"
                      name="Inventory"
                      stroke="#0ea5e9"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="targetStock"
                      name="Target Stock"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="po"
                      name="PO"
                      stroke="#d97706"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}

          {sortedHistory.length > 0 ? (
            <Card className="overflow-auto">
              <div className="mb-3 flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-zinc-400" />
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Snapshot History
                </h3>
                <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {sortedHistory.length} snapshots
                </span>
              </div>
              <table className="min-w-full divide-y divide-zinc-200 text-sm text-zinc-700 dark:divide-zinc-800 dark:text-zinc-200">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    <th className="px-3 py-2">As of</th>
                    <th className="px-3 py-2">Inventory</th>
                    <th className="px-3 py-2">Total SO</th>
                    <th className="px-3 py-2">May MTD</th>
                    <th className="px-3 py-2">Apr SO</th>
                    <th className="px-3 py-2">DRR</th>
                    <th className="px-3 py-2">DOC</th>
                    <th className="px-3 py-2 text-right">PO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {[...sortedHistory].reverse().map((row) => (
                    <tr
                      key={row.as_of_date}
                      className="hover:bg-violet-50/60 dark:hover:bg-violet-950/20"
                    >
                      <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                        {format(
                          new Date(`${row.as_of_date}T00:00:00`),
                          "dd MMM yyyy",
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {formatInteger(row.inventory_units)}
                      </td>
                      <td className="px-3 py-2">
                        {formatInteger(row.total_so_units)}
                      </td>
                      <td className="px-3 py-2">
                        {formatInteger(row.may_mtd_units)}
                      </td>
                      <td className="px-3 py-2">
                        {formatInteger(row.apr_so_units)}
                      </td>
                      <td className="px-3 py-2">
                        {formatDecimal(row.drr_units)}
                      </td>
                      <td className="px-3 py-2">
                        {formatDecimal(row.doc_days)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.purchase_order_units > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-400/40 dark:text-amber-200 dark:ring-amber-500/40">
                            {formatInteger(row.purchase_order_units)}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-400 dark:text-zinc-600">
                            &mdash;
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
