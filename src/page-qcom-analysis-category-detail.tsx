import { useEffect, useMemo, useState } from "react";
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
import { QcomMtdSelloutDashboard } from "./qcom-mtd-sellout-dashboard";
import {
  computeQcomCategorySelloutInsights,
  emptyQcomChannelUnits,
  type QcomCategorySheetMonthlySellout,
  type QcomChannelUnits,
} from "./qcom-category-sellout-insights";
import {
  QCOM_CATEGORY_ANALYSIS_ALL,
  QCOM_SUBCATEGORY_ANALYSIS_ALL,
  isQcomCategoryAnalysisAll,
  isQcomSubCategoryAnalysisAll,
  loadQcomCategorySheetMonthlySellout,
  listQcomCategories,
  listQcomSubCategoriesForCategory,
  qcomCategoryAnalysisLabel,
  qcomSubCategoryAnalysisLabel,
  type QcomCategoryAnalysisScope,
  type QcomSubCategoryOption,
} from "./data-qcom";
import {
  QcomEntireCategoryScopeControl,
  QcomSubCategoryScopeSelect,
} from "./qcom-analysis-category-scope-filters";
import { formatQcomChannelUnitsLine } from "./qcom-channel-format";
import { marketplaceLabel } from "./marketplace-labels";
import {
  qcomAnalysisCategoryPath,
  qcomChannelAnalysisCategoryPath,
  qcomChannelAnalysisListPath,
} from "./qcom-paths";
import { QCOM_CHANNEL_LABELS, type QuickCommerceChannel } from "./tenants";
import { QCOM_MARKETPLACES, type QcomMarketplace } from "./types";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_LEGEND_STYLE } from "./chart-theme";
import {
  Card,
  DataAsOnBadge,
  DataAsOnQcomChannelsBadge,
  EmptyState,
  FieldLabel,
  InlineLoader,
  PageTitle,
  Select,
  StatCard,
} from "./ui";
import { useLatestUploadSheetCoverageByQcom } from "./use-qcom-sheet-coverage";
import { formatDecimal, formatInteger } from "./utils";

const CURRENT_FY_COLOR = "#4f46e5";
const PREVIOUS_FY_COLOR = "#94a3b8";
const AXIS_TICK = CHART_AXIS_TICK;

export function QcomAnalysisCategoryDetailPage({
  marketplace,
}: {
  marketplace?: QcomMarketplace;
} = {}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useParams<{ category: string }>();
  const category = params.category ? decodeURIComponent(params.category).trim() : "";
  const categoryLabel = qcomCategoryAnalysisLabel(category);
  const scope: QcomCategoryAnalysisScope | undefined = useMemo(
    () => (marketplace ? { marketplace } : undefined),
    [marketplace],
  );
  const channelLabel = marketplace
    ? QCOM_CHANNEL_LABELS[marketplace as QuickCommerceChannel]
    : null;
  const showMultiChannelBreakdown = !marketplace;
  const hubPath = marketplace
    ? qcomChannelAnalysisListPath(marketplace as QuickCommerceChannel)
    : "/app/qcom/analysis/category";
  const toCategoryPath = (cat: string, sub?: string | null) =>
    marketplace
      ? qcomChannelAnalysisCategoryPath(marketplace as QuickCommerceChannel, cat, sub)
      : qcomAnalysisCategoryPath(cat, sub);
  const activeSubCategory =
    searchParams.get("sub")?.trim() || QCOM_SUBCATEGORY_ANALYSIS_ALL;
  const subCategoryLabel = qcomSubCategoryAnalysisLabel(activeSubCategory);
  const showSubCategoryPicker = category && !isQcomCategoryAnalysisAll(category);

  const [categories, setCategories] = useState<string[]>([]);
  const [subCategoryOptions, setSubCategoryOptions] = useState<QcomSubCategoryOption[]>([]);
  const [sheetMonths, setSheetMonths] = useState<QcomCategorySheetMonthlySellout | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    void listQcomCategories(scope).then(setCategories);
  }, [scope]);

  useEffect(() => {
    if (!showSubCategoryPicker) {
      setSubCategoryOptions([]);
      return;
    }
    void listQcomSubCategoriesForCategory(category, scope)
      .then(setSubCategoryOptions)
      .catch(() => setSubCategoryOptions([]));
  }, [category, showSubCategoryPicker, scope]);

  useEffect(() => {
    if (!category) return;
    setIsLoading(true);
    setError(null);
    setSheetMonths(null);
    const sub = showSubCategoryPicker ? activeSubCategory : QCOM_SUBCATEGORY_ANALYSIS_ALL;
    void loadQcomCategorySheetMonthlySellout(category, sub, scope)
      .then(setSheetMonths)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load category sellout."),
      )
      .finally(() => setIsLoading(false));
  }, [category, activeSubCategory, showSubCategoryPicker, scope]);

  const isEntireCategory = isQcomSubCategoryAnalysisAll(activeSubCategory);

  const selectEntireCategory = () => {
    if (!isEntireCategory) setSearchParams({});
  };

  const selectSubCategory = (sub: string) => {
    setSearchParams({ sub });
  };

  const pageTitle = showSubCategoryPicker
    ? isEntireCategory
      ? channelLabel
        ? `${channelLabel} · ${categoryLabel}`
        : `${categoryLabel} (all quick commerce channels)`
      : channelLabel
        ? `${channelLabel} · ${categoryLabel} · ${subCategoryLabel}`
        : `${categoryLabel} · ${subCategoryLabel}`
    : channelLabel
      ? `${channelLabel} · ${categoryLabel}`
      : `${categoryLabel} (all quick commerce channels)`;

  const insights = useMemo(
    () => (sheetMonths ? computeQcomCategorySelloutInsights(sheetMonths) : null),
    [sheetMonths],
  );

  const currentMomSeries = insights?.currentFyMomSeries ?? [];

  const momComparable = currentMomSeries.filter(
    (row): row is (typeof currentMomSeries)[number] & { pctGrowth: number } =>
      row.pctGrowth !== null,
  );
  const positiveMomMonths = momComparable.filter((row) => row.pctGrowth > 0).length;

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
        {showMultiChannelBreakdown && data.previousFyChannel ? (
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
        {showMultiChannelBreakdown && data.currentFyChannel ? (
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
          to={hubPath}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {channelLabel ? `Back to ${channelLabel} analysis` : "Back to categories"}
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
        to={hubPath}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {channelLabel ? `Back to ${channelLabel} analysis` : "Back to categories"}
      </Link>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px]">
          <FieldLabel>Category</FieldLabel>
          <Select
            value={category}
            onChange={(e) => navigate(toCategoryPath(e.target.value))}
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

        {showSubCategoryPicker && subCategoryOptions.length > 0 ? (
          <>
            <div>
              <FieldLabel>Entire category</FieldLabel>
              <QcomEntireCategoryScopeControl
                isActive={isEntireCategory}
                onSelect={selectEntireCategory}
              />
            </div>
            <QcomSubCategoryScopeSelect
              options={subCategoryOptions}
              activeSubCategory={activeSubCategory}
              isEntireCategory={isEntireCategory}
              onSelectSubCategory={selectSubCategory}
            />
          </>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            Category intelligence
          </p>
          <PageTitle
            title={pageTitle}
            subtitle={`${categoryLabel}${!isEntireCategory ? ` · ${subCategoryLabel}` : ""} · ${skuCount} listing${skuCount === 1 ? "" : "s"}${
              showMultiChannelBreakdown && anyChannelActive
                ? ` (${QCOM_MARKETPLACES.filter((ch) => channelsActive[ch])
                    .map((ch) => `${skuCountByChannel[ch]} ${marketplaceLabel(ch)}`)
                    .join(" · ")})`
                : ""
            } · ${
              channelLabel
                ? `monthly sellout roll-up from the latest ${channelLabel} master upload.`
                : "combined monthly sellout roll-up from the latest master upload."
            }`}
          />
        </div>
        {marketplace && channelCoverage?.[marketplace] ? (
          <div className="min-w-0 xl:justify-self-end">
            <DataAsOnBadge isoDate={channelCoverage[marketplace]!} />
          </div>
        ) : showMultiChannelBreakdown && channelCoverage ? (
          <div className="min-w-0 xl:justify-self-end">
            <DataAsOnQcomChannelsBadge coverage={channelCoverage} />
          </div>
        ) : null}
      </div>

      <Card className="border-violet-200 bg-violet-50/50 text-sm font-medium text-zinc-700">
        {channelLabel
          ? `Monthly sellout is rolled up by category on ${channelLabel} (current month uses MTD).`
          : "Monthly sellout is rolled up category-wise by combining Zepto, Blinkit, Big Basket, and Instamart (current month uses MTD)."}
      </Card>

      {marketplace && !channelsActive[marketplace] ? (
        <Card className="border-amber-300 bg-amber-50/80 p-4 text-sm text-amber-950">
          <p className="font-bold">No {channelLabel} upload</p>
          <p className="mt-2">
            Upload the Quick Commerce master with a <strong>{channelLabel}</strong> tab from Upload
            Center to see sellout analysis here.
          </p>
        </Card>
      ) : null}
      {showMultiChannelBreakdown && QCOM_MARKETPLACES.some((ch) => !channelsActive[ch]) ? (
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
            Data used ({categoryLabel}
            {!isEntireCategory ? ` · ${subCategoryLabel}` : ""})
          </h3>
          <p className="mt-2">
            MoM and FY charts sum daily sellout ingested from the master for every listing in this
            {isEntireCategory ? " category" : ` sub category (${subCategoryLabel})`}
            . Current month uses the sheet <strong>MTD</strong> column when the report month is
            still in progress.
          </p>
          <p className="mt-2 text-xs font-medium text-zinc-600">
            {channelLabel ? (
              <>
                Listings in roll-up (latest <strong>{channelLabel}</strong> upload):{" "}
                <strong className="text-zinc-900">{skuCount}</strong>
              </>
            ) : (
              <>
                Listings in roll-up (latest upload per channel tab, same as workbook rows):{" "}
                {QCOM_MARKETPLACES.filter((ch) => channelsActive[ch]).map((ch, i) => (
                  <span key={ch}>
                    {i > 0 ? " · " : null}
                    <strong className="text-zinc-900">{skuCountByChannel[ch]}</strong>{" "}
                    {marketplaceLabel(ch)}
                  </span>
                ))}
              </>
            )}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label={`${fyTitlePrev} total SO`}
          value={formatInteger(insights.previousFyTotal)}
          variant="violet"
          hint={
            showMultiChannelBreakdown && insights.previousFyTotalChannel
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
              showMultiChannelBreakdown && insights.currentFyTotalChannel
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
            showMultiChannelBreakdown && latestMomChannel
              ? formatQcomChannelUnitsLine(latestMomChannel, channelsActive)
              : undefined
          }
        />
        <StatCard
          label={`Previous month SO (${prevMonthShort})`}
          value={formatInteger(prevMonthUnits)}
          variant="amber"
          hint={
            showMultiChannelBreakdown && prevMomChannel
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
        showMultiChannelBreakdown={showMultiChannelBreakdown}
      />

      <Card id="fy-sellout-trend" className="scroll-mt-6 p-6">
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

      <QcomMtdSelloutDashboard
        momChartSeries={momCur}
        channelsActive={channelsActive}
        showChannelBreakdown={showMultiChannelBreakdown && anyChannelActive}
        reportSnapshotDate={sheetMonths?.reportSnapshotDate ?? null}
        lastMonthUnits={prevMonthUnits}
        lastMonthLabel={momCur.length >= 2 ? momCur[momCur.length - 2].label : "Last month"}
        positiveYoyMonths={positiveMomMonths}
        totalYoyMonths={momComparable.length}
      />
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
  showMultiChannelBreakdown,
}: {
  pct: number | null;
  tillLabel: string;
  previousFyRangeLabel: string;
  previousFyTotalUnits: number;
  previousFyTotalChannel: QcomChannelUnits | null;
  currentYtdUnits: number;
  currentYtdChannel: QcomChannelUnits | null;
  channelsActive: Record<QcomMarketplace, boolean>;
  showMultiChannelBreakdown: boolean;
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
            {showMultiChannelBreakdown && previousFyTotalChannel ? (
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
              {showMultiChannelBreakdown && currentYtdChannel ? (
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
