import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Area,
  AreaChart,
  Cell,
  Line,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  CalendarDays,
  CircleHelp,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  getLatestMetricForProduct,
  getProductByCode,
  getProductMonthlySellout,
  resolveProductContextByErpId,
} from "./data";
import {
  aggregateQcomSelloutByMonthBestOfCodes,
  getQcomProductDailySellout,
  loadQcomProductSelloutContext,
  loadQcomProductSelloutContextWithFallback,
} from "./data-qcom";
import { displayModelName } from "./product-display";
import { marketplaceLabel } from "./marketplace-labels";
import {
  ProductChannelToggle,
  productIdHubPath,
  productWorkspacePath,
  useProductChannelPeers,
} from "./product-channel";
import { QcomChannelToggle, useQcomChannelPeers } from "./qcom-channel";
import type { ComputedMetric, DailySale, Marketplace, ProductMaster } from "./types";
import { isQcomSelloutMarketplace, type QcomSelloutMarketplace } from "./types";
import { useCatalogScope } from "./catalog-scope-context";
import { qcomWorkspaceFromMarketplace } from "./tenants";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_LEGEND_STYLE } from "./chart-theme";
import { SelloutMtdSection } from "./sellout-mtd-section";
import { Card, DataAsOnBadge, EmptyState, InlineLoader, StatCard } from "./ui";
import { qcomCategoryAnalysisListPath, qcomProductHubPath, qcomProductWorkspacePath } from "./qcom-paths";
import { resolveQcomMonthUnits, resolveSelloutMonthUnits } from "./sellout-month-override";
import {
  buildSheetMonthUnitsMap,
  resolveSelloutChartAnchorDate,
  stripFySpreadOverlapFromMonthMap,
} from "./sellout-monthly-map";
import {
  priorYearComparableUnits,
  priorYearMonthYm,
  yoyGrowthPct,
} from "./sellout-yoy-compare";
import { cn, formatDecimal, formatInteger } from "./utils";

const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
const CURRENT_FY_COLOR = "#4f46e5";
const PREVIOUS_FY_COLOR = "#94a3b8";

function getCurrentFyStart(date: Date): number {
  const year = date.getFullYear();
  return date.getMonth() >= 3 ? year : year - 1;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** YYYY-MM for calendar bucket (matches computed_metrics snapshot months). */
function yyyymm(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

export function SelloutGrowthPage({
  forcedMarketplace,
  forcedProductCode,
  qcomBackPath,
  qcomFromAnalysis,
}: {
  forcedMarketplace?: Marketplace;
  forcedProductCode?: string;
  qcomBackPath?: string;
  qcomFromAnalysis?: boolean;
} = {}) {
  const params = useParams<{
    productId?: string;
    marketplace?: string;
    code?: string;
  }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromAnalysis = searchParams.get("from") === "analysis";
  const erpProductId = params.productId;
  const marketplace =
    forcedMarketplace ?? ((params.marketplace as Marketplace) || "amazon");
  const productCode = forcedProductCode ?? params.code ?? "";
  const isQcom = isQcomSelloutMarketplace(marketplace);
  const [product, setProduct] = useState<ProductMaster | null>(null);
  const [monthlyRows, setMonthlyRows] = useState<DailySale[]>([]);
  const [latestMetric, setLatestMetric] = useState<ComputedMetric | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const qcomWorkspace = isQcom ? qcomWorkspaceFromMarketplace(marketplace) : undefined;
  const { workspace: catalogWorkspace, routePrefix } = useCatalogScope();
  const { peers: channelPeers, loading: peersLoading } = useProductChannelPeers(
    isQcom ? undefined : marketplace,
    isQcom ? undefined : product?.product_code,
    isQcom ? undefined : product?.product_name,
  );
  const hubLookupCode = forcedProductCode?.trim() || productCode.trim();
  const { peers: qcomPeers, loading: qcomPeersLoading } = useQcomChannelPeers(
    qcomWorkspace,
    product?.product_code ?? hubLookupCode,
  );

  async function loadMonthlySellout(mkt: Marketplace, code: string): Promise<DailySale[]> {
    if (isQcomSelloutMarketplace(mkt)) {
      return getQcomProductDailySellout(mkt, code);
    }
    return getProductMonthlySellout(mkt, code, catalogWorkspace);
  }

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    if (erpProductId) {
      void resolveProductContextByErpId(erpProductId)
        .then(async (ctx) => {
          if (!ctx) throw new Error("Product ID not found in HO stock report.");
          if (isQcom) {
            const asin = ctx.amazon?.product_code ?? ctx.flipkart?.product_code;
            if (!asin) {
              throw new Error("No ASIN on HO stock for this product ID — cannot link quick commerce listings.");
            }
            const qcomCtx = await loadQcomProductSelloutContext(
              marketplace as QcomSelloutMarketplace,
              asin,
            );
            if (!qcomCtx) {
              throw new Error(
                `No ${marketplaceLabel(marketplace)} listing for ASIN ${asin}. Upload the Quick Commerce master first.`,
              );
            }
            setProduct(qcomCtx.product);
            setLatestMetric(qcomCtx.latestMetric);
            setMonthlyRows(qcomCtx.dailySales);
            return;
          }
          const listing =
            marketplace === "amazon" ? ctx.amazon : ctx.flipkart;
          if (!listing) {
            throw new Error(
              `No ${marketplace === "amazon" ? "Amazon" : "Flipkart"} listing for this product ID.`,
            );
          }
          const [metricRow, monthly] = await Promise.all([
            getLatestMetricForProduct(marketplace, listing.product_code),
            loadMonthlySellout(marketplace, listing.product_code),
          ]);
          setProduct(listing);
          setLatestMetric(metricRow);
          setMonthlyRows(monthly);
        })
        .catch((e: unknown) =>
          setError(
            e instanceof Error ? e.message : "Failed to load sellout and growth data.",
          ),
        )
        .finally(() => setIsLoading(false));
      return;
    }

    void (async () => {
      if (isQcom) {
        const ws = qcomWorkspace ?? qcomWorkspaceFromMarketplace(marketplace);
        const loaded = await loadQcomProductSelloutContextWithFallback(ws, productCode);
        if (!loaded) {
          setProduct(null);
          setLatestMetric(null);
          setMonthlyRows([]);
          setError(
            "No sellout data for this model on any linked quick-commerce channel. Upload the channel sellout file (or Consolidated master) first.",
          );
          return;
        }
        const hubCode = loaded.ctx.canonicalProductCode;
        if (loaded.resolvedWorkspace !== ws && forcedProductCode) {
          navigate(
            qcomProductWorkspacePath(hubCode, "sellout-growth", loaded.resolvedWorkspace),
            { replace: true },
          );
          return;
        }
        setProduct(loaded.ctx.product);
        setLatestMetric(loaded.ctx.latestMetric);
        setMonthlyRows(loaded.ctx.dailySales);
        return;
      }
      const code = productCode.trim();
      const [productRow, metricRow, monthly] = await Promise.all([
        getProductByCode(marketplace, code),
        getLatestMetricForProduct(marketplace, code),
        loadMonthlySellout(marketplace, code),
      ]);
      setProduct(productRow);
      setLatestMetric(metricRow);
      setMonthlyRows(monthly);
    })()
      .then(() => undefined)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load sellout and growth data."),
      )
      .finally(() => setIsLoading(false));
  }, [erpProductId, marketplace, productCode, forcedProductCode, isQcom, qcomWorkspace, navigate]);

  const insights = useMemo(() => {
    let monthlyMap = isQcom
      ? aggregateQcomSelloutByMonthBestOfCodes(monthlyRows)
      : buildSheetMonthUnitsMap(monthlyRows);

    /** Must match KPI cards (same cells as apr_so_units / may_mtd_units). */
    const snapshotDate =
      latestMetric?.as_of_date != null ? new Date(`${latestMetric.as_of_date}T12:00:00`) : null;
    const snapshotMonthYm = snapshotDate ? yyyymm(snapshotDate) : null;
    const previousSnapshotMonthYm = snapshotDate
      ? yyyymm(new Date(snapshotDate.getFullYear(), snapshotDate.getMonth() - 1, 1))
      : null;

    const hasMonthlyHistory = monthlyRows.length > 0;
    const hasSnapshotMetric = snapshotDate !== null && latestMetric !== null;
    if (!hasMonthlyHistory && !hasSnapshotMetric) return null;

    const anchorDate = resolveSelloutChartAnchorDate(snapshotDate, monthlyMap);
    const currentFyStart = getCurrentFyStart(anchorDate);
    const previousFyStart = currentFyStart - 1;
    const currentFyMonthIndex = ((anchorDate.getMonth() - 3 + 12) % 12) + 1;

    if (!isQcom && latestMetric?.prior_fy_so_units) {
      monthlyMap = stripFySpreadOverlapFromMonthMap(
        monthlyMap,
        latestMetric.prior_fy_so_units,
        previousFyStart,
      );
    }

    const sales = [...monthlyMap.entries()]
      .map(([key, units]) => {
        const [year, month] = key.split("-").map(Number);
        const date = new Date(year, month - 1, 1);
        return { date, units, label: getMonthLabel(date) };
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const currentFyEnd = new Date(currentFyStart + 1, 3, 1);
    const previousFyEnd = new Date(previousFyStart + 1, 3, 1);

    const currentFySales = sales.filter(
      (item) => item.date >= new Date(currentFyStart, 3, 1) && item.date < currentFyEnd,
    );
    const previousFySales = sales.filter(
      (item) => item.date >= new Date(previousFyStart, 3, 1) && item.date < previousFyEnd,
    );

    const fyPrevMonths = monthSequence(previousFyStart, 3, 12).map((d) => monthKey(d));
    let previousFyTotal = fyPrevMonths.reduce(
      (sum, key) => sum + (monthlyMap.get(key) ?? 0),
      0,
    );
    if (previousFyTotal <= 0 && latestMetric?.prior_fy_so_units) {
      previousFyTotal = Number(latestMetric.prior_fy_so_units);
    }

    const currentMap = new Map(currentFySales.map((item) => [monthKey(item.date), item.units]));
    const previousMap = new Map(previousFySales.map((item) => [monthKey(item.date), item.units]));

    const monthUnitsForChart = (monthYm: string, fromHistory: number) =>
      isQcom
        ? resolveQcomMonthUnits(
            monthYm,
            fromHistory,
            snapshotMonthYm,
            previousSnapshotMonthYm,
            latestMetric,
          )
        : resolveSelloutMonthUnits(
            monthYm,
            fromHistory,
            snapshotMonthYm,
            previousSnapshotMonthYm,
            latestMetric,
          );

    const fyLine = FY_MONTHS.map((month, index) => {
      const currentYear = index >= 9 ? currentFyStart + 1 : currentFyStart;
      const prevYear = index >= 9 ? previousFyStart + 1 : previousFyStart;
      const currentMonthKey = `${currentYear}-${String(((index + 3) % 12) + 1).padStart(2, "0")}`;
      const previousMonthKey = `${prevYear}-${String(((index + 3) % 12) + 1).padStart(2, "0")}`;

      const currentFyValue = monthUnitsForChart(
        currentMonthKey,
        currentMap.get(currentMonthKey) ?? 0,
      );

      const previousFyValue = monthUnitsForChart(
        previousMonthKey,
        previousMap.get(previousMonthKey) ?? 0,
      );

      return {
        month,
        currentFy: index + 1 <= currentFyMonthIndex ? currentFyValue : null,
        previousFy: previousFyValue,
      };
    });

    const currentFyTotal = fyLine.reduce((sum, row, index) => {
      if (index + 1 > currentFyMonthIndex) return sum;
      return sum + Number(row.currentFy ?? 0);
    }, 0);

    const snapshotIso = latestMetric?.as_of_date ?? null;
    const priorYearMtdSlice = (() => {
      const slice = new Map<string, number>();
      if (snapshotIso && Number(latestMetric?.prior_year_mtd_units ?? 0) > 0) {
        slice.set(
          priorYearMonthYm(snapshotIso.slice(0, 7)),
          Number(latestMetric!.prior_year_mtd_units),
        );
      }
      return slice;
    })();

    const buildFyMomSeries = (
      fyStart: number,
      monthCount: number,
      opts: { highlightCurrentMonth: boolean; compare: "yoy" | "sequential" },
    ) => {
      const dates = monthSequence(fyStart, 3, monthCount);
      const rows = dates.map((date) => {
        const keyYm = monthKey(date);
        const units = monthUnitsForChart(keyYm, monthlyMap.get(keyYm) ?? 0);
        const isCurrentMonth =
          opts.highlightCurrentMonth &&
          date.getMonth() === anchorDate.getMonth() &&
          date.getFullYear() === anchorDate.getFullYear();
        const isMtdOngoing = opts.highlightCurrentMonth && isCurrentMonth;
        const baseMonthLabel = date.toLocaleString("en-US", { month: "short", year: "2-digit" });
        return {
          date,
          label: date.toLocaleString("en-US", { month: "short", year: "numeric" }),
          shortLabel: date.toLocaleString("en-US", { month: "short" }),
          monthYearLabel: isMtdOngoing ? `${baseMonthLabel} MTD` : baseMonthLabel,
          units,
          isCurrentMonth,
          isMtdOngoing,
          barColor: isCurrentMonth ? "#c7d2fe" : "#a78bfa",
        };
      });

      const maxUnits = Math.max(1, ...rows.map((row) => row.units));
      return rows.map((row, index) => {
        const keyYm = monthKey(row.date);
        let priorYearUnits = 0;
        let pctGrowth: number | null = null;
        if (opts.compare === "yoy") {
          priorYearUnits = priorYearComparableUnits({
            monthYm: keyYm,
            isMtdOngoing: row.isMtdOngoing,
            monthlyMap,
            dailyRows: monthlyRows,
            snapshotDate: snapshotIso,
            priorYearMtdSlice,
          });
          pctGrowth = yoyGrowthPct(row.units, priorYearUnits);
        } else {
          const prev = index > 0 ? rows[index - 1] : null;
          priorYearUnits = prev?.units ?? 0;
          pctGrowth =
            prev && prev.units > 0 ? ((row.units - prev.units) / prev.units) * 100 : null;
        }
        const trendScore = (row.units / maxUnits) * 100;
        const compareUnits =
          opts.compare === "yoy" ? priorYearUnits : index > 0 ? rows[index - 1].units : 0;
        const priorTrendScore = compareUnits > 0 ? (compareUnits / maxUnits) * 100 : null;
        const trendDelta = priorTrendScore !== null ? trendScore - priorTrendScore : null;
        return { ...row, priorYearUnits, pctGrowth, trendScore, trendDelta };
      });
    };

    const currentFyMomSeries = buildFyMomSeries(currentFyStart, currentFyMonthIndex, {
      highlightCurrentMonth: true,
      compare: "yoy",
    });
    const previousFyMomSeries = buildFyMomSeries(previousFyStart, 12, {
      highlightCurrentMonth: false,
      compare: "sequential",
    });

    return {
      currentFyStart,
      previousFyStart,
      currentFyTotal,
      previousFyTotal,
      fyLine,
      currentFyMomSeries,
      previousFyMomSeries,
      currentFyMonthIndex,
      sales,
      kpiMtdUnits: snapshotMonthYm
        ? monthUnitsForChart(snapshotMonthYm, monthlyMap.get(snapshotMonthYm) ?? 0)
        : 0,
      kpiAprUnits: previousSnapshotMonthYm
        ? monthUnitsForChart(
            previousSnapshotMonthYm,
            monthlyMap.get(previousSnapshotMonthYm) ?? 0,
          )
        : 0,
    };
  }, [monthlyRows, latestMetric, isQcom, marketplace]);

  if (isLoading) return <InlineLoader text="Loading Sellout & Growth..." />;
  if (error) return <EmptyState title="Unable to load data" description={error} />;
  if (!product) {
    return (
      <EmptyState
        title="Product not found"
        description={
          isQcom
            ? "No match on this channel. Search by ASIN, channel listing code (Item ID / PVID), or model name after uploading the latest Quick Commerce master."
            : "This product code is not in the latest uploaded master."
        }
      />
    );
  }

  if (!insights) {
    return (
      <EmptyState
        title="No sellout history"
        description={
          isQcom
            ? "No daily sellout rows or KPI metrics for this listing in the latest channel upload. Re-upload the master workbook and confirm the Consolidated tab links this ASIN to the channel listing."
            : "No monthly rows for this model in uploaded data. Upload the master sellout file for this channel."
        }
      />
    );
  }

  const snapshotAsOf =
    latestMetric?.as_of_date != null ? new Date(`${latestMetric.as_of_date}T12:00:00`) : null;
  const avgMonthlySellout =
    insights.currentFyMonthIndex > 0
      ? insights.currentFyTotal / insights.currentFyMonthIndex
      : 0;
  const currentMonthMtd = isQcom
    ? (insights.kpiMtdUnits ?? 0)
    : (latestMetric?.may_mtd_units ?? 0);
  const previousMonthSo = isQcom
    ? (insights.kpiAprUnits ?? 0)
    : (latestMetric?.apr_so_units ?? 0);
  const kpiMtdMonthLabel = snapshotAsOf
    ? snapshotAsOf.toLocaleString("en-US", { month: "short" })
    : new Date().toLocaleString("en-US", { month: "short" });
  const kpiPrevMonthLabel = snapshotAsOf
    ? new Date(snapshotAsOf.getFullYear(), snapshotAsOf.getMonth() - 1, 1).toLocaleString("en-US", {
        month: "short",
      })
    : (() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return d.toLocaleString("en-US", { month: "short" });
      })();
  const currentMonthName = new Date().toLocaleString("en-US", { month: "short" });
  const fyAttainmentVsPriorFullFyPct =
    insights.previousFyTotal > 0
      ? (insights.currentFyTotal / insights.previousFyTotal) * 100
      : null;
  const peakCurrentFyTillDate = insights.fyLine
    .slice(0, insights.currentFyMonthIndex)
    .reduce(
      (best, row) => {
        const units = Number(row.currentFy ?? 0);
        return units > best.units ? { month: row.month, units } : best;
      },
      { month: "Apr", units: 0 },
    );
  const currentMonthLabel = FY_MONTHS[insights.currentFyMonthIndex - 1] ?? currentMonthName;
  const currentMonthGrowthVsPrevious =
    (() => {
      const monthRow = insights.fyLine[insights.currentFyMonthIndex - 1];
      if (!monthRow || monthRow.currentFy === null || monthRow.previousFy <= 0) return null;
      return ((monthRow.currentFy - monthRow.previousFy) / monthRow.previousFy) * 100;
    })();
  const currentMomSeries = insights.currentFyMomSeries;
  const previousFyMomSeries = insights.previousFyMomSeries;
  const currentFyLabel = `FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)}`;
  const previousFyLabel = `FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)}`;
  const latestMom = currentMomSeries.length ? currentMomSeries[currentMomSeries.length - 1] : null;
  const momRangeStart = currentMomSeries[0]?.label ?? "N/A";
  const momRangeEnd = currentMomSeries[currentMomSeries.length - 1]?.label ?? "N/A";
  const momComparable = currentMomSeries.filter(
    (row): row is (typeof currentMomSeries)[number] & { pctGrowth: number } =>
      row.pctGrowth !== null,
  );
  const highestMom = momComparable.length
    ? momComparable.reduce((best, row) => (row.pctGrowth > best.pctGrowth ? row : best), momComparable[0])
    : null;
  const highestMomMonthText = highestMom ? highestMom.label : "N/A";
  const bestSelloutMonthFromMom = currentMomSeries.reduce(
    (best, row) => (row.units > best.units ? row : best),
    currentMomSeries[0],
  );
  const positiveMomMonths = momComparable.filter((row) => row.pctGrowth > 0).length;
  const snapshotDayLabel = snapshotAsOf ? snapshotAsOf.getDate() : null;
  const negativeStreak = (() => {
    let streak = 0;
    for (let i = currentMomSeries.length - 1; i >= 0; i -= 1) {
      const value = currentMomSeries[i].pctGrowth;
      if (value !== null && value < 0) streak += 1;
      else break;
    }
    return streak;
  })();

  const trendData = insights.fyLine.map((row, index) => {
    const currentFy = row.currentFy;
    const previousFy = row.previousFy;
    const yoyGrowthPct =
      currentFy !== null && previousFy > 0 ? ((currentFy - previousFy) / previousFy) * 100 : null;
    return {
      ...row,
      isMtdPoint: index + 1 === insights.currentFyMonthIndex,
      currentFyDisplay: currentFy ?? 0,
      yoyGrowthPct,
    };
  });

  const customTooltip = ({ active, payload, label }: { active?: boolean; payload?: ReadonlyArray<{ payload?: { currentFy: number | null; previousFy: number; yoyGrowthPct: number | null } }>; label?: string | number; }) => {
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
          <span className="font-extrabold tabular-nums text-zinc-950">{formatInteger(data.previousFy)} units</span>
        </p>
        <p className="mt-1 text-sm font-semibold text-zinc-700">
          Current FY:{" "}
          <span className="font-extrabold tabular-nums text-zinc-950">
            {data.currentFy === null ? "N/A" : `${formatInteger(data.currentFy)} units`}
          </span>
        </p>
        {data.yoyGrowthPct !== null ? (
          <p className="mt-2 text-sm font-semibold text-zinc-700">
            YoY growth:{" "}
            <span className={data.yoyGrowthPct >= 0 ? "font-extrabold text-emerald-600" : "font-extrabold text-rose-600"}>
              {data.yoyGrowthPct >= 0 ? "+" : ""}
              {formatDecimal(data.yoyGrowthPct)}%
            </span>
          </p>
        ) : null}
      </div>
    );
  };

  const chartLegendFormatter = (value: string) => (
    <span className="text-sm font-semibold text-zinc-700">{value}</span>
  );

  const activeCode = product.product_code;
  const qcomCanonical =
    isQcom && /^B0[A-Z0-9]{8,}$/i.test(activeCode)
      ? activeCode.toUpperCase()
      : isQcom && forcedProductCode
        ? (/^B0[A-Z0-9]{8,}$/i.test(forcedProductCode)
            ? forcedProductCode.toUpperCase()
            : forcedProductCode.trim())
        : "";
  const hubPath = isQcom
    ? qcomProductHubPath(qcomCanonical || activeCode)
    : erpProductId
      ? productIdHubPath(erpProductId, routePrefix)
      : productWorkspacePath(marketplace, activeCode, undefined, routePrefix);

  return (
    <div className="space-y-8 rounded-3xl border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-white p-6 text-zinc-900 shadow-xl">
      <Link
        to={
          qcomBackPath ??
          (qcomFromAnalysis || (isQcom && fromAnalysis)
            ? qcomCategoryAnalysisListPath()
            : fromAnalysis
              ? `${routePrefix}/analysis/sellout-lookup`
              : hubPath)
        }
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {qcomBackPath
          ? qcomBackPath.includes("/qcom/product/")
            ? "Back to Model Workspace"
            : "Back to channel dashboard"
          : isQcom && fromAnalysis
            ? "Back to Category analysis"
            : fromAnalysis
              ? "Back to Sellout & growth analysis"
              : "Back to Model Workspace"}
      </Link>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
            {isQcom ? `${marketplaceLabel(marketplace)} · Sellout Intelligence` : "Sellout Intelligence"}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            Product: {displayModelName(product.product_name, product.product_code)}
          </h1>
          <p className="mt-2 text-sm font-medium leading-relaxed text-zinc-500">
            {isQcom
              ? "Same charts as marketplace sellout & growth — FY trend, MoM bars, and KPI cards from quick commerce daily sellout."
              : "Monitor growth, momentum and financial year sellout trends."}
          </p>
          {product.category ? (
            <p className="mt-1 text-sm font-semibold text-violet-700">Category: {product.category}</p>
          ) : null}

          <div className="mt-4">
            {isQcom && qcomWorkspace ? (
              <QcomChannelToggle
                workspace={qcomWorkspace}
                productCode={product.product_code}
                canonicalProductCode={qcomCanonical || undefined}
                peers={qcomPeers}
                peersLoading={qcomPeersLoading}
                workspaceSuffix="sellout-growth"
              />
            ) : (
              <ProductChannelToggle
                erpProductId={erpProductId ?? channelPeers?.erpProductId}
                marketplace={marketplace}
                productCode={product.product_code}
                peers={channelPeers}
                peersLoading={peersLoading}
                suffix="sellout-growth"
              />
            )}
          </div>
        </div>
        {latestMetric?.as_of_date ? <DataAsOnBadge isoDate={latestMetric.as_of_date} className="self-start" /> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label={`FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)} Total SO`}
          value={formatInteger(insights.previousFyTotal)}
          variant="violet"
        />
        <StatCard
          label={`FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)} Total SO (Till Date)`}
          value={formatInteger(insights.currentFyTotal)}
          variant="violet"
          hint={`Current FY month: ${insights.currentFyMonthIndex} of 12`}
        />
        <StatCard
          label={`Current Month MTD (${kpiMtdMonthLabel})`}
          value={formatInteger(currentMonthMtd)}
          variant="emerald"
        />
        <StatCard
          label={`Previous Month SO (${kpiPrevMonthLabel})`}
          value={formatInteger(previousMonthSo)}
          variant="amber"
        />
        <StatCard
          label="Average Monthly SO (Till Date)"
          value={formatInteger(avgMonthlySellout)}
          variant="sky"
        />
      </div>

      <Card id="fy-sellout-trend" className="scroll-mt-6 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-zinc-900">Financial Year Sellout Trend</h3>
            <p className="mt-1 text-sm font-medium text-zinc-500">
              Monthly sellout — current FY vs prior FY.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-zinc-700">
              Units
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold text-zinc-800">
              <CalendarDays className="h-3.5 w-3.5" />
              FY {insights.currentFyStart}-{String(insights.currentFyStart + 1).slice(-2)}
            </span>
          </div>
        </div>
        <div className="h-[380px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="currentFyArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CURRENT_FY_COLOR} stopOpacity={0.26} />
                  <stop offset="95%" stopColor={CURRENT_FY_COLOR} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip content={customTooltip} />
              <Legend formatter={chartLegendFormatter} wrapperStyle={CHART_LEGEND_STYLE} />
              <Area
                type="natural"
                dataKey="currentFyDisplay"
                name={`Current FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)}`}
                stroke="none"
                fill="url(#currentFyArea)"
                legendType="none"
              />
              <Line
                type="natural"
                dataKey="previousFy"
                name={`Previous FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)}`}
                stroke={PREVIOUS_FY_COLOR}
                strokeDasharray="5 5"
                strokeWidth={2.2}
                dot={{ r: 3, fill: PREVIOUS_FY_COLOR, stroke: "#ffffff", strokeWidth: 1.2 }}
                activeDot={{ r: 4 }}
              />
              <Line
                type="natural"
                dataKey="currentFy"
                name={`Current FY ${insights.currentFyStart}-${String(insights.currentFyStart + 1).slice(-2)}`}
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
        <div className="mt-4 flex flex-col gap-4">
          <FyAttainmentSummaryCard
            pct={fyAttainmentVsPriorFullFyPct}
            tillLabel={`Till ${currentMonthLabel} ${insights.currentFyStart + (insights.currentFyMonthIndex >= 10 ? 1 : 0)}`}
            previousFyRangeLabel={`FY ${insights.previousFyStart}-${String(insights.previousFyStart + 1).slice(-2)}`}
            previousFyTotalUnits={insights.previousFyTotal}
            currentYtdUnits={insights.currentFyTotal}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <MiniInsightCard
              variant="emphasis"
              label="Avg Monthly Sellout"
              value={formatInteger(avgMonthlySellout)}
              sub="Current FY till date"
            />
            <MiniInsightCard
              variant="emphasis"
              label="Peak Month (Current FY till date)"
              value={peakCurrentFyTillDate.month}
              sub={`${formatInteger(peakCurrentFyTillDate.units)} units`}
              icon={<TrendingUp className="h-5 w-5 text-violet-600" />}
            />
          </div>
        </div>
        <p className="mt-4 text-sm font-medium text-zinc-500">
          {currentMonthLabel} MTD · lighter marker
          {currentMonthGrowthVsPrevious !== null
            ? ` · YoY ${currentMonthGrowthVsPrevious >= 0 ? "+" : ""}${formatDecimal(currentMonthGrowthVsPrevious)}%`
            : ""}
        </p>
      </Card>

      {currentMomSeries.length > 0 && snapshotAsOf ? (
        <SelloutMtdSection
          series={currentMomSeries}
          reportSnapshotDate={latestMetric?.as_of_date ?? null}
          lastMonthUnits={
            currentMomSeries.length >= 2
              ? currentMomSeries[currentMomSeries.length - 2].units
              : insights.kpiAprUnits
          }
          lastMonthLabel={
            currentMomSeries.length >= 2
              ? currentMomSeries[currentMomSeries.length - 2].label
              : kpiPrevMonthLabel
          }
        />
      ) : null}

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1">
              <h3 className="text-lg font-bold tracking-tight text-zinc-900">Month on Month (MoM) Growth</h3>
              <CircleHelp className="h-5 w-5 text-zinc-500" />
            </div>
            <p className="mt-1 text-sm font-medium text-zinc-500">
              Current FY months vs the same calendar month last year. Ongoing month compares MTD
              through day {snapshotDayLabel ?? "—"}.
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
              {momRangeStart}–{momRangeEnd} · {currentFyLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold text-zinc-800">
              {currentFyLabel}
            </span>
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-zinc-700">
              Units
            </span>
          </div>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MiniInsightCard
            label={`Latest Month (${currentMonthLabel} MTD)`}
            value={formatInteger(Number(latestMom?.units ?? currentMonthMtd))}
            sub={
              latestMom?.pctGrowth !== null && latestMom?.pctGrowth !== undefined
                ? `YoY ${formatDecimal(latestMom.pctGrowth)}%`
                : "No prior-year baseline"
            }
            icon={<TrendingUp className="h-4 w-4 text-violet-500" />}
          />
          <MiniInsightCard
            label="Highest YoY Growth"
            value={highestMom ? `${highestMom.pctGrowth >= 0 ? "+" : ""}${formatDecimal(highestMom.pctGrowth)}%` : "N/A"}
            sub={highestMomMonthText}
            positive={highestMom ? highestMom.pctGrowth >= 0 : undefined}
          />
          <MiniInsightCard
            label="Highest Sellout Month"
            value={formatInteger(bestSelloutMonthFromMom.units)}
            sub={bestSelloutMonthFromMom.label}
            icon={<Sparkles className="h-4 w-4 text-amber-500" />}
          />
          <MiniInsightCard
            label="Avg Monthly Sellout"
            value={formatInteger(
              currentMomSeries.reduce((sum, row) => sum + row.units, 0) / Math.max(1, currentMomSeries.length),
            )}
            sub={currentFyLabel}
          />
          <MiniInsightCard
            label="Positive YoY Months"
            value={`${positiveMomMonths} / ${momComparable.length}`}
            sub="Months"
            icon={<TrendingDown className="h-4 w-4 text-fuchsia-500" />}
          />
        </div>

        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={currentMomSeries}>
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
                        pctGrowth?: number | null;
                        priorYearUnits?: number;
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
                            · MTD
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-zinc-700">
                        Sellout units:{" "}
                        <span className="font-extrabold tabular-nums text-zinc-950">
                          {formatInteger(Number(row.units ?? 0))}
                        </span>
                      </p>
                      {row.priorYearUnits !== undefined && row.priorYearUnits > 0 ? (
                        <p className="mt-1 text-sm font-semibold text-zinc-700">
                          Prior year (same period):{" "}
                          <span className="font-extrabold tabular-nums text-zinc-950">
                            {formatInteger(row.priorYearUnits)}
                          </span>
                        </p>
                      ) : null}
                      {row.pctGrowth !== null && row.pctGrowth !== undefined ? (
                        <p className="mt-1 text-sm font-semibold text-zinc-700">
                          YoY growth:{" "}
                          <span className={row.pctGrowth >= 0 ? "font-extrabold text-emerald-600" : "font-extrabold text-rose-600"}>
                            {row.pctGrowth >= 0 ? "+" : ""}
                            {formatDecimal(row.pctGrowth)}%
                          </span>
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm font-semibold text-zinc-700">
                        Trend index:{" "}
                        <span className="font-extrabold tabular-nums text-zinc-950">{formatDecimal(Number(row.trendScore ?? 0))}%</span>
                      </p>
                    </div>
                  );
                }}
              />
              <Legend formatter={chartLegendFormatter} wrapperStyle={CHART_LEGEND_STYLE} />
              <Bar yAxisId="left" dataKey="units" name="Sellout Units" radius={[6, 6, 0, 0]}>
                {currentMomSeries.map((row) => (
                  <Cell key={`mom-bar-${row.label}`} fill={row.barColor} />
                ))}
              </Bar>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="trendScore"
                name="Sellout Trend Index"
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

        <div className="mt-4 grid gap-2 text-sm font-medium text-zinc-600 md:grid-cols-2 xl:grid-cols-4">
          <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
            Best YoY: <strong>{highestMom ? `${formatDecimal(highestMom.pctGrowth)}%` : "—"}</strong>
            {highestMom ? <> · {highestMomMonthText}</> : null}
          </p>
          <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
            Peak units: <strong>{bestSelloutMonthFromMom.label}</strong> ·{" "}
            <strong>{formatInteger(bestSelloutMonthFromMom.units)}</strong>
          </p>
          <p className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2">
            {negativeStreak > 0 ? (
              <>
                <strong>{negativeStreak}</strong> consecutive negative YoY months
              </>
            ) : (
              <>No negative YoY streak</>
            )}
          </p>
          <p className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2">
            {currentMonthLabel} MTD vs same period last year
            {snapshotDayLabel ? ` (through day ${snapshotDayLabel})` : ""}
          </p>
        </div>
      </Card>

      {previousFyMomSeries.some((row) => row.units > 0) ? (
        <Card className="p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold tracking-tight text-zinc-900">
                Previous FY — Month on Month
              </h3>
              <p className="mt-1 text-sm font-medium text-zinc-500">
                Prior financial year from sheet month columns (Apr-25, May-25, …) — not the FY
                total spread evenly.
              </p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                {previousFyMomSeries[0]?.label ?? "N/A"}–
                {previousFyMomSeries[previousFyMomSeries.length - 1]?.label ?? "N/A"} ·{" "}
                {previousFyLabel}
              </p>
            </div>
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold text-zinc-800">
              {previousFyLabel}
            </span>
          </div>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={previousFyMomSeries}>
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
                      | { units?: number; pctGrowth?: number | null }
                      | undefined;
                    if (!row) return null;
                    return (
                      <div className="min-w-[200px] rounded-xl border-2 border-zinc-200 bg-white px-4 py-3 shadow-lg">
                        <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                          {String(label ?? "")}
                        </p>
                        <p className="mt-2 text-sm font-semibold text-zinc-700">
                          Units:{" "}
                          <span className="font-extrabold tabular-nums text-zinc-950">
                            {formatInteger(Number(row.units ?? 0))}
                          </span>
                        </p>
                        {row.pctGrowth !== null && row.pctGrowth !== undefined ? (
                          <p className="mt-1 text-sm font-semibold text-zinc-700">
                            MoM:{" "}
                            <span
                              className={
                                row.pctGrowth >= 0
                                  ? "font-extrabold text-emerald-600"
                                  : "font-extrabold text-rose-600"
                              }
                            >
                              {row.pctGrowth >= 0 ? "+" : ""}
                              {formatDecimal(row.pctGrowth)}%
                            </span>
                          </p>
                        ) : null}
                      </div>
                    );
                  }}
                />
                <Legend formatter={chartLegendFormatter} wrapperStyle={CHART_LEGEND_STYLE} />
                <Bar yAxisId="left" dataKey="units" name="Sellout Units" radius={[6, 6, 0, 0]}>
                  {previousFyMomSeries.map((row) => (
                    <Cell key={`prev-fy-bar-${row.label}`} fill={row.barColor} />
                  ))}
                </Bar>
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="trendScore"
                  name="Sellout Trend Index"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : latestMetric?.prior_fy_so_units && Number(latestMetric.prior_fy_so_units) > 0 ? (
        <Card className="border-dashed border-zinc-200 bg-zinc-50/80 p-5">
          <p className="text-sm font-semibold text-zinc-800">Previous FY month-on-month not available</p>
          <p className="mt-1 text-sm text-zinc-600">
            The master has an FY total ({formatInteger(Number(latestMetric.prior_fy_so_units))} units)
            but no Apr–Mar month columns for last year on this listing. Upload a file with monthly
            sellout columns, or check the correct ASIN/FSN row for this model.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function FyAttainmentSummaryCard({
  pct,
  tillLabel,
  previousFyRangeLabel,
  previousFyTotalUnits,
  currentYtdUnits,
}: {
  pct: number | null;
  tillLabel: string;
  previousFyRangeLabel: string;
  previousFyTotalUnits: number;
  currentYtdUnits: number;
}) {
  return (
    <div className="rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-100/90 via-white to-violet-50/50 px-5 py-5 shadow-md ring-1 ring-violet-200/60">
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-900">
        FY vs prior full year
      </p>
      <div className="mt-5 space-y-4 border-t-2 border-violet-200/80 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-zinc-900">Prior FY total</p>
            <p className="mt-0.5 text-sm font-semibold text-zinc-600">{previousFyRangeLabel}</p>
          </div>
          <span className="text-lg font-extrabold tabular-nums text-zinc-950">
            {formatInteger(previousFyTotalUnits)} units
          </span>
        </div>
        <div className="border-t border-violet-200/60 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 gap-y-1">
            <span className="text-base font-bold text-zinc-900">Current FY YTD</span>
            <span className="text-lg font-extrabold tabular-nums text-zinc-950">
              {formatInteger(currentYtdUnits)} units
            </span>
          </div>
          <p className="mt-2 text-sm font-bold text-zinc-700">{tillLabel}</p>
        </div>
        <p className="text-lg font-extrabold leading-snug text-zinc-950">
          {pct !== null ? (
            <>
              YTD at <span className="text-violet-800 tabular-nums">{formatDecimal(pct)}%</span> of prior FY
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
  variant = "default",
}: {
  label: string;
  value: string;
  sub: string;
  icon?: React.ReactNode;
  positive?: boolean;
  variant?: "default" | "emphasis";
}) {
  const emphasis = variant === "emphasis";
  return (
    <div
      className={cn(
        "rounded-2xl border shadow-sm",
        emphasis
          ? "border-2 border-zinc-300 bg-white px-5 py-5 shadow-md ring-1 ring-zinc-200/80"
          : "border border-zinc-200 bg-zinc-50/80 px-4 py-3",
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p
          className={cn(
            "font-bold uppercase tracking-wide",
            emphasis ? "text-xs leading-tight text-zinc-900" : "text-[11px] leading-tight text-zinc-700",
          )}
        >
          {label}
        </p>
        {icon}
      </div>
      <p
        className={cn(
          "leading-tight tabular-nums",
          emphasis ? "text-3xl font-extrabold" : "text-2xl font-extrabold",
          positive === undefined ? "text-zinc-900" : positive ? "text-emerald-600" : "text-rose-600",
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          "mt-2",
          emphasis ? "text-sm font-bold text-zinc-800" : "text-xs font-semibold text-zinc-600",
        )}
      >
        {sub}
      </p>
    </div>
  );
}
