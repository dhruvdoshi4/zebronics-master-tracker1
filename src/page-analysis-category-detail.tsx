import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  computeCategorySelloutInsights,
  type CategorySheetMonthlySellout,
} from "./category-sellout-insights";
import {
  analysisCategoryDetailPath,
  analysisCategoryFromUrlSegment,
  analysisCategoryLabel,
  analysisCategoryToUrlSegment,
  analysisSubCategoryFromUrlValue,
  analysisSubCategoryLabel,
  ANALYSIS_SUB_CATEGORY_ALL,
} from "./analysis-category-paths";
import {
  migrateLegacyDawgAnalysisUrlSegment,
  migrateLegacyMonitorAnalysisUrlSegment,
} from "./analysis-category-filters";
import { CategorySubCategoryFilterControls } from "./category-subcategory-filter-controls";
import { useCatalogScope } from "./catalog-scope-context";
import { loadCategorySheetMonthlySellout } from "./data";
import { isDawgDataScope } from "./data-scope";
import { useDataScope } from "./use-data-scope";
import { useAnalysisCategoryFilters } from "./use-analysis-category-filters";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_LEGEND_STYLE } from "./chart-theme";
import {
  Card,
  DataAsOnDualChannelBadge,
  EmptyState,
  InlineLoader,
  PageTitle,
  StatCard,
} from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";
import { cn, formatDecimal, formatInteger } from "./utils";

const CURRENT_FY_COLOR = "#4f46e5";
const PREVIOUS_FY_COLOR = "#94a3b8";
const AXIS_TICK = CHART_AXIS_TICK;

export function AnalysisCategoryDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { workspace, routePrefix } = useCatalogScope();
  const dataScope = useDataScope();
  const isDawg = isDawgDataScope(dataScope);
  const params = useParams<{ category: string }>();
  const categorySegment = params.category ?? "";
  const subFromUrl = searchParams.get("sub") ?? ANALYSIS_SUB_CATEGORY_ALL;

  const {
    loading: filtersLoading,
    categoryRaw,
    setCategoryRaw,
    categorySegment: activeSegment,
    subCategory,
    setSubCategory,
    categoryOptions,
    subCategoryOptions,
    showSubCategory,
  } = useAnalysisCategoryFilters(
    workspace,
    dataScope,
    categorySegment,
    analysisSubCategoryFromUrlValue(subFromUrl),
  );

  const [sheetMonths, setSheetMonths] = useState<CategorySheetMonthlySellout | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [momFyScope, setMomFyScope] = useState<"current" | "previous">("current");

  const skuCountAmazon = sheetMonths?.skuCountAmazon ?? 0;
  const skuCountFlipkart = sheetMonths?.skuCountFlipkart ?? 0;
  const skuCount = sheetMonths?.skuCount ?? 0;
  const channelsActive = sheetMonths?.channelsActive ?? { amazon: false, flipkart: false };
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

  const rollUpTitle = showSubCategory
    ? `${analysisCategoryLabel(categoryRaw)} · ${analysisSubCategoryLabel(subCategory)}`
    : analysisCategoryLabel(categoryRaw);

  useEffect(() => {
    if (!categorySegment || searchParams.has("sub")) return;
    const dawgLegacy = isDawg ? migrateLegacyDawgAnalysisUrlSegment(categorySegment) : null;
    const monitorLegacy = !isDawg
      ? migrateLegacyMonitorAnalysisUrlSegment(categorySegment)
      : null;
    const legacy = dawgLegacy ?? monitorLegacy;
    if (!legacy) return;
    navigate(
      analysisCategoryDetailPath(
        routePrefix,
        analysisCategoryToUrlSegment(legacy.category),
        legacy.subCategory,
      ),
      { replace: true },
    );
  }, [categorySegment, searchParams, navigate, routePrefix, isDawg]);

  useEffect(() => {
    if (!categorySegment || filtersLoading) return;
    setIsLoading(true);
    setError(null);
    setSheetMonths(null);
    void loadCategorySheetMonthlySellout(
      categoryRaw,
      subCategory,
      workspace,
      dataScope,
    )
      .then(setSheetMonths)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load category sellout."),
      )
      .finally(() => setIsLoading(false));
  }, [categoryRaw, subCategory, workspace, dataScope, categorySegment, filtersLoading]);

  const navigateToSelection = (nextCategoryRaw: string, nextSub: string) => {
    const seg = analysisCategoryToUrlSegment(nextCategoryRaw);
    const path = analysisCategoryDetailPath(routePrefix, seg, nextSub);
    navigate(path);
  };

  const insights = useMemo(
    () => (sheetMonths ? computeCategorySelloutInsights(sheetMonths) : null),
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
            {formatInteger(data.previousFy)} units
          </span>
        </p>
        {data.previousFyChannel ? (
          <p className="mt-0.5 text-xs font-semibold text-zinc-500">
            <span className="tabular-nums">{formatInteger(data.previousFyChannel.amazon)}</span> Amazon ·{" "}
            <span className="tabular-nums">{formatInteger(data.previousFyChannel.flipkart)}</span> Flipkart
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
            <span className="tabular-nums">{formatInteger(data.currentFyChannel.amazon)}</span> Amazon ·{" "}
            <span className="tabular-nums">{formatInteger(data.currentFyChannel.flipkart)}</span> Flipkart
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

  if (!categorySegment || !analysisCategoryFromUrlSegment(categorySegment)) {
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
          to={`${routePrefix}/analysis/category`}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Category analysis
        </Link>
        <EmptyState
          title="No sellout history for this roll-up"
          description={
            skuCount === 0
              ? `No ${rollUpTitle} listings in Product Master.`
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
  const prevMonthShort = momCur.length >= 2 ? momCur[momCur.length - 2].shortLabel : "—";
  const avgMonthlySellout =
    insights.currentFyMonthIndex > 0 ? insights.currentFyTotal / insights.currentFyMonthIndex : 0;

  const latestMomChannel = momCur.length ? momCur[momCur.length - 1]?.channelUnits : undefined;
  const prevMomChannel = momCur.length >= 2 ? momCur[momCur.length - 2]?.channelUnits : undefined;

  return (
    <div className="space-y-8 rounded-3xl border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-white p-6 text-zinc-900 shadow-xl">
      <Link
        to={`${routePrefix}/analysis/category`}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Category analysis
      </Link>

      <CategorySubCategoryFilterControls
        category={activeSegment}
        categories={categoryOptions.map((o) => o.segment)}
        categoryLabels={Object.fromEntries(
          categoryOptions.map((o) => [o.segment, o.label]),
        )}
        onCategoryChange={(segment) => {
          const picked = categoryOptions.find((o) => o.segment === segment);
          const nextRaw = picked?.raw ?? analysisCategoryFromUrlSegment(segment);
          setCategoryRaw(nextRaw);
          navigateToSelection(nextRaw, ANALYSIS_SUB_CATEGORY_ALL);
        }}
        subCategory={subCategory}
        subCategoryOptions={subCategoryOptions.map((o) => o.value)}
        onSubCategoryChange={(nextSub) => {
          setSubCategory(nextSub);
          navigateToSelection(categoryRaw, nextSub);
        }}
        showSubCategory={showSubCategory}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            Category intelligence
          </p>
          <PageTitle
            title={`${rollUpTitle} (Amazon + Flipkart)`}
            subtitle={`${rollUpTitle} · ${skuCount} listing${skuCount === 1 ? "" : "s"}${
              channelsActive.amazon || channelsActive.flipkart
                ? ` (${channelsActive.amazon ? `${skuCountAmazon} Amazon` : ""}${
                    channelsActive.amazon && channelsActive.flipkart ? " · " : ""
                  }${channelsActive.flipkart ? `${skuCountFlipkart} Flipkart` : ""})`
                : ""
            } · monthly sellout from sheet columns (Apr-25, May-25, …).`}
          />
        </div>
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      <Card className="border-violet-200 bg-violet-50/50 text-sm font-medium text-zinc-700">
        Completed months use the sheet month column (e.g. <strong>Apr-25</strong>,{" "}
        <strong>May-25</strong>). The <strong>current month</strong> bar uses{" "}
        <strong>MTD (ongoing)</strong> — the <strong>May MTD</strong> cell on your latest upload, not
        a full-month column. Amazon + Flipkart are combined when both are uploaded.
      </Card>

      {!channelsActive.amazon || !channelsActive.flipkart ? (
        <Card className="border-amber-300 bg-amber-50/80 p-4 text-sm text-amber-950">
          <p className="font-bold">Channel coverage</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {!channelsActive.amazon ? (
              <li>
                <strong>Amazon</strong> — no sellout file in Upload Center. Amazon bars/splits are hidden;
                any older Amazon rows in the database are ignored so you are not shown fake Amazon totals.
              </li>
            ) : null}
            {!channelsActive.flipkart ? (
              <li>
                <strong>Flipkart</strong> — no sellout file uploaded yet. Upload the Flipkart master to see
                Flipkart on this chart.
              </li>
            ) : null}
            {channelsActive.flipkart && !channelsActive.amazon ? (
              <li>
                MoM months like <strong>Apr 25</strong> use the sheet column <strong>Apr-25</strong> (Event SO).
                Re-upload Flipkart after app updates so totals match Excel (e.g. projectors Apr-25 = 991).
              </li>
            ) : null}
          </ul>
        </Card>
      ) : null}

      {sheetMonths && sheetMonths.monthlyCombined.size > 0 ? (
        <Card className="border border-zinc-200 bg-white p-5 text-sm leading-relaxed text-zinc-700">
          <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
            Sheet columns used ({categoryLabels[subCategory]})
          </h3>
          <p className="mt-2">
            MoM and FY charts sum the month headers on your master (<strong>Apr-25</strong>,{" "}
            <strong>May-25</strong>, <strong>Mar-26</strong>, …) for every listing in this category — not
            the separate <strong>Apr</strong> / <strong>May MTD</strong> snapshot cells.
          </p>
          <p className="mt-2 text-xs font-medium text-zinc-600">
            Listings in roll-up: <strong className="text-zinc-900">{skuCountAmazon}</strong> Amazon ·{" "}
            <strong className="text-zinc-900">{skuCountFlipkart}</strong> Flipkart
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
              ? `${formatInteger(insights.previousFyTotalChannel.amazon)} Amazon · ${formatInteger(insights.previousFyTotalChannel.flipkart)} Flipkart`
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
                ? `${formatInteger(insights.currentFyTotalChannel.amazon)} Amazon · ${formatInteger(insights.currentFyTotalChannel.flipkart)} Flipkart`
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
              ? `${formatInteger(latestMomChannel.amazon)} Amazon · ${formatInteger(latestMomChannel.flipkart)} Flipkart`
              : undefined
          }
        />
        <StatCard
          label={`Previous month SO (${prevMonthShort})`}
          value={formatInteger(prevMonthUnits)}
          variant="amber"
          hint={
            prevMomChannel
              ? `${formatInteger(prevMomChannel.amazon)} Amazon · ${formatInteger(prevMomChannel.flipkart)} Flipkart`
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
              Completed months: sheet month columns (Apr-25, May-25, …). Current month:{" "}
              <strong>MTD (ongoing)</strong> from the report&apos;s <strong>May MTD</strong> column on
              your latest upload.
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
                            · MTD (ongoing)
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-zinc-700">
                        Units:{" "}
                        <span className="font-extrabold tabular-nums text-zinc-950">
                          {formatInteger(Number(row.units ?? 0))}
                        </span>
                        {row.channelUnits &&
                        (channelsActive.amazon || channelsActive.flipkart) ? (
                          <span className="font-semibold text-zinc-600">
                            {" "}
                            (
                            {channelsActive.amazon ? (
                              <>
                                <span className="tabular-nums">
                                  {formatInteger(row.channelUnits.amazon)}
                                </span>
                                {" Amazon"}
                              </>
                            ) : null}
                            {channelsActive.amazon && channelsActive.flipkart ? " · " : null}
                            {channelsActive.flipkart ? (
                              <>
                                <span className="tabular-nums">
                                  {formatInteger(row.channelUnits.flipkart)}
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
}: {
  pct: number | null;
  tillLabel: string;
  previousFyRangeLabel: string;
  previousFyTotalUnits: number;
  previousFyTotalChannel: { amazon: number; flipkart: number } | null;
  currentYtdUnits: number;
  currentYtdChannel: { amazon: number; flipkart: number } | null;
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
                <span className="tabular-nums">{formatInteger(previousFyTotalChannel.amazon)}</span> Amazon ·{" "}
                <span className="tabular-nums">{formatInteger(previousFyTotalChannel.flipkart)}</span> Flipkart
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
                  <span className="tabular-nums">{formatInteger(currentYtdChannel.amazon)}</span> Amazon ·{" "}
                  <span className="tabular-nums">{formatInteger(currentYtdChannel.flipkart)}</span> Flipkart
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
