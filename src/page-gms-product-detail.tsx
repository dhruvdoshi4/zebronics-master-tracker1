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
import { loadProductGmsHistory } from "./data-gms";
import { computeProductGmsInsights } from "./gms-insights";
import { buildGmsGapSuggestion } from "./gms";
import { displayModelName } from "./product-display";
import type { Marketplace } from "./types";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_LEGEND_STYLE } from "./chart-theme";
import { Card, EmptyState, InlineLoader, StatCard } from "./ui";
import { cn, formatDecimal, formatInr } from "./utils";

const CURRENT_FY_COLOR = "#4f46e5";
const PREVIOUS_FY_COLOR = "#94a3b8";

export function GmsProductDetailPage() {
  const { routePrefix } = useCatalogScope();
  const params = useParams<{ marketplace: string; code: string }>();
  const marketplace = (params.marketplace as Marketplace) ?? "amazon";
  const productCode = params.code ?? "";
  const codeLabel = marketplace === "amazon" ? "ASIN" : "FSN";

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [bauPrice, setBauPrice] = useState(0);
  const [mtdGms, setMtdGms] = useState(0);
  const [plan, setPlan] = useState({ planned: 0, target: 0 });
  const [months, setMonths] = useState<Array<{ month_ym: string; gms_inr: number }>>([]);
  const [momFyScope, setMomFyScope] = useState<"current" | "previous">("current");

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void loadProductGmsHistory(marketplace, productCode)
      .then((data) => {
        const label = displayModelName(data.product?.product_name, productCode);
        setProductName(label === "—" ? productCode : label);
        setBauPrice(data.bau_price);
        setMtdGms(data.mtdGms);
        setPlan(data.planCurrent);
        setMonths(data.months.map((m) => ({ month_ym: m.month_ym, gms_inr: m.gms_inr })));
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load product GMS."),
      )
      .finally(() => setIsLoading(false));
  }, [marketplace, productCode]);

  const insights = useMemo(
    () => computeProductGmsInsights(months, mtdGms),
    [months, mtdGms],
  );

  const gap = buildGmsGapSuggestion(plan.planned, mtdGms, bauPrice);

  const selectedMomSeries =
    momFyScope === "current"
      ? insights?.currentFyMomSeries ?? []
      : insights?.previousFyMomSeries ?? [];

  const selectedFyLabel = insights
    ? momFyScope === "current"
      ? `FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)}`
      : `FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)}`
    : "";

  const trendData =
    insights?.fyLine.map((row, index) => {
      const currentFy = row.currentFy;
      const previousFy = row.previousFy;
      const yoyGrowthPct =
        currentFy !== null && previousFy > 0
          ? ((currentFy - previousFy) / previousFy) * 100
          : null;
      return {
        ...row,
        isMtdPoint: index + 1 === insights.currentFyMonthIndex,
        currentFyDisplay: currentFy ?? 0,
        yoyGrowthPct,
      };
    }) ?? [];

  if (isLoading) return <InlineLoader text="Loading product GMS…" />;
  if (error) return <EmptyState title="Unable to load" description={error} />;
  if (!insights) {
    return (
      <EmptyState
        title="No GMS history"
        description="Upload sellout and BAU sheets for this SKU."
      />
    );
  }

  const customTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: ReadonlyArray<{
      payload?: { currentFy: number | null; previousFy: number; yoyGrowthPct: number | null };
    }>;
    label?: string | number;
  }) => {
    if (!active || !payload?.length) return null;
    const data = payload[0]?.payload;
    if (!data) return null;
    return (
      <div className="min-w-[220px] rounded-xl border-2 border-zinc-200 bg-white px-4 py-3 shadow-lg">
        <p className="border-b border-zinc-100 pb-2 text-xs font-bold uppercase text-zinc-500">
          {String(label ?? "")}
        </p>
        <p className="mt-2 text-sm">
          Previous FY: <strong>{formatInr(data.previousFy)}</strong>
        </p>
        <p className="mt-1 text-sm">
          Current FY:{" "}
          <strong>{data.currentFy === null ? "N/A" : formatInr(data.currentFy)}</strong>
        </p>
        {data.yoyGrowthPct !== null ? (
          <p className="mt-2 text-sm">
            YoY:{" "}
            <span className={data.yoyGrowthPct >= 0 ? "text-emerald-600" : "text-rose-600"}>
              {data.yoyGrowthPct >= 0 ? "+" : ""}
              {formatDecimal(data.yoyGrowthPct)}%
            </span>
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Link
        to={`${routePrefix}/gms/product/${marketplace}`}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to {marketplace === "amazon" ? "Amazon" : "Flipkart"} GMS
      </Link>

      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-violet-600">GMS Tracker</p>
        <h1 className="mt-1 text-2xl font-bold text-zinc-900">{productName}</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {codeLabel}: <span className="font-mono">{productCode}</span> · BAU {formatInr(bauPrice)} · GMS = BAU × SO ÷ 1.18
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Planned GMS (month)" value={formatInr(plan.planned)} variant="sky" />
        <StatCard label="MTD GMS" value={formatInr(mtdGms)} variant="emerald" />
        <StatCard label="Gap vs plan" value={formatInr(gap.gapGms)} variant="violet" />
        <StatCard
          label={`FY ${insights.currentFyStart} YTD GMS`}
          value={formatInr(insights.currentFyTotal)}
          variant="violet"
        />
      </div>

      <Card className="text-sm text-zinc-700">{gap.message}</Card>

      <Card className="p-6">
        <h3 className="text-lg font-bold">Financial year GMS trend</h3>
        <p className="mt-1 text-sm text-zinc-500">Current month uses MTD from latest sellout sheet.</p>
        <div className="mt-4 h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="gmsCurrentFyArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CURRENT_FY_COLOR} stopOpacity={0.26} />
                  <stop offset="95%" stopColor={CURRENT_FY_COLOR} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip content={customTooltip} />
              <Legend wrapperStyle={CHART_LEGEND_STYLE} />
              <Area
                type="natural"
                dataKey="currentFyDisplay"
                name={`Current FY`}
                stroke="none"
                fill="url(#gmsCurrentFyArea)"
                legendType="none"
              />
              <Line
                type="natural"
                dataKey="previousFy"
                name={`Previous FY`}
                stroke={PREVIOUS_FY_COLOR}
                strokeDasharray="5 5"
                strokeWidth={2}
                dot={{ r: 3, fill: PREVIOUS_FY_COLOR }}
              />
              <Line
                type="natural"
                dataKey="currentFyDisplay"
                name={`Current FY`}
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
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">Month on month — {selectedFyLabel}</h3>
            <p className="text-sm text-zinc-500">GMS in INR. Ongoing month = MTD.</p>
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
              <YAxis tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(value) => formatInr(Number(value ?? 0))}
                labelFormatter={(_, payload) =>
                  payload?.[0]?.payload?.label != null
                    ? String(payload[0].payload.label)
                    : ""
                }
              />
              <Bar dataKey="units" name="GMS" radius={[6, 6, 0, 0]}>
                {selectedMomSeries.map((row, index) => (
                  <Cell key={index} fill={row.barColor} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
