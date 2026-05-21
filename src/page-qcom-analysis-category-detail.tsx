import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, CalendarDays, CircleHelp, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import {
  computeQcomCategorySelloutInsights,
  emptyQcomChannelUnits,
  type QcomCategorySheetMonthlySellout,
  type QcomChannelUnits,
} from "./qcom-category-sellout-insights";
import {
  QCOM_CATEGORY_ANALYSIS_ALL,
  loadQcomCategorySheetMonthlySellout,
  listQcomCategories,
  qcomCategoryAnalysisLabel,
} from "./data-qcom";
import { formatQcomChannelUnitsLine } from "./qcom-channel-format";
import { marketplaceLabel } from "./marketplace-labels";
import { qcomAnalysisCategoryPath } from "./qcom-paths";
import { QCOM_MARKETPLACES, type QcomMarketplace } from "./types";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_LEGEND_STYLE } from "./chart-theme";
import {
  Card,
  DataAsOnQcomChannelsBadge,
  EmptyState,
  FieldLabel,
  InlineLoader,
  PageTitle,
  Select,
  StatCard,
} from "./ui";
import { useLatestUploadSheetCoverageByQcom } from "./use-qcom-sheet-coverage";
import { cn, formatDecimal, formatInteger } from "./utils";

const CURRENT_FY_COLOR = "#4f46e5";
const PREVIOUS_FY_COLOR = "#94a3b8";
const AXIS_TICK = CHART_AXIS_TICK;

function QcomChannelUnitsInline({
  units,
  channelsActive,
}: {
  units?: QcomChannelUnits;
  channelsActive: Record<QcomMarketplace, boolean>;
}) {
  const line = units ? formatQcomChannelUnitsLine(units, channelsActive) : undefined;
  if (!line) return null;
  return <span className="font-semibold text-zinc-600"> ({line})</span>;
}

export function QcomAnalysisCategoryDetailPage() {
  const navigate = useNavigate();
  const params = useParams<{ category: string }>();
  const category = params.category ? decodeURIComponent(params.category).trim() : "";
  const categoryLabel = qcomCategoryAnalysisLabel(category);

  const [categories, setCategories] = useState<string[]>([]);
  const [sheetMonths, setSheetMonths] = useState<QcomCategorySheetMonthlySellout | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [momFyScope, setMomFyScope] = useState<"current" | "previous">("current");

  const skuCountByChannel = sheetMonths?.skuCountByChannel ?? emptyQcomChannelUnits();
  const skuCount = sheetMonths?.skuCount ?? 0;
  const channelsActive =
    sheetMonths?.channelsActive ??
    Object.fromEntries(QCOM_MARKETPLACES.map((ch) => [ch, false])) as Record<
      QcomMarketplace,
      boolean
    >;
  const channelCoverage = useLatestUploadSheetCoverageByQcom();
  const anyChannelActive = QCOM_MARKETPLACES.some((ch) => channelsActive[ch]);

  useEffect(() => {
    void listQcomCategories().then(setCategories);
  }, []);

  useEffect(() => {
    if (!category) return;
    setIsLoading(true);
    setError(null);
    setSheetMonths(null);
    void loadQcomCategorySheetMonthlySellout(category)
      .then(setSheetMonths)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load category sellout."),
      )
      .finally(() => setIsLoading(false));
  }, [category]);

  const insights = useMemo(
    () => (sheetMonths ? computeQcomCategorySelloutInsights(sheetMonths) : null),
    [sheetMonths],
  );

  const selectedMomSeries =
    momFyScope === "current"
      ? insights?.currentFyMomSeries ?? []
      : insights?.previousFyMomSeries ?? [];
  const selectedFyLabel =
    momFyScope === "current"
      ? insights
        ? `FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)}`
        : ""
      : insights
        ? `FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)}`
        : "";

  const momComparable = selectedMomSeries.filter(
    (row): row is (typeof selectedMomSeries)[number] & { pctGrowth: number } =>
      row.pctGrowth !== null,
  );
  const highestMom = momComparable.length
    ? momComparable.reduce((best, row) => (row.pctGrowth > best.pctGrowth ? row : best), momComparable[0])
    : null;
  const positiveMomMonths = momComparable.filter((row) => row.pctGrowth > 0).length;
  const latestMom = selectedMomSeries.length ? selectedMomSeries[selectedMomSeries.length - 1] : null;
  const momRangeStart = selectedMomSeries[0]?.label ?? "N/A";
  const momRangeEnd = selectedMomSeries[selectedMomSeries.length - 1]?.label ?? "N/A";
  const bestSelloutMonthFromMom = selectedMomSeries.reduce(
    (best, row) => (row.units > best.units ? row : best),
    selectedMomSeries[0] ?? { units: 0, label: "" },
  );

  const chartLegendFormatter = (value: string) => (
    <span className="text-sm font-semibold text-zinc-700">{value}</span>
  );

  const fyTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: ReadonlyArray<{
      payload?: {
        currentFy: number | null;
        previousFy: number;
        yoyGrowthPct: number | null;
        previousFyChannel?: QcomChannelUnits;
        currentFyChannel?: QcomChannelUnits;
      };
    }>;
    label?: string | number;
  }) => {
    if (!active || !payload || payload.length === 0) return null;
    const data = payload[0]?.payload;
    if (!data) return null;
    return (
      <div className="min-w-[220px] rounded-xl border-2 border-zinc-200 bg-white px-4 py-3 shadow-lg">
        <p className="border-b border-zinc-100 pb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">
          {String(label ?? "")}
        </p>
        <p className="mt-2 text-sm font-semibold text-zinc-700">
          Previous FY:{" "}
          <span className="font-extrabold tabular-nums text-zinc-950">
            {formatInteger(data.previousFy)} units
          </span>
        </p>
        {data.previousFyChannel ? (
          <p className="mt-0.5 text-xs font-semibold text-zinc-500">
            {formatQcomChannelUnitsLine(data.previousFyChannel, channelsActive)}
          </p>
        ) : null}
        <p className="mt-2 text-sm font-semibold text-zinc-700">
          Current FY:{" "}
          <span className="font-extrabold tabular-nums text-zinc-950">
            {data.currentFy === null ? "N/A" : `${formatInteger(data.currentFy)} units`}
          </span>
        </p>
        {data.currentFyChannel ? (
          <p className="mt-0.5 text-xs font-semibold text-zinc-500">
            {formatQcomChannelUnitsLine(data.currentFyChannel, channelsActive)}
          </p>
        ) : null}
        {data.yoyGrowthPct !== null ? (
          <p className="mt-2 text-sm font-semibold text-zinc-700">
            YoY growth:{" "}
            <span
              className={
                data.yoyGrowthPct >= 0 ? "font-extrabold text-emerald-600" : "font-extrabold text-rose-600"
              }
            >
              {data.yoyGrowthPct >= 0 ? "+" : ""}
              {formatDecimal(data.yoyGrowthPct)}%
            </span>
          </p>
        ) : null}
      </div>
    );
  };

  if (!category) {
    return (
      <EmptyState
        title="Unknown category"
        description="Invalid category — open from Category analysis."
      />
    );
  }

  if (isLoading) return <InlineLoader text="Loading category sellout…" />;
  if (error) return <EmptyState title="Unable to load category" description={error} />;
  if (!insights) {
    return (
      <div className="space-y-6">
        <Link
          to="/app/qcom/analysis/category"
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to categories
        </Link>
        <EmptyState
          title="No sellout history for this roll-up"
          description={
            skuCount === 0
              ? `No ${categoryLabel} listings in Product Master.`
              : `No sell-out history for ${skuCount} listing${skuCount === 1 ? "" : "s"} — re-upload the Quick Commerce master from Upload Center.`
          }
        />
      </div>
    );
  }

  const fyTitleCurrent = `FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)}`;
  const fyTitlePrev = `FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)}`;

  const momCur = insights.currentFyMomSeries;
  const latestMonthUnits = momCur.length ? momCur[momCur.length - 1].units : 0;
  const prevMonthUnits = momCur.length >= 2 ? momCur[momCur.length - 2].units : 0;
  const prevMonthShort = momCur.length >= 2 ? momCur[momCur.length - 2].shortLabel : "—";
  const avgMonthlySellout =
    insights.currentFyMonthIndex > 0 ? insights.currentFyTotal / insights.currentFyMonthIndex : 0;

  const latestMomChannel = momCur.length ? momCur[momCur.length - 1]?.channelUnits : undefined;
  const prevMomChannel = momCur.length >= 2 ? momCur[momCur.length - 2]?.channelUnits : undefined;

  return (
    <div className="space-y-8 rounded-3xl border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-white p-6 text-zinc-900 shadow-xl">
      <Link
        to="/app/qcom/analysis/category"
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to categories
      </Link>

      <div className="max-w-xs">
        <FieldLabel>Category</FieldLabel>
        <Select
          value={category}
          onChange={(e) => navigate(qcomAnalysisCategoryPath(e.target.value))}
        >
          <option value={QCOM_CATEGORY_ANALYSIS_ALL}>
            {qcomCategoryAnalysisLabel(QCOM_CATEGORY_ANALYSIS_ALL)}
          </option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            Category intelligence
          </p>
          <PageTitle
            title={`${categoryLabel} (all quick commerce channels)`}
            subtitle={`${categoryLabel} · ${skuCount} listing${skuCount === 1 ? "" : "s"}${
              anyChannelActive
                ? ` (${QCOM_MARKETPLACES.filter((ch) => channelsActive[ch])
                    .map((ch) => `${skuCountByChannel[ch]} ${marketplaceLabel(ch)}`)
                    .join(" · ")})`
                : ""
            } · combined monthly sellout roll-up from the latest master upload.`}
          />
        </div>
        {channelCoverage ? (
          <div className="min-w-0 xl:justify-self-end">
            <DataAsOnQcomChannelsBadge coverage={channelCoverage} />
          </div>
        ) : null}
      </div>

      <Card className="border-violet-200 bg-violet-50/50 text-sm font-medium text-zinc-700">
        Monthly sellout is rolled up category-wise by combining Zepto, Blinkit, Big Basket, and Instamart (current month uses MTD).
      </Card>

      {QCOM_MARKETPLACES.some((ch) => !channelsActive[ch]) ? (
        <Card className="border-amber-300 bg-amber-50/80 p-4 text-sm text-amber-950">
          <p className="font-bold">Channel coverage</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {QCOM_MARKETPLACES.filter((ch) => !channelsActive[ch]).map((ch) => (
              <li key={ch}>
                <strong>{marketplaceLabel(ch)}</strong> — no completed master upload yet. Upload the
                Quick Commerce workbook from Upload Center to include this channel.
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {sheetMonths && sheetMonths.monthlyCombined.size > 0 ? (
        <Card className="border border-zinc-200 bg-white p-5 text-sm leading-relaxed text-zinc-700">
          <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
            Data used ({categoryLabel})
          </h3>
          <p className="mt-2">
            MoM and FY charts sum daily sellout ingested from the master for every listing in this
            category. Current month uses the sheet <strong>MTD</strong> column when the report month is
            still in progress.
          </p>
          <p className="mt-2 text-xs font-medium text-zinc-600">
            Listings in roll-up:{" "}
            {QCOM_MARKETPLACES.filter((ch) => channelsActive[ch]).map((ch, i) => (
              <span key={ch}>
                {i > 0 ? " · " : null}
                <strong className="text-zinc-900">{skuCountByChannel[ch]}</strong> {marketplaceLabel(ch)}
              </span>
            ))}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label={`${fyTitlePrev} total SO`}
          value={formatInteger(insights.previousFyTotal)}
          variant="violet"
          hint={
            insights.previousFyTotalChannel
              ? formatQcomChannelUnitsLine(insights.previousFyTotalChannel, channelsActive)
              : undefined
          }
        />
        <StatCard
          label={`${fyTitleCurrent} total SO (till date)`}
          value={formatInteger(insights.currentFyTotal)}
          variant="violet"
          hint={
            [
              insights.currentFyTotalChannel
                ? formatQcomChannelUnitsLine(insights.currentFyTotalChannel, channelsActive)
                : null,
              `Current FY month: ${insights.currentFyMonthIndex} of 12`,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        />
        <StatCard
          label={`Current month MTD (${insights.currentMonthLabel})`}
          value={formatInteger(latestMonthUnits)}
          variant="emerald"
          hint={
            latestMomChannel
              ? formatQcomChannelUnitsLine(latestMomChannel, channelsActive)
              : undefined
          }
        />
        <StatCard
          label={`Previous month SO (${prevMonthShort})`}
          value={formatInteger(prevMonthUnits)}
          variant="amber"
          hint={
            prevMomChannel
              ? formatQcomChannelUnitsLine(prevMomChannel, channelsActive)
              : undefined
          }
        />
        <StatCard
          label="Average monthly SO (till date)"
          value={formatInteger(Math.round(avgMonthlySellout))}
          variant="sky"
        />
      </div>

      <CategoryAggregateSummaryCard
        pct={insights.fyAttainmentVsPriorFullFyPct}
        tillLabel={`Till ${insights.currentMonthLabel} ${insights.currentFyStart + (insights.currentFyMonthIndex >= 10 ? 1 : 0)}`}
        previousFyRangeLabel={fyTitlePrev}
        previousFyTotalUnits={insights.previousFyTotal}
        previousFyTotalChannel={insights.previousFyTotalChannel}
        currentYtdUnits={insights.currentFyTotal}
        currentYtdChannel={insights.currentFyTotalChannel}
        channelsActive={channelsActive}
      />

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-zinc-900">Financial Year Sellout Trend</h3>
            <p className="mt-1 text-sm font-medium text-zinc-500">
              Monthly sellout — current FY vs prior FY. Current month point is{" "}
              <strong>MTD (ongoing)</strong>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-zinc-700">
              Units
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold text-zinc-800">
              <CalendarDays className="h-3.5 w-3.5" />
              {fyTitleCurrent}
            </span>
          </div>
        </div>
        <div className="h-[380px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={insights.trendData}>
              <defs>
                <linearGradient id="catCurrentFyArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CURRENT_FY_COLOR} stopOpacity={0.26} />
                  <stop offset="95%" stopColor={CURRENT_FY_COLOR} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip content={fyTooltip} />
              <Legend formatter={chartLegendFormatter} wrapperStyle={CHART_LEGEND_STYLE} />
              <Area
                type="natural"
                dataKey="currentFyDisplay"
                name={`Current FY ${fyTitleCurrent}`}
                stroke="none"
                fill="url(#catCurrentFyArea)"
                legendType="none"
              />
              <Line
                type="natural"
                dataKey="previousFy"
                name={`Previous FY ${fyTitlePrev}`}
                stroke={PREVIOUS_FY_COLOR}
                strokeDasharray="5 5"
                strokeWidth={2.2}
                dot={{ r: 3, fill: PREVIOUS_FY_COLOR, stroke: "#ffffff", strokeWidth: 1.2 }}
              />
              <Line
                type="natural"
                dataKey="currentFy"
                name={`Current FY ${fyTitleCurrent}`}
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
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1">
              <h3 className="text-lg font-bold tracking-tight text-zinc-900">
                Month on month growth (category total)
              </h3>
              <CircleHelp className="h-5 w-5 text-zinc-500" />
            </div>
            <p className="mt-1 text-sm font-medium text-zinc-500">
              Completed months: daily sellout summed by calendar month. Current month:{" "}
              <strong>MTD (ongoing)</strong> from the report&apos;s MTD column on your latest upload.
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
              {momRangeStart}–{momRangeEnd} · {selectedFyLabel}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-0.5">
              <button
                type="button"
                onClick={() => setMomFyScope("current")}
                className={`rounded px-3 py-1.5 text-xs font-bold transition ${
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
                className={`rounded px-3 py-1.5 text-xs font-bold transition ${
                  momFyScope === "previous"
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                Previous FY
              </button>
            </div>
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold text-zinc-800">
              {selectedFyLabel}
            </span>
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-zinc-700">
              Units
            </span>
          </div>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MiniInsightCard
            label={
              latestMom?.isMtdOngoing && momFyScope === "current"
                ? `Latest month (MTD ongoing)`
                : "Latest month"
            }
            value={formatInteger(Number(latestMom?.units ?? 0))}
            sub={
              latestMom?.pctGrowth !== null && latestMom?.pctGrowth !== undefined
                ? `MoM ${formatDecimal(latestMom.pctGrowth)}%`
                : "No previous month"
            }
            icon={<TrendingUp className="h-4 w-4 text-violet-500" />}
          />
          <MiniInsightCard
            label="Highest MoM %"
            value={highestMom ? `${highestMom.pctGrowth >= 0 ? "+" : ""}${formatDecimal(highestMom.pctGrowth)}%` : "N/A"}
            sub={highestMom?.label ?? "N/A"}
            positive={highestMom ? highestMom.pctGrowth >= 0 : undefined}
          />
          <MiniInsightCard
            label="Peak units (range)"
            value={formatInteger(bestSelloutMonthFromMom.units)}
            sub={bestSelloutMonthFromMom.label}
            icon={<Sparkles className="h-4 w-4 text-amber-500" />}
          />
          <MiniInsightCard
            label="Positive MoM months"
            value={`${positiveMomMonths} / ${momComparable.length}`}
            sub="Months"
            icon={<TrendingDown className="h-4 w-4 text-fuchsia-500" />}
          />
        </div>

        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={selectedMomSeries}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="monthYearLabel"
                tick={{ ...CHART_AXIS_TICK, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <YAxis yAxisId="left" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
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
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const row = payload[0]?.payload as
                    | {
                        units?: number;
                        channelUnits?: QcomChannelUnits;
                        pctGrowth?: number | null;
                        trendScore?: number;
                        isMtdOngoing?: boolean;
                      }
                    | undefined;
                  if (!row) return null;
                  return (
                    <div className="min-w-[220px] rounded-xl border-2 border-zinc-200 bg-white px-4 py-3 shadow-lg">
                      <p className="border-b border-zinc-100 pb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">
                        {String(label ?? "")}
                        {row.isMtdOngoing ? (
                          <span className="ml-1 font-semibold normal-case text-violet-600">
                            · MTD (ongoing)
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-zinc-700">
                        Units:{" "}
                        <span className="font-extrabold tabular-nums text-zinc-950">
                          {formatInteger(Number(row.units ?? 0))}
                        </span>
                        {row.channelUnits && anyChannelActive ? (
                          <QcomChannelUnitsInline
                            units={row.channelUnits}
                            channelsActive={channelsActive}
                          />
                        ) : null}
                      </p>
                      {row.pctGrowth !== null && row.pctGrowth !== undefined ? (
                        <p className="mt-1 text-sm font-semibold text-zinc-700">
                          MoM growth:{" "}
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
                          {formatDecimal(Number(row.trendScore ?? 0))}%
                        </span>
                      </p>
                    </div>
                  );
                }}
              />
              <Legend formatter={chartLegendFormatter} wrapperStyle={CHART_LEGEND_STYLE} />
              <Bar yAxisId="left" dataKey="units" name="Units (category)" radius={[6, 6, 0, 0]}>
                {selectedMomSeries.map((row) => (
                  <Cell key={`mom-${row.label}`} fill={row.barColor} />
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
      </Card>
    </div>
  );
}

function CategoryAggregateSummaryCard({
  pct,
  tillLabel,
  previousFyRangeLabel,
  previousFyTotalUnits,
  previousFyTotalChannel,
  currentYtdUnits,
  currentYtdChannel,
  channelsActive,
}: {
  pct: number | null;
  tillLabel: string;
  previousFyRangeLabel: string;
  previousFyTotalUnits: number;
  previousFyTotalChannel: QcomChannelUnits | null;
  currentYtdUnits: number;
  currentYtdChannel: QcomChannelUnits | null;
  channelsActive: Record<QcomMarketplace, boolean>;
}) {
  return (
    <div className="rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-100/90 via-white to-violet-50/50 px-5 py-5 shadow-md ring-1 ring-violet-200/60">
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-900">
        FY vs prior full year (category)
      </p>
      <div className="mt-5 space-y-4 border-t-2 border-violet-200/80 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-zinc-900">Prior FY total</p>
            <p className="mt-0.5 text-sm font-semibold text-zinc-600">{previousFyRangeLabel}</p>
          </div>
          <div className="text-right">
            <span className="block text-lg font-extrabold tabular-nums text-zinc-950">
              {formatInteger(previousFyTotalUnits)} units
            </span>
            {previousFyTotalChannel ? (
              <span className="mt-1 block text-xs font-semibold text-zinc-600">
                {formatQcomChannelUnitsLine(previousFyTotalChannel, channelsActive)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="border-t border-violet-200/60 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 gap-y-1">
            <span className="text-base font-bold text-zinc-900">Current FY YTD</span>
            <div className="text-right">
              <span className="block text-lg font-extrabold tabular-nums text-zinc-950">
                {formatInteger(currentYtdUnits)} units
              </span>
              {currentYtdChannel ? (
                <span className="mt-1 block text-xs font-semibold text-zinc-600">
                  {formatQcomChannelUnitsLine(currentYtdChannel, channelsActive)}
                </span>
              ) : null}
            </div>
          </div>
          <p className="mt-2 text-sm font-medium text-zinc-600">{tillLabel}</p>
        </div>
        <p className="text-lg font-extrabold leading-snug text-zinc-950">
          {pct !== null ? (
            <>
              YTD at{" "}
              <span className="text-violet-800 tabular-nums">{formatDecimal(pct)}%</span> of prior FY category
              units.
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
}: {
  label: string;
  value: string;
  sub: string;
  icon?: ReactNode;
  positive?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide leading-tight text-zinc-700">{label}</p>
        {icon}
      </div>
      <p
        className={cn(
          "text-2xl font-extrabold tabular-nums leading-tight",
          positive === undefined ? "text-zinc-900" : positive ? "text-emerald-600" : "text-rose-600",
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-xs font-semibold text-zinc-600">{sub}</p>
    </div>
  );
}
