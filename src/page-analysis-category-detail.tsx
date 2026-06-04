import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, CalendarDays } from "lucide-react";
import {
  buildCategoryMtdDashboardSeries,
  categoryMomChannelLine,
  computeCategorySelloutInsights,
  mapCategoryMomSeriesToMtdDashboardRows,
  type CategorySheetMonthlySellout,
} from "./category-sellout-insights";
import { SelloutMtdSection } from "./sellout-mtd-section";
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
  migrateLegacyRithikaAnalysisCategory,
  migrateLegacyRithikaAnalysisUrlSegment,
  normalizeHariSubCategoryValue,
} from "./analysis-category-filters";
import { CategorySubCategoryFilterControls } from "./category-subcategory-filter-controls";
import { CATALOG_WORKSPACE_PRAVIN } from "./catalog-workspace";
import { PRAVIN_POWERBANK_SUB_LABEL } from "./pravin-category-scope";
import { normalizeKey } from "./utils";
import { useCatalogScope } from "./catalog-scope-context";
import { useAdminRealm } from "./admin-realm-context";
import { loadAdminGlobalCategorySheetMonthlySellout } from "./admin-dashboard-data";
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
import { useAuth } from "./use-auth";
import { formatDecimal, formatInteger } from "./utils";
import { getSubCategoryLabel } from "./types";
import { CATALOG_WORKSPACE_RITHIKA } from "./catalog-workspace";

const CURRENT_FY_COLOR = "#4f46e5";
const PREVIOUS_FY_COLOR = "#94a3b8";
const AXIS_TICK = CHART_AXIS_TICK;

export function AnalysisCategoryDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { workspace, routePrefix } = useCatalogScope();
  const { isLoading: authLoading } = useAuth();
  const { isMarketplaceGlobal, impersonatedWorkspace } = useAdminRealm();
  const useAdminGlobalRollup =
    !authLoading && isMarketplaceGlobal && impersonatedWorkspace == null;
  const dataScope = useDataScope();
  const isDawg = isDawgDataScope(dataScope);
  const params = useParams<{ category: string }>();
  const categorySegment = params.category ?? "";
  const subFromUrl = searchParams.get("sub") ?? ANALYSIS_SUB_CATEGORY_ALL;

  const {
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
  const skuCountAmazon = sheetMonths?.skuCountAmazon ?? 0;
  const skuCountFlipkart = sheetMonths?.skuCountFlipkart ?? 0;
  const skuCount = sheetMonths?.skuCount ?? 0;
  const channelsActive = sheetMonths?.channelsActive ?? { amazon: false, flipkart: false };
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

  const isRithika = workspace === CATALOG_WORKSPACE_RITHIKA;
  const rithikaLegacyOpts = useMemo(() => ({ includeRoma: isRithika }), [isRithika]);

  /** Always load from URL — hook state can lag one render behind ?sub= changes (stale all/all totals). */
  const subCategoryFromUrl = useMemo(
    () => analysisSubCategoryFromUrlValue(subFromUrl),
    [subFromUrl],
  );
  /** Stable fetch key from URL only — never refetch when the category tree finishes loading. */
  const categoryRawFromUrl = useMemo(() => {
    const raw = analysisCategoryFromUrlSegment(categorySegment);
    return migrateLegacyRithikaAnalysisCategory(raw, rithikaLegacyOpts);
  }, [categorySegment, rithikaLegacyOpts]);
  const fetchGenerationRef = useRef(0);

  const rollUpTitleFromUrl = `${analysisCategoryLabel(categoryRawFromUrl)} · ${analysisSubCategoryLabel(subCategoryFromUrl)}`;

  const isMonitorRollup =
    normalizeHariSubCategoryValue(subCategoryFromUrl) === "monitor";
  const monitorAmazonScopeMismatch =
    isMonitorRollup && channelsActive.amazon && (skuCountAmazon < 38 || skuCountAmazon > 45);

  useEffect(() => {
    if (!categorySegment) return;
    const rithikaLegacy =
      isRithika || useAdminGlobalRollup
        ? migrateLegacyRithikaAnalysisUrlSegment(categorySegment, rithikaLegacyOpts)
        : null;
    if (rithikaLegacy) {
      navigate(
        analysisCategoryDetailPath(
          routePrefix,
          analysisCategoryToUrlSegment(rithikaLegacy.category),
          subCategoryFromUrl,
        ),
        { replace: true },
      );
      return;
    }
    if (searchParams.has("sub")) return;
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
  }, [
    categorySegment,
    searchParams,
    navigate,
    routePrefix,
    isDawg,
    isRithika,
    useAdminGlobalRollup,
    rithikaLegacyOpts,
    subCategoryFromUrl,
  ]);

  useEffect(() => {
    if (!categorySegment || authLoading) return;

    const generation = ++fetchGenerationRef.current;
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = useAdminGlobalRollup
          ? await loadAdminGlobalCategorySheetMonthlySellout(
              categoryRawFromUrl,
              subCategoryFromUrl,
            )
          : await loadCategorySheetMonthlySellout(
              categoryRawFromUrl,
              subCategoryFromUrl,
              workspace,
              dataScope,
            );
        if (fetchGenerationRef.current !== generation) return;
        setSheetMonths(result);
      } catch (e: unknown) {
        if (fetchGenerationRef.current !== generation) return;
        setError(e instanceof Error ? e.message : "Failed to load category sellout.");
      } finally {
        if (fetchGenerationRef.current === generation) setIsLoading(false);
      }
    })();
  }, [
    categoryRawFromUrl,
    subCategoryFromUrl,
    workspace,
    dataScope,
    categorySegment,
    authLoading,
    useAdminGlobalRollup,
  ]);

  const navigateToSelection = (nextCategoryRaw: string, nextSub: string) => {
    const seg = analysisCategoryToUrlSegment(nextCategoryRaw);
    const path = analysisCategoryDetailPath(routePrefix, seg, nextSub);
    navigate(path);
  };

  const insights = useMemo(
    () => (sheetMonths ? computeCategorySelloutInsights(sheetMonths) : null),
    [sheetMonths],
  );

  const isPravinPowerBankAnalysis =
    workspace === CATALOG_WORKSPACE_PRAVIN &&
    normalizeKey(categoryRawFromUrl) === normalizeKey(PRAVIN_POWERBANK_SUB_LABEL);
  const powerBankAmazonScopeMismatch =
    isPravinPowerBankAnalysis &&
    channelsActive.amazon &&
    (skuCountAmazon < 70 ||
      (insights?.previousFyTotalChannel?.amazon ?? 0) < 105_000);

  const mtdSeriesSource = useMemo(() => {
    if (!sheetMonths || !insights) return [];
    return buildCategoryMtdDashboardSeries(sheetMonths, insights);
  }, [sheetMonths, insights]);

  const mtdDashboardRows = useMemo(
    () => mapCategoryMomSeriesToMtdDashboardRows(mtdSeriesSource),
    [mtdSeriesSource],
  );

  const mtdLastMonthUnits = useMemo(() => {
    const mom = insights?.currentFyMomSeries ?? [];
    if (mom.length >= 2) return mom[mom.length - 2].units;
    const prev = sheetMonths?.previousMonthSo;
    return prev ? prev.amazon + prev.flipkart : 0;
  }, [insights, sheetMonths]);

  const mtdLastMonthLabel = useMemo(() => {
    const mom = insights?.currentFyMomSeries ?? [];
    if (mom.length >= 2) return mom[mom.length - 2].label;
    const prevYm = sheetMonths?.previousMonthSo?.monthYm;
    if (prevYm) {
      const d = new Date(`${prevYm}-15T12:00:00`);
      return d.toLocaleString("en-US", { month: "short", year: "numeric" });
    }
    return "Last month";
  }, [insights, sheetMonths]);

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

  if (isLoading && !sheetMonths) return <InlineLoader text="Loading category sellout…" />;
  if (error && !sheetMonths) return <EmptyState title="Unable to load category" description={error} />;
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
              ? `No ${rollUpTitleFromUrl} listings in Product Master.`
              : `No sell-out history for ${skuCount} listing${skuCount === 1 ? "" : "s"} — upload from Upload Center.`
          }
        />
      </div>
    );
  }

  const fyTitleCurrent = `FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)}`;
  const fyTitlePrev = `FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)}`;

  const momCur = insights.currentFyMomSeries;
  const mtd = sheetMonths?.ongoingMonthMtd;
  const prevSo = sheetMonths?.previousMonthSo;
  const latestMonthUnits = mtd
    ? mtd.amazon + mtd.flipkart
    : momCur.length
      ? momCur[momCur.length - 1].units
      : 0;
  const prevMonthUnits = prevSo
    ? prevSo.amazon + prevSo.flipkart
    : momCur.length >= 2
      ? momCur[momCur.length - 2].units
      : 0;
  const prevMonthShort = prevSo
    ? new Date(`${prevSo.monthYm}-15T12:00:00`).toLocaleString("en-US", { month: "short" })
    : momCur.length >= 2
      ? momCur[momCur.length - 2].shortLabel
      : "—";
  const avgMonthlySellout =
    insights.currentFyMonthIndex > 0 ? insights.currentFyTotal / insights.currentFyMonthIndex : 0;

  const latestMomChannel = mtd
    ? { amazon: mtd.amazon, flipkart: mtd.flipkart }
    : momCur.length
      ? momCur[momCur.length - 1]?.channelUnits
      : undefined;
  const prevMomChannel = prevSo
    ? { amazon: prevSo.amazon, flipkart: prevSo.flipkart }
    : momCur.length >= 2
      ? momCur[momCur.length - 2]?.channelUnits
      : undefined;

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
        subCategoryLabels={Object.fromEntries(
          subCategoryOptions.map((o) => [o.value, o.label]),
        )}
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
            title={`${rollUpTitleFromUrl} (Amazon + Flipkart)`}
            subtitle={`${rollUpTitleFromUrl} · ${skuCount} listing${skuCount === 1 ? "" : "s"}${
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
        ROMA &amp; PowerBank Amazon: ingest <strong>Click_tect</strong> first, then add{" "}
        <strong>Cocoblu</strong> on top. FY 2025-26 and FY 2026-27 = month columns for earlier
        months + <strong>report-month MTD</strong> for the current month (not year-SO columns).
        Re-upload the master after deploy so both tabs are reprocessed.
      </Card>

      {powerBankAmazonScopeMismatch ? (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-bold">Amazon PowerBank roll-up looks incomplete</p>
          <p className="mt-2">
            This page has <strong>{skuCountAmazon}</strong> Amazon listings and FY 25-26 Amazon SO{" "}
            <strong>{formatInteger(insights?.previousFyTotalChannel?.amazon ?? 0)}</strong> (expect
            ~<strong>111,031</strong> after Cocoblu is included). Upload the ROMA &amp; PowerBank
            master from the <strong>Pravin</strong> workspace (Cocoblu + Click_tect tabs), then hard
            refresh. If totals stay low, the live app may still be on an older build — redeploy the
            latest tracker build.
          </p>
        </Card>
      ) : null}

      {monitorAmazonScopeMismatch ? (
        <Card className="border-red-300 bg-red-50 p-4 text-sm text-red-950">
          <p className="font-bold">Monitors roll-up SKU count off</p>
          <p className="mt-2">
            Sub category is <strong>{getSubCategoryLabel("monitor")}</strong> but this roll-up has{" "}
            <strong>{skuCountAmazon}</strong> Amazon listings (expected <strong>41</strong> on the
            latest AZ master). Re-upload the Amazon sellout file after migration{" "}
            <strong>024_current_fy_so_units</strong> so EOL monitor ASINs and FY 26-27 SO column
            are ingested.
          </p>
        </Card>
      ) : null}

      {isMonitorRollup && skuCountAmazon >= 38 && skuCountAmazon <= 45 ? (
        <Card className="border-emerald-300 bg-emerald-50/90 p-4 text-sm text-emerald-950">
          <p className="font-bold">Amazon sheet truth (Monitors only · compare Amazon column below)</p>
          <p className="mt-2">
            Expected on latest AZ master (Monitor &amp; Acc. · Monitor): FY 25-26 SO{" "}
            <strong>66,128</strong> · FY 26-27 SO <strong>11,069</strong> · May MTD{" "}
            <strong>5,562</strong> · Apr SO <strong>5,507</strong> — Amazon only. Combined KPI cards
            above add Flipkart (
            {formatInteger(insights.previousFyTotalChannel?.flipkart ?? 0)} /{" "}
            {formatInteger(insights.currentFyTotalChannel?.flipkart ?? 0)} / etc.).
          </p>
        </Card>
      ) : null}

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
            Sheet columns used ({rollUpTitleFromUrl})
          </h3>
          <p className="mt-2">
            MoM and FY charts use the same month headers (<strong>Apr-25</strong> …{" "}
            <strong>Mar-26</strong>). FY 2025-26 KPI uses that month sum; FY 2026-27 KPI uses the{" "}
            <strong>2026 SO</strong> column.
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

      {mtdDashboardRows.length > 0 && sheetMonths?.reportSnapshotDate ? (
        <SelloutMtdSection
          series={mtdDashboardRows}
          reportSnapshotDate={sheetMonths.reportSnapshotDate}
          lastMonthUnits={mtdLastMonthUnits}
          lastMonthLabel={mtdLastMonthLabel}
          channelsActive={sheetMonths.channelsActive}
          formatThisYearChannelLine={(row) =>
            categoryMomChannelLine(row, mtdSeriesSource, "this")
          }
          formatPriorYearChannelLine={(row) =>
            categoryMomChannelLine(row, mtdSeriesSource, "prior")
          }
        />
      ) : null}
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

