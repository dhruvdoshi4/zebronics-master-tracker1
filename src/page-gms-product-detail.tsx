import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
import { ArrowLeft, CalendarDays } from "lucide-react";
import { useCatalogScope } from "./catalog-scope-context";
import { loadUnifiedProductGmsHistory, type UnifiedProductGmsHistory } from "./data-gms";
import { computeCategoryGmsInsights } from "./gms-insights";
import { buildGmsGapSuggestion } from "./gms";
import {
  GmsChannelBreakdown,
  GmsFormulaPill,
  GmsKpiCard,
} from "./gms-category-detail-ui";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_LEGEND_STYLE } from "./chart-theme";
import { Card, EmptyState, InlineLoader, DataAsOnDualChannelBadge } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";
import type { Marketplace } from "./types";
import { cn, formatDecimal, formatGmsAxisTick, formatGmsCr, formatInr } from "./utils";

const CURRENT_FY_COLOR = "#4f46e5";
const PREVIOUS_FY_COLOR = "#94a3b8";

export function GmsProductDetailPage() {
  const { routePrefix, workspace } = useCatalogScope();
  const params = useParams<{ marketplace: string; code: string }>();
  const entryMarketplace = (params.marketplace as Marketplace) ?? "amazon";
  const entryCode = decodeURIComponent(params.code ?? "");
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UnifiedProductGmsHistory | null>(null);
  const [momFyScope, setMomFyScope] = useState<"current" | "previous">("current");

  useEffect(() => {
    if (!entryCode) return;
    setIsLoading(true);
    setError(null);
    void loadUnifiedProductGmsHistory(entryMarketplace, entryCode, workspace)
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load product GMS."),
      )
      .finally(() => setIsLoading(false));
  }, [entryMarketplace, entryCode, workspace]);

  const insights = useMemo(
    () => (data ? computeCategoryGmsInsights(data.sheetMonths) : null),
    [data],
  );

  const gap = useMemo(() => {
    if (!data) return null;
    return buildGmsGapSuggestion(data.planCurrent.planned, data.mtdGms, data.bau_price);
  }, [data]);

  const channelsActive = data?.channelsActive ?? { amazon: false, flipkart: false };
  const hasChannelSplit = channelsActive.amazon || channelsActive.flipkart;

  const selectedMomSeries =
    momFyScope === "current"
      ? (insights?.currentFyMomSeries ?? [])
      : (insights?.previousFyMomSeries ?? []);

  const selectedFyLabel = insights
    ? momFyScope === "current"
      ? `FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)}`
      : `FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)}`
    : "";

  const yAxisTick = { ...CHART_AXIS_TICK, tickFormatter: (v: number) => formatGmsAxisTick(Number(v)) };

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
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    return (
      <div className="min-w-[220px] rounded-xl border-2 border-zinc-200 bg-white px-4 py-3 shadow-lg">
        <p className="border-b border-zinc-100 pb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">
          {String(label ?? "")}
        </p>
        <p className="mt-2 text-sm font-semibold text-zinc-700">
          Previous FY: <strong>{formatGmsCr(row.previousFy)}</strong>
        </p>
        {row.previousFyChannel ? (
          <p className="mt-0.5 text-xs font-semibold text-zinc-500">
            {formatGmsCr(row.previousFyChannel.amazon)} Amazon ·{" "}
            {formatGmsCr(row.previousFyChannel.flipkart)} Flipkart
          </p>
        ) : null}
        <p className="mt-2 text-sm font-semibold text-zinc-700">
          Current FY:{" "}
          <strong>{row.currentFy === null ? "N/A" : formatGmsCr(row.currentFy)}</strong>
        </p>
        {row.currentFyChannel ? (
          <p className="mt-0.5 text-xs font-semibold text-zinc-500">
            {formatGmsCr(row.currentFyChannel.amazon)} Amazon ·{" "}
            {formatGmsCr(row.currentFyChannel.flipkart)} Flipkart
          </p>
        ) : null}
        {row.yoyGrowthPct !== null ? (
          <p className="mt-2 text-sm font-semibold text-zinc-700">
            YoY:{" "}
            <span className={row.yoyGrowthPct >= 0 ? "text-emerald-600" : "text-rose-600"}>
              {row.yoyGrowthPct >= 0 ? "+" : ""}
              {formatDecimal(row.yoyGrowthPct)}%
            </span>
          </p>
        ) : null}
      </div>
    );
  };

  if (isLoading) return <InlineLoader text="Loading product GMS…" />;
  if (error) return <EmptyState title="Unable to load" description={error} />;
  if (!data || !insights) {
    return (
      <EmptyState
        title="No GMS history"
        description="Upload sellout and BAU sheets for this SKU on Amazon and/or Flipkart."
      />
    );
  }

  const fyTitleCurrent = `FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)}`;
  const momCur = insights.currentFyMomSeries;
  const latestMonthUnits = momCur.length ? momCur[momCur.length - 1].units : 0;
  const prevMonthUnits = momCur.length >= 2 ? momCur[momCur.length - 2].units : 0;
  const prevMonthShort = momCur.length >= 2 ? momCur[momCur.length - 2].shortLabel : "—";
  const latestMomChannel = momCur.length ? momCur[momCur.length - 1]?.channelUnits : undefined;
  const mtdMomPct =
    prevMonthUnits > 0 ? ((latestMonthUnits - prevMonthUnits) / prevMonthUnits) * 100 : null;

  const mtdChannel = hasChannelSplit
    ? { amazon: data.amazon?.mtdGms ?? 0, flipkart: data.flipkart?.mtdGms ?? 0 }
    : undefined;

  const planChannel = hasChannelSplit
    ? {
        amazon: data.amazon?.planCurrent.planned ?? 0,
        flipkart: data.flipkart?.planCurrent.planned ?? 0,
      }
    : undefined;

  const listingParts: string[] = [];
  if (data.asin) listingParts.push(`ASIN ${data.asin}`);
  if (data.fsn) listingParts.push(`FSN ${data.fsn}`);
  if (data.erpProductId) listingParts.push(`ID ${data.erpProductId}`);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-1 pb-8 sm:px-2">
      <Link
        to={`${routePrefix}/gms/product`}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Product GMS
      </Link>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-violet-600">GMS Tracker</p>
          <h1 className="mt-1 text-2xl font-bold text-zinc-900">{data.productName}</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {listingParts.length > 0 ? (
              <>
                {listingParts.join(" · ")} · Combined Amazon + Flipkart where linked
              </>
            ) : (
              "No Amazon or Flipkart listing linked"
            )}
          </p>
          {(data.amazon || data.flipkart) && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
              {data.amazon ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-900">
                  Amazon BAU {formatInr(data.amazon.bau_price)}
                </span>
              ) : null}
              {data.flipkart ? (
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-900">
                  Flipkart BAU {formatInr(data.flipkart.bau_price)}
                </span>
              ) : null}
            </div>
          )}
        </div>
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      <GmsFormulaPill />

      {(!channelsActive.amazon || !channelsActive.flipkart) && (
        <Card className="border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950">
          <p className="font-bold">Channel coverage</p>
          <p className="mt-1 font-medium">
            {!channelsActive.amazon ? "Upload Amazon sellout for Amazon GMS. " : ""}
            {!channelsActive.flipkart ? "Upload Flipkart sellout for Flipkart GMS." : ""}
            {!data.asin && !data.fsn
              ? " Link this model on HO stock (ASIN/FSN) to match both channels."
              : ""}
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <GmsKpiCard
          accent="sky"
          label="Planned GMS (month)"
          value={formatGmsCr(data.planCurrent.planned)}
          channelSplit={
            planChannel && hasChannelSplit
              ? { ch: planChannel, channels: channelsActive, showPct: true }
              : undefined
          }
        />
        <GmsKpiCard
          accent="emerald"
          label="MTD GMS (combined)"
          value={formatGmsCr(data.mtdGms)}
          channelSplit={
            mtdChannel && hasChannelSplit
              ? { ch: mtdChannel, channels: channelsActive, showPct: true }
              : undefined
          }
          trend={
            mtdMomPct !== null
              ? { pct: mtdMomPct, label: `vs ${prevMonthShort} ${insights.currentFyStart}` }
              : undefined
          }
        />
        <GmsKpiCard accent="violet" label="Gap vs plan" value={formatGmsCr(gap?.gapGms ?? 0)} />
        <GmsKpiCard
          accent="violet"
          label={`${fyTitleCurrent} YTD GMS`}
          value={formatGmsCr(insights.currentFyTotal)}
          channelSplit={
            insights.currentFyTotalChannel && hasChannelSplit
              ? {
                  ch: insights.currentFyTotalChannel,
                  channels: channelsActive,
                  showPct: true,
                }
              : undefined
          }
        />
      </div>

      {gap ? <Card className="text-sm text-zinc-700">{gap.message}</Card> : null}

      <Card className="p-6">
        <h3 className="text-lg font-bold">Financial year GMS trend</h3>
        <p className="mt-1 text-sm text-zinc-500">
          Combined monthly GMS. Current month uses MTD from latest sellout. Tooltip shows Amazon vs
          Flipkart split.
        </p>
        <div className="mt-4 h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={insights.trendData}>
              <defs>
                <linearGradient id="gmsProductCurrentFyArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CURRENT_FY_COLOR} stopOpacity={0.26} />
                  <stop offset="95%" stopColor={CURRENT_FY_COLOR} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={yAxisTick} tickLine={false} axisLine={false} width={56} />
              <Tooltip content={fyTooltip} />
              <Legend wrapperStyle={CHART_LEGEND_STYLE} />
              <Area
                type="natural"
                dataKey="currentFyDisplay"
                name="Current FY (combined)"
                stroke="none"
                fill="url(#gmsProductCurrentFyArea)"
                legendType="none"
              />
              <Line
                type="natural"
                dataKey="previousFy"
                name="Previous FY"
                stroke={PREVIOUS_FY_COLOR}
                strokeDasharray="5 5"
                strokeWidth={2}
                dot={{ r: 3, fill: PREVIOUS_FY_COLOR }}
              />
              <Line
                type="natural"
                dataKey="currentFyDisplay"
                name="Current FY"
                stroke={CURRENT_FY_COLOR}
                strokeWidth={2.5}
                dot={(props: { cx?: number; cy?: number; payload?: { isMtdPoint?: boolean } }) => {
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null) return null;
                  const fill = payload?.isMtdPoint ? "#f59e0b" : CURRENT_FY_COLOR;
                  return <circle cx={cx} cy={cy} r={4} fill={fill} stroke="#fff" strokeWidth={1.2} />;
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {hasChannelSplit && mtdChannel ? (
          <div className="mt-4 border-t border-zinc-100 pt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              Current month MTD by channel
            </p>
            <GmsChannelBreakdown
              ch={mtdChannel}
              channels={channelsActive}
              showPct
            />
          </div>
        ) : null}
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">Month on month — {selectedFyLabel}</h3>
            <p className="text-sm text-zinc-500">Combined GMS in INR. Ongoing month = MTD.</p>
          </div>
          <div className="flex gap-2">
            {(["current", "previous"] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                onClick={() => setMomFyScope(scope)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-bold uppercase",
                  momFyScope === scope
                    ? "bg-violet-600 text-white"
                    : "bg-zinc-100 text-zinc-700",
                )}
              >
                {scope === "current" ? "Current FY" : "Previous FY"}
              </button>
            ))}
            <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold text-zinc-700">
              <CalendarDays className="h-3.5 w-3.5" />
              {selectedFyLabel}
            </span>
          </div>
        </div>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={selectedMomSeries}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="shortLabel" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={yAxisTick} tickLine={false} axisLine={false} width={56} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as
                    | {
                        units?: number;
                        channelUnits?: { amazon: number; flipkart: number };
                        pctGrowth?: number | null;
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
                            · MTD
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-zinc-700">
                        GMS: <strong>{formatGmsCr(Number(row.units ?? 0))}</strong>
                        {row.channelUnits && hasChannelSplit ? (
                          <span className="font-semibold text-zinc-600">
                            {" "}
                            (
                            {channelsActive.amazon ? (
                              <>
                                {formatGmsCr(row.channelUnits.amazon)} Amazon
                              </>
                            ) : null}
                            {channelsActive.amazon && channelsActive.flipkart ? " · " : null}
                            {channelsActive.flipkart ? (
                              <>
                                {formatGmsCr(row.channelUnits.flipkart)} Flipkart
                              </>
                            ) : null}
                            )
                          </span>
                        ) : null}
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="units" name="GMS" radius={[6, 6, 0, 0]}>
                {selectedMomSeries.map((row, index) => (
                  <Cell key={index} fill={row.barColor} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {latestMomChannel && hasChannelSplit ? (
          <div className="mt-4 border-t border-zinc-100 pt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              Latest month in chart
            </p>
            <GmsChannelBreakdown
              ch={latestMomChannel}
              channels={channelsActive}
              showPct
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
