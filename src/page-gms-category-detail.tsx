import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { ArrowLeft, CalendarDays, Clock } from "lucide-react";
import {
  GmsFormulaPill,
  GmsInsightsPanel,
  GmsKpiCard,
  GmsMiniStat,
  GmsPageFooter,
} from "./gms-category-detail-ui";
import {
  type CategorySheetMonthlySellout,
} from "./category-sellout-insights";
import { computeCategoryGmsInsights } from "./gms-insights";
import {
  analysisCategoryLabel,
  analysisSubCategoryLabel,
} from "./analysis-category-paths";
import { useCatalogScope } from "./catalog-scope-context";
import { useDataScope } from "./use-data-scope";
import {
  loadCategoryGmsMonthlySellout,
  loadCategoryGmsMonthlySelloutBySheetSelection,
} from "./data-gms";
import {
  SheetCategorySubCategoryFilters,
  parseSheetCategorySubCategoryFromSearchParams,
  sheetCategorySubCategoryQueryParams,
  useSheetCategorySubCategoryFilterState,
} from "./sheet-category-subcategory-filters";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_LEGEND_STYLE } from "./chart-theme";
import { Card, EmptyState, InlineLoader } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";
import {
  formatCoverageDataAsOf,
  formatDecimal,
  formatGmsAxisTick,
  formatGmsCr,
} from "./utils";

const CURRENT_FY_COLOR = "#4f46e5";
const PREVIOUS_FY_COLOR = "#94a3b8";
const AXIS_TICK = CHART_AXIS_TICK;

export function GmsCategoryDetailPage() {
  const { workspace, parseSubCategoryFilter, routePrefix } = useCatalogScope();
  const dataScope = useDataScope();
  const params = useParams<{ subCategory: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isChartsRoute =
    params.subCategory === "charts" ||
    location.pathname.replace(/\/$/, "").endsWith("/gms/category/charts");
  const legacyRollupKey = !isChartsRoute ? parseSubCategoryFilter(params.subCategory) : null;
  const navigate = useNavigate();
  const queryInit = parseSheetCategorySubCategoryFromSearchParams(searchParams);
  const filterState = useSheetCategorySubCategoryFilterState(
    workspace,
    dataScope,
    queryInit.categorySegment,
    queryInit.subCategory,
  );
  const { categoryRaw, subCategory } = filterState;
  const scopeTitle = `${analysisCategoryLabel(categoryRaw)} · ${analysisSubCategoryLabel(subCategory)}`;

  const [sheetMonths, setSheetMonths] = useState<CategorySheetMonthlySellout | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [momFyScope, setMomFyScope] = useState<"current" | "previous">("current");

  const skuCountAmazon = sheetMonths?.skuCountAmazon ?? 0;
  const skuCountFlipkart = sheetMonths?.skuCountFlipkart ?? 0;
  const skuCount = sheetMonths?.skuCount ?? 0;
  const channelsActive = sheetMonths?.channelsActive ?? { amazon: false, flipkart: false };
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setSheetMonths(null);
    const loadPromise =
      legacyRollupKey && !isChartsRoute
        ? loadCategoryGmsMonthlySellout(legacyRollupKey, workspace)
        : loadCategoryGmsMonthlySelloutBySheetSelection(
            categoryRaw,
            subCategory,
            workspace,
            dataScope,
          );
    void loadPromise
      .then(setSheetMonths)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load category GMS."),
      )
      .finally(() => setIsLoading(false));
  }, [
    legacyRollupKey,
    isChartsRoute,
    categoryRaw,
    subCategory,
    workspace,
    dataScope,
  ]);

  const insights = useMemo(
    () => (sheetMonths ? computeCategoryGmsInsights(sheetMonths) : null),
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
  const bestGmsMonthFromMom = selectedMomSeries.reduce(
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
        previousFyChannel?: { amazon: number; flipkart: number };
        currentFyChannel?: { amazon: number; flipkart: number };
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
            {formatGmsCr(data.previousFy)}
          </span>
        </p>
        {data.previousFyChannel ? (
          <p className="mt-0.5 text-xs font-semibold text-zinc-500">
            <span className="tabular-nums">{formatGmsCr(data.previousFyChannel.amazon)}</span> Amazon Â·{" "}
            <span className="tabular-nums">{formatGmsCr(data.previousFyChannel.flipkart)}</span> Flipkart
          </p>
        ) : null}
        <p className="mt-2 text-sm font-semibold text-zinc-700">
          Current FY:{" "}
          <span className="font-extrabold tabular-nums text-zinc-950">
            {data.currentFy === null ? "N/A" : formatGmsCr(data.currentFy)}
          </span>
        </p>
        {data.currentFyChannel ? (
          <p className="mt-0.5 text-xs font-semibold text-zinc-500">
            <span className="tabular-nums">{formatGmsCr(data.currentFyChannel.amazon)}</span> Amazon Â·{" "}
            <span className="tabular-nums">{formatGmsCr(data.currentFyChannel.flipkart)}</span> Flipkart
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

  if (!isChartsRoute && !legacyRollupKey) {
    return (
      <EmptyState
        title="Unknown category"
        description="Open GMS charts from GMS Tracker with Category and Sub category selected."
      />
    );
  }

  if (isLoading) return <InlineLoader text="Loading category GMS…" />;
  if (error) return <EmptyState title="Unable to load category" description={error} />;
  if (!insights) {
    return (
      <div className="space-y-6">
        <Link
          to={`${routePrefix}/gms/category`}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to categories
        </Link>
        <EmptyState
          title="No GMS history for this roll-up"
          description={
            skuCount === 0
              ? `No listings for ${scopeTitle} in Product Master.`
              : `No sell-out history for ${skuCount} listing${skuCount === 1 ? "" : "s"} — upload from Upload Center.`
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
  const prevMonthShort = momCur.length >= 2 ? momCur[momCur.length - 2].shortLabel : "â€”";
  const avgMonthlyGms =
    insights.currentFyMonthIndex > 0 ? insights.currentFyTotal / insights.currentFyMonthIndex : 0;

  const latestMomChannel = momCur.length ? momCur[momCur.length - 1]?.channelUnits : undefined;
  const prevMomChannel = momCur.length >= 2 ? momCur[momCur.length - 2]?.channelUnits : undefined;

  const mtdMomPct =
    prevMonthUnits > 0 ? ((latestMonthUnits - prevMonthUnits) / prevMonthUnits) * 100 : null;
  const priorFyYtd = insights.fyLine
    .slice(0, insights.currentFyMonthIndex)
    .reduce((sum, row) => sum + row.previousFy, 0);
  const ytdVsPriorYtdPct =
    priorFyYtd > 0 ? ((insights.currentFyTotal - priorFyYtd) / priorFyYtd) * 100 : null;
  const avgAmazonGms =
    insights.currentFyMonthIndex > 0 && insights.currentFyTotalChannel
      ? insights.currentFyTotalChannel.amazon / insights.currentFyMonthIndex
      : 0;
  const avgFlipkartGms =
    insights.currentFyMonthIndex > 0 && insights.currentFyTotalChannel
      ? insights.currentFyTotalChannel.flipkart / insights.currentFyMonthIndex
      : 0;
  const amazonSharePct =
    latestMomChannel && latestMonthUnits > 0
      ? Math.round((latestMomChannel.amazon / latestMonthUnits) * 100)
      : null;
  const latestCoverage = [channelCoverage?.amazon, channelCoverage?.flipkart]
    .filter(Boolean)
    .sort((a, b) => String(b).localeCompare(String(a)))[0];

  const insightItems: Array<{ tone: "down" | "up" | "neutral"; text: ReactNode }> = [];
  if (mtdMomPct !== null && latestMom?.isMtdOngoing) {
    insightItems.push({
      tone: mtdMomPct >= 0 ? "up" : "down",
      text: (
        <>
          Current month ({insights.currentMonthLabel} MTD) GMS is{" "}
          <strong>{formatDecimal(Math.abs(mtdMomPct))}%</strong>{" "}
          {mtdMomPct >= 0 ? "higher" : "lower"} than {prevMonthShort}.
        </>
      ),
    });
  }
  if (amazonSharePct !== null && channelsActive.amazon) {
    insightItems.push({
      tone: "neutral",
      text: (
        <>
          Amazon contributes <strong>{amazonSharePct}%</strong> of total GMS this month.
        </>
      ),
    });
  }
  if (ytdVsPriorYtdPct !== null) {
    insightItems.push({
      tone: ytdVsPriorYtdPct >= 0 ? "up" : "down",
      text: (
        <>
          Current FY YTD GMS is <strong>{formatDecimal(Math.abs(ytdVsPriorYtdPct))}%</strong>{" "}
          {ytdVsPriorYtdPct >= 0 ? "higher" : "lower"} than the same period last FY.
        </>
      ),
    });
  }

  const yAxisTick = { ...AXIS_TICK, tickFormatter: (v: number) => formatGmsAxisTick(Number(v)) };

  return (
    <div className="gms-category-page mx-auto max-w-[1400px] space-y-6 px-1 pb-8 text-zinc-900 sm:px-2">
      <Link
        to={`${routePrefix}/gms/category`}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to categories
      </Link>

      <SheetCategorySubCategoryFilters
        catalogWorkspace={workspace}
        dataScope={dataScope}
        initialCategorySegment={queryInit.categorySegment}
        initialSubCategory={queryInit.subCategory}
        filterState={filterState}
        showApplyButton
        applyLabel="Apply & refresh charts"
        onApply={(cat, sub) => {
          const query = sheetCategorySubCategoryQueryParams(cat, sub);
          navigate(
            {
              pathname: location.pathname,
              search: query ? `?${query}` : "",
            },
            { replace: true },
          );
        }}
      />

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-600">GMS Tracker</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-950 sm:text-4xl">
            {scopeTitle}{" "}
            <span className="font-bold text-zinc-500">(Amazon + Flipkart)</span>
          </h1>
          <p className="text-sm font-medium text-zinc-600">
            {skuCount} listing{skuCount === 1 ? "" : "s"}
            {channelsActive.amazon || channelsActive.flipkart
              ? ` · ${channelsActive.amazon ? `${skuCountAmazon} Amazon` : ""}${
                  channelsActive.amazon && channelsActive.flipkart ? " · " : ""
                }${channelsActive.flipkart ? `${skuCountFlipkart} Flipkart` : ""}`
              : ""}
          </p>
          <p className="text-xs font-medium text-zinc-500">
            GMS = BAU Ã— SO Ã· 1.18 from sellout uploads + BAU benchmark
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
          {channelCoverage ? (
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {channelCoverage.amazon ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-800 shadow-sm">
                  <Clock className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
                  Amazon: {formatCoverageDataAsOf(channelCoverage.amazon)}
                </span>
              ) : null}
              {channelCoverage.flipkart ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-800 shadow-sm">
                  <Clock className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
                  Flipkart: {formatCoverageDataAsOf(channelCoverage.flipkart)}
                </span>
              ) : null}
            </div>
          ) : null}
          <GmsFormulaPill className="sm:ml-auto" />
        </div>
      </div>

      {!channelsActive.amazon || !channelsActive.flipkart ? (
        <Card className="border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950">
          <p className="font-bold">Channel coverage</p>
          <p className="mt-1 font-medium">
            {!channelsActive.amazon ? "Upload Amazon sellout for Amazon GMS. " : ""}
            {!channelsActive.flipkart ? "Upload Flipkart sellout for Flipkart GMS." : ""}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        <GmsKpiCard
          accent="emerald"
          label="Current Month (MTD) GMS"
          value={formatGmsCr(latestMonthUnits)}
          channelSplit={
            latestMomChannel
              ? { ch: latestMomChannel, channels: channelsActive, showPct: true }
              : undefined
          }
          trend={
            mtdMomPct !== null
              ? { pct: mtdMomPct, label: `vs ${prevMonthShort} ${insights.currentFyStart}` }
              : undefined
          }
        />
        <GmsKpiCard
          accent="amber"
          label={`Previous Month (${prevMonthShort}) GMS`}
          value={formatGmsCr(prevMonthUnits)}
          channelSplit={
            prevMomChannel ? { ch: prevMomChannel, channels: channelsActive } : undefined
          }
        />
        <GmsKpiCard
          accent="violet"
          label={`${fyTitleCurrent} (YTD)`}
          value={formatGmsCr(insights.currentFyTotal)}
          channelSplit={
            insights.currentFyTotalChannel
              ? {
                  ch: insights.currentFyTotalChannel,
                  channels: channelsActive,
                  showPct: true,
                }
              : undefined
          }
          trend={
            ytdVsPriorYtdPct !== null
              ? { pct: ytdVsPriorYtdPct, label: `vs ${fyTitlePrev} YTD` }
              : undefined
          }
        />
        <GmsKpiCard
          accent="violet"
          label={`${fyTitlePrev} (Total)`}
          value={formatGmsCr(insights.previousFyTotal)}
          channelSplit={
            insights.previousFyTotalChannel
              ? { ch: insights.previousFyTotalChannel, channels: channelsActive }
              : undefined
          }
        />
        <GmsKpiCard
          accent="sky"
          label="Average Monthly GMS"
          value={formatGmsCr(Math.round(avgMonthlyGms))}
          channelSplit={
            insights.currentFyTotalChannel && insights.currentFyMonthIndex > 0
              ? {
                  ch: { amazon: avgAmazonGms, flipkart: avgFlipkartGms },
                  channels: channelsActive,
                }
              : undefined
          }
        />
      </div>

      <Card className="p-6" id="gms-fy-trend">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-zinc-900">Financial Year GMS Trend</h3>
            <p className="mt-1 text-sm font-medium text-zinc-500">
              Monthly GMS (INR) â€” current FY vs prior FY. Current month point is{" "}
              <strong>MTD (ongoing)</strong>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-zinc-700">
              GMS (INR)
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm">
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
              <YAxis tick={yAxisTick} tickLine={false} axisLine={false} width={56} />
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
            <h3 className="text-lg font-bold tracking-tight text-zinc-900">
              Month on month growth (category total)
            </h3>
            <p className="mt-1 text-sm font-medium text-zinc-500">
              Completed months: BAU × sellout month column ÷ 1.18 (Flipkart uses event pricing Fri–Sun).
              Amazon GMS (all months): official values from <strong>GMS_AVS</strong> only; Flipkart: DRR × price ÷
              1.18.
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
              {momRangeStart}â€“{momRangeEnd} Â· {selectedFyLabel}
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
            <span className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm">
              {selectedFyLabel}
            </span>
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-zinc-700">
              GMS (INR)
            </span>
          </div>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <GmsMiniStat
            label={
              latestMom?.isMtdOngoing && momFyScope === "current"
                ? "Latest month GMS (MTD ongoing)"
                : "Latest month GMS"
            }
            value={formatGmsCr(Number(latestMom?.units ?? 0))}
            sub={
              latestMom?.pctGrowth != null
                ? `MoM ${latestMom.pctGrowth >= 0 ? "+" : ""}${formatDecimal(latestMom.pctGrowth)}%`
                : "No previous month"
            }
            valueClassName={
              latestMom?.pctGrowth != null && latestMom.pctGrowth < 0 ? "text-rose-600" : undefined
            }
          />
          <GmsMiniStat
            label="Highest MoM %"
            value={
              highestMom
                ? `${highestMom.pctGrowth >= 0 ? "+" : ""}${formatDecimal(highestMom.pctGrowth)}%`
                : "N/A"
            }
            sub={highestMom?.label ?? "N/A"}
          />
          <GmsMiniStat
            label="Peak GMS (range)"
            value={formatGmsCr(bestGmsMonthFromMom.units)}
            sub={bestGmsMonthFromMom.label}
          />
          <GmsMiniStat
            label="Positive MoM months"
            value={`${positiveMomMonths} / ${momComparable.length}`}
            sub="Months"
          />
        </div>

        <div className="space-y-6">
          <div className="h-[420px] w-full min-w-0 sm:h-[460px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={selectedMomSeries}
              margin={{ top: 12, right: 12, left: 4, bottom: 4 }}
            >
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="monthYearLabel"
                tick={{ ...CHART_AXIS_TICK, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval={0}
                angle={-42}
                textAnchor="end"
                height={72}
              />
              <YAxis yAxisId="left" tick={yAxisTick} tickLine={false} axisLine={false} width={56} />
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
                        channelUnits?: { amazon: number; flipkart: number };
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
                            Â· MTD (ongoing)
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-zinc-700">
                        GMS:{" "}
                        <span className="font-extrabold tabular-nums text-zinc-950">
                          {formatGmsCr(Number(row.units ?? 0))}
                        </span>
                        {row.channelUnits &&
                        (channelsActive.amazon || channelsActive.flipkart) ? (
                          <span className="font-semibold text-zinc-600">
                            {" "}
                            (
                            {channelsActive.amazon ? (
                              <>
                                <span className="tabular-nums">
                                  {formatGmsCr(row.channelUnits.amazon)}
                                </span>
                                {" Amazon"}
                              </>
                            ) : null}
                            {channelsActive.amazon && channelsActive.flipkart ? " Â· " : null}
                            {channelsActive.flipkart ? (
                              <>
                                <span className="tabular-nums">
                                  {formatGmsCr(row.channelUnits.flipkart)}
                                </span>
                                {" Flipkart"}
                              </>
                            ) : null}
                            )
                          </span>
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
              <Bar yAxisId="left" dataKey="units" name="GMS (category)" radius={[6, 6, 0, 0]}>
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
          {insightItems.length > 0 ? (
            <GmsInsightsPanel
              items={insightItems}
              onViewReport={() => {
                document.getElementById("gms-fy-trend")?.scrollIntoView({ behavior: "smooth" });
              }}
            />
          ) : null}
        </div>
      </Card>

      <GmsPageFooter
        sourceLabel="Sellout Uploads · BAU Benchmark"
        updatedLabel={latestCoverage ? formatCoverageDataAsOf(latestCoverage) : "—"}
      />
    </div>
  );
}
