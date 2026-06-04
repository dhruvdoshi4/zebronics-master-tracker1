import type { ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  CalendarDays,
  CircleHelp,
  Smile,
  TrendingUp,
} from "lucide-react";
import { formatPriorYearMtdPeriodLabel } from "./sellout-yoy-compare";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_LEGEND_STYLE } from "./chart-theme";
import { Card } from "./ui";
import { cn, formatDecimal, formatInteger } from "./utils";

const THIS_YEAR_BAR = "#7c3aed";
const LAST_YEAR_BAR = "#a5b4fc";
const TREND_LINE = "#f97316";

/** Stacked MTD compare — Amazon (darker) + Flipkart (lighter) per period. */
const LAST_YEAR_AMAZON = "#4f46e5";
const LAST_YEAR_FLIPKART = "#a5b4fc";
const THIS_YEAR_AMAZON = "#6d28d9";
const THIS_YEAR_FLIPKART = "#c4b5fd";

export type MtdChannelUnits = { amazon: number; flipkart: number };

export type MtdMomSeriesRow = {
  label: string;
  monthYearLabel: string;
  units: number;
  priorYearUnits: number;
  isMtdOngoing: boolean;
  pctGrowth: number | null;
  trendScore: number;
  trendDelta: number | null;
  barColor: string;
  channelUnits?: MtdChannelUnits;
  priorYearChannelUnits?: MtdChannelUnits;
};

export type MtdSelloutDashboardProps = {
  momChartSeries: MtdMomSeriesRow[];
  reportSnapshotDate: string | null;
  lastMonthUnits: number;
  lastMonthLabel: string;
  positiveYoyMonths: number;
  totalYoyMonths: number;
  formatThisYearChannelLine?: (row: MtdMomSeriesRow) => string | null;
  formatPriorYearChannelLine?: (row: MtdMomSeriesRow) => string | null;
  /** When set, MTD comparison bars stack Amazon + Flipkart (category / multi-channel views). */
  channelsActive?: { amazon: boolean; flipkart: boolean };
};

function formatMtdChannelSplitLine(ch: MtdChannelUnits | undefined): string | null {
  if (!ch || (ch.amazon <= 0 && ch.flipkart <= 0)) return null;
  return `${formatInteger(ch.amazon)} Amazon · ${formatInteger(ch.flipkart)} Flipkart`;
}

function formatSnapshotMtdPeriod(snapshotDate: string): string {
  const snap = new Date(`${snapshotDate}T12:00:00`);
  const start = new Date(snap.getFullYear(), snap.getMonth(), 1);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `${fmt(start)} – ${fmt(snap)}`;
}

type MtdKpiCardProps = {
  label: string;
  value: string;
  sub: ReactNode;
  icon: ReactNode;
  iconClassName: string;
  valueClassName?: string;
};

function MtdKpiCard({
  label,
  value,
  sub,
  icon,
  iconClassName,
  valueClassName,
}: MtdKpiCardProps) {
  return (
    <div className="relative rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
      <div
        className={cn(
          "absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm",
          iconClassName,
        )}
      >
        {icon}
      </div>
      <p className="pr-12 text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</p>
      <p
        className={cn(
          "mt-2 text-3xl font-extrabold leading-none tabular-nums tracking-tight",
          valueClassName ?? "text-zinc-900",
        )}
      >
        {value}
      </p>
      <div className="mt-2 text-sm font-medium text-zinc-500">{sub}</div>
    </div>
  );
}

function MomMonthTooltip({
  row,
  formatThisYearChannelLine,
  formatPriorYearChannelLine,
}: {
  row: MtdMomSeriesRow;
  formatThisYearChannelLine?: (row: MtdMomSeriesRow) => string | null;
  formatPriorYearChannelLine?: (row: MtdMomSeriesRow) => string | null;
}) {
  const thisYearLine = formatThisYearChannelLine?.(row) ?? null;
  const priorYearLine = formatPriorYearChannelLine?.(row) ?? null;

  return (
    <div className="min-w-[240px] rounded-xl border-2 border-zinc-200 bg-white px-4 py-3 shadow-lg">
      <p className="border-b border-zinc-100 pb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">
        {row.label}
        {row.isMtdOngoing ? (
          <span className="ml-1 font-semibold normal-case text-violet-600">· MTD (ongoing)</span>
        ) : (
          <span className="ml-1 font-semibold normal-case text-zinc-500">· Full month</span>
        )}
      </p>
      <p className="mt-2 text-sm font-semibold text-zinc-700">
        {row.isMtdOngoing ? "This year (MTD):" : "This year (total sellout):"}{" "}
        <span className="font-extrabold tabular-nums text-zinc-950">
          {formatInteger(row.units)}
        </span>
        {thisYearLine ? (
          <span className="block text-xs font-semibold text-zinc-500">({thisYearLine})</span>
        ) : null}
      </p>
      {row.priorYearUnits > 0 ? (
        <p className="mt-1 text-sm font-semibold text-zinc-700">
          {row.isMtdOngoing ? "Prior year (same period):" : "Same month prior year:"}{" "}
          <span className="font-extrabold tabular-nums text-zinc-950">
            {formatInteger(row.priorYearUnits)}
          </span>
          {priorYearLine ? (
            <span className="block text-xs font-semibold text-zinc-500">({priorYearLine})</span>
          ) : null}
        </p>
      ) : (
        <p className="mt-1 text-xs font-medium text-zinc-500">No prior-year baseline</p>
      )}
      {row.pctGrowth !== null ? (
        <p className="mt-1 text-sm font-semibold text-zinc-700">
          YoY growth:{" "}
          <span
            className={
              row.pctGrowth >= 0 ? "font-extrabold text-emerald-600" : "font-extrabold text-rose-600"
            }
          >
            {row.pctGrowth >= 0 ? "+" : ""}
            {formatDecimal(row.pctGrowth)}%
          </span>
        </p>
      ) : null}
      <p className="mt-1 text-sm font-semibold text-zinc-700">
        Trend index:{" "}
        <span className="font-extrabold tabular-nums text-zinc-950">
          {formatDecimal(row.trendScore)}%
        </span>
      </p>
    </div>
  );
}

export function MtdSelloutDashboard({
  momChartSeries,
  reportSnapshotDate,
  lastMonthUnits,
  lastMonthLabel,
  positiveYoyMonths,
  totalYoyMonths,
  formatThisYearChannelLine,
  formatPriorYearChannelLine,
  channelsActive,
}: MtdSelloutDashboardProps) {
  const latestMom = momChartSeries.length ? momChartSeries[momChartSeries.length - 1] : null;
  const mtdCurrentUnits = Number(latestMom?.units ?? 0);
  const mtdPriorUnits = Number(latestMom?.priorYearUnits ?? 0);
  const mtdYoyPct = latestMom?.pctGrowth ?? null;

  const currentPeriodLabel = reportSnapshotDate
    ? formatSnapshotMtdPeriod(reportSnapshotDate)
    : "Current MTD";
  const priorPeriodLabel = reportSnapshotDate
    ? (formatPriorYearMtdPeriodLabel(reportSnapshotDate) ?? "Prior year MTD")
    : "Prior year MTD";

  const yoyPositive = mtdYoyPct !== null && mtdYoyPct >= 0;
  const maxUnits = Math.max(1, ...momChartSeries.map((r) => r.units), mtdPriorUnits);

  const thisYearChannel = latestMom?.channelUnits;
  const priorYearChannel = latestMom?.priorYearChannelUnits;

  const showMtdChannelStack =
    Boolean(channelsActive?.amazon || channelsActive?.flipkart) &&
    Boolean(thisYearChannel || priorYearChannel) &&
    Boolean(
      (thisYearChannel &&
        (thisYearChannel.amazon > 0 || thisYearChannel.flipkart > 0)) ||
        (priorYearChannel &&
          (priorYearChannel.amazon > 0 || priorYearChannel.flipkart > 0)),
    );

  const mtdCompareData = [
    {
      key: "last-year",
      label: priorPeriodLabel,
      units: mtdPriorUnits,
      fill: LAST_YEAR_BAR,
      amazonUnits: showMtdChannelStack
        ? channelsActive?.amazon
          ? (priorYearChannel?.amazon ?? 0)
          : 0
        : 0,
      flipkartUnits: showMtdChannelStack
        ? channelsActive?.flipkart
          ? (priorYearChannel?.flipkart ?? 0)
          : 0
        : 0,
    },
    {
      key: "this-year",
      label: currentPeriodLabel,
      units: mtdCurrentUnits,
      fill: THIS_YEAR_BAR,
      amazonUnits: showMtdChannelStack
        ? channelsActive?.amazon
          ? (thisYearChannel?.amazon ?? 0)
          : 0
        : 0,
      flipkartUnits: showMtdChannelStack
        ? channelsActive?.flipkart
          ? (thisYearChannel?.flipkart ?? 0)
          : 0
        : 0,
    },
  ];
  const maxCompare = Math.max(mtdCurrentUnits, mtdPriorUnits, 1);
  const trendIndexThisYear = (mtdCurrentUnits / maxCompare) * 100;
  const trendIndexLastYear = (mtdPriorUnits / maxCompare) * 100;
  const mtdCompareWithTrend = [
    { ...mtdCompareData[0], trendIndex: trendIndexLastYear },
    { ...mtdCompareData[1], trendIndex: trendIndexThisYear },
  ];

  const chartLegendFormatter = (value: string) => (
    <span className="text-sm font-semibold text-zinc-700">{value}</span>
  );

  return (
    <section className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MtdKpiCard
          label="MTD Sellout (This Year)"
          value={formatInteger(mtdCurrentUnits)}
          icon={<BarChart3 className="h-5 w-5" />}
          iconClassName="bg-violet-600"
          sub={
            <>
              <p>{currentPeriodLabel}</p>
              {showMtdChannelStack && thisYearChannel ? (
                <p className="mt-0.5 text-xs font-semibold text-zinc-500">
                  {formatMtdChannelSplitLine(thisYearChannel)}
                </p>
              ) : null}
              {mtdYoyPct !== null && mtdPriorUnits > 0 ? (
                <p className="mt-1 font-semibold text-emerald-600">
                  ▲ {formatDecimal(Math.abs(mtdYoyPct))}% vs {priorPeriodLabel}
                </p>
              ) : null}
            </>
          }
        />
        <MtdKpiCard
          label="Last Month Sellout (Full Month)"
          value={formatInteger(lastMonthUnits)}
          icon={<CalendarDays className="h-5 w-5" />}
          iconClassName="bg-violet-500"
          sub={
            <>
              <p>{lastMonthLabel}</p>
              <p className="mt-0.5 text-zinc-400">Full month total</p>
            </>
          }
        />
        <MtdKpiCard
          label="YoY Growth (MTD)"
          value={
            mtdYoyPct !== null
              ? `${mtdYoyPct >= 0 ? "+" : ""}${formatDecimal(mtdYoyPct)}%`
              : "N/A"
          }
          icon={<TrendingUp className="h-5 w-5" />}
          iconClassName="bg-emerald-500"
          valueClassName={
            mtdYoyPct !== null
              ? mtdYoyPct >= 0
                ? "text-emerald-600"
                : "text-rose-600"
              : "text-zinc-900"
          }
          sub={
            <p>
              {currentPeriodLabel}
              <br />
              <span className="text-zinc-400">vs {priorPeriodLabel}</span>
            </p>
          }
        />
        <MtdKpiCard
          label="Positive YoY Months"
          value={`${positiveYoyMonths} / ${totalYoyMonths}`}
          icon={<Smile className="h-5 w-5" />}
          iconClassName="bg-violet-500"
          sub={<p>Months</p>}
        />
      </div>

      <div className="space-y-5">
        <Card className="border-zinc-200 p-5 shadow-sm">
          <div className="mb-3 flex items-start gap-2">
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-lg font-bold text-zinc-900">MTD Sellout Comparison</h3>
                <CircleHelp className="h-4 w-4 text-zinc-400" />
              </div>
              <p className="mt-0.5 text-sm font-medium text-zinc-500">
                This Year vs Last Year (MTD)
                {showMtdChannelStack ? (
                  <span className="text-zinc-400">
                    {" "}
                    · Amazon + Flipkart split (same as FY trend)
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-center gap-6 text-sm font-semibold text-zinc-600">
            {showMtdChannelStack ? (
              <>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm" style={{ background: THIS_YEAR_AMAZON }} />
                  Amazon (this year MTD)
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm" style={{ background: THIS_YEAR_FLIPKART }} />
                  Flipkart (this year MTD)
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm" style={{ background: LAST_YEAR_AMAZON }} />
                  Amazon (last year MTD)
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm" style={{ background: LAST_YEAR_FLIPKART }} />
                  Flipkart (last year MTD)
                </span>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm" style={{ background: THIS_YEAR_BAR }} />
                  Units (This Year MTD)
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm" style={{ background: LAST_YEAR_BAR }} />
                  Units (Last Year MTD)
                </span>
              </>
            )}
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-0.5 w-6 rounded bg-orange-500" />
              Trend Index (%)
            </span>
          </div>

          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={mtdCompareWithTrend}
                margin={{ top: 32, right: 12, left: 4, bottom: 8 }}
              >
                <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ ...CHART_AXIS_TICK, fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  height={48}
                />
                <YAxis
                  yAxisId="units"
                  tick={CHART_AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) =>
                    Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}K` : String(v)
                  }
                  domain={[0, Math.ceil((maxCompare * 1.15) / 5000) * 5000]}
                />
                <YAxis
                  yAxisId="trend"
                  orientation="right"
                  tick={CHART_AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  unit="%"
                  domain={[0, 100]}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as (typeof mtdCompareWithTrend)[number];
                    const channelLine = showMtdChannelStack
                      ? formatMtdChannelSplitLine({
                          amazon: row.amazonUnits,
                          flipkart: row.flipkartUnits,
                        })
                      : null;
                    return (
                      <div className="min-w-[220px] rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-lg">
                        <p className="text-xs font-bold uppercase text-zinc-500">{row.label}</p>
                        <p className="mt-2 text-sm font-semibold text-zinc-800">
                          Units:{" "}
                          <span className="font-extrabold tabular-nums">
                            {formatInteger(row.units)}
                          </span>
                        </p>
                        {channelLine ? (
                          <p className="mt-1 text-xs font-semibold text-zinc-500">{channelLine}</p>
                        ) : null}
                      </div>
                    );
                  }}
                />
                {showMtdChannelStack ? (
                  <>
                    <Bar
                      yAxisId="units"
                      dataKey="amazonUnits"
                      name="Amazon"
                      stackId="mtdCompare"
                      barSize={80}
                    >
                      {mtdCompareWithTrend.map((row) => (
                        <Cell
                          key={`${row.key}-az`}
                          fill={row.key === "last-year" ? LAST_YEAR_AMAZON : THIS_YEAR_AMAZON}
                        />
                      ))}
                    </Bar>
                    <Bar
                      yAxisId="units"
                      dataKey="flipkartUnits"
                      name="Flipkart"
                      stackId="mtdCompare"
                      barSize={80}
                      radius={[10, 10, 0, 0]}
                    >
                      {mtdCompareWithTrend.map((row) => (
                        <Cell
                          key={`${row.key}-fk`}
                          fill={row.key === "last-year" ? LAST_YEAR_FLIPKART : THIS_YEAR_FLIPKART}
                        />
                      ))}
                      <LabelList
                        position="top"
                        content={({ x, y, width, index }) => {
                          const row = mtdCompareWithTrend[index ?? 0];
                          if (row == null || x == null || y == null || width == null) {
                            return null;
                          }
                          return (
                            <text
                              x={Number(x) + Number(width) / 2}
                              y={Number(y) - 6}
                              textAnchor="middle"
                              className="fill-zinc-800 text-xs font-bold"
                            >
                              {formatInteger(row.units)}
                            </text>
                          );
                        }}
                      />
                    </Bar>
                  </>
                ) : (
                  <Bar yAxisId="units" dataKey="units" barSize={80} radius={[10, 10, 0, 0]}>
                    {mtdCompareWithTrend.map((row) => (
                      <Cell key={row.key} fill={row.fill} />
                    ))}
                    <LabelList
                      dataKey="units"
                      position="top"
                      formatter={(v) => formatInteger(Number(v ?? 0))}
                      className="fill-zinc-800 text-xs font-bold"
                    />
                  </Bar>
                )}
                <Line
                  yAxisId="trend"
                  type="monotone"
                  dataKey="trendIndex"
                  stroke={TREND_LINE}
                  strokeWidth={2.5}
                  dot={{ r: 5, fill: "#22c55e", stroke: "#fff", strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {mtdYoyPct !== null && mtdPriorUnits > 0 ? (
            <div
              className={cn(
                "mt-4 rounded-xl border px-4 py-3",
                yoyPositive
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-rose-200 bg-rose-50",
              )}
            >
              <p
                className={cn(
                  "text-base font-bold",
                  yoyPositive ? "text-emerald-700" : "text-rose-700",
                )}
              >
                {yoyPositive ? "▲" : "▼"} Growth of {formatDecimal(Math.abs(mtdYoyPct))}%
              </p>
              <p
                className={cn(
                  "mt-0.5 text-sm font-medium",
                  yoyPositive ? "text-emerald-800/90" : "text-rose-800/90",
                )}
              >
                {yoyPositive
                  ? "You're performing better than last year."
                  : "You're below last year's same-period sellout."}
              </p>
            </div>
          ) : null}
        </Card>

        <Card className="border-zinc-200 p-5 shadow-sm">
          <div className="mb-3">
            <h3 className="text-lg font-bold text-zinc-900">Month on month sellout</h3>
            <p className="mt-0.5 text-sm font-medium text-zinc-500">
              Each bar is this FY. Completed months are full month; ongoing month is MTD. Hover for
              prior year and growth %.
            </p>
          </div>

          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={momChartSeries}
                margin={{ top: 12, right: 8, left: 4, bottom: 4 }}
              >
                <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="monthYearLabel"
                  tick={{ ...CHART_AXIS_TICK, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <YAxis
                  yAxisId="left"
                  tick={CHART_AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, Math.ceil((maxUnits * 1.12) / 5000) * 5000]}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={CHART_AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  unit="%"
                  domain={[0, 100]}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as MtdMomSeriesRow | undefined;
                    if (!row) return null;
                    return (
                      <MomMonthTooltip
                        row={row}
                        formatThisYearChannelLine={formatThisYearChannelLine}
                        formatPriorYearChannelLine={formatPriorYearChannelLine}
                      />
                    );
                  }}
                />
                <Legend formatter={chartLegendFormatter} wrapperStyle={CHART_LEGEND_STYLE} />
                <Bar yAxisId="left" dataKey="units" name="Units (category)" radius={[8, 8, 0, 0]}>
                  {momChartSeries.map((row) => (
                    <Cell key={row.label} fill={row.barColor} />
                  ))}
                </Bar>
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="trendScore"
                  name="Trend index"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={(props) => {
                    const payload = props.payload as { trendDelta?: number | null } | undefined;
                    const delta = payload?.trendDelta ?? 0;
                    return (
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={4}
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
        </Card>
      </div>
    </section>
  );
}
