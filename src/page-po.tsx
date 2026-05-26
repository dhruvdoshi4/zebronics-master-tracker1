import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ChevronDown,
  FileText,
  Gauge,
  ImageIcon,
  Info,
  LineChart,
  Package,
  Settings,
  Sparkles,
} from "lucide-react";
import {
  getLatestMetricForProduct,
  lookupProductMasterByCode,
  resolveProductContextByErpId,
} from "./data";
import { fetchHoStockUnits, type HoStockUnits } from "./ho-stock-snapshot-query";
import { displayModelName } from "./product-display";
import {
  ProductChannelToggle,
  productIdHubPath,
  productWorkspacePath,
  useProductChannelPeers,
} from "./product-channel";
import { getSubCategoryLabel, type ComputedMetric, type Marketplace, type ProductMaster } from "./types";
import { DataAsOnBadge, EmptyState, InlineLoader } from "./ui";
import { formatDecimal, formatInteger } from "./utils";

import {
  PO_COVERAGE_TARGET_DAYS,
  computeRecommendedPoUnits,
  poDrrForProjection,
} from "./metrics";

const COVERAGE_TARGET_DAYS = PO_COVERAGE_TARGET_DAYS;
const BAR_MAX_DAYS = 90;

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

function getMonthLabels(referenceDate: string) {
  const d = new Date(`${referenceDate}T00:00:00`);
  const current = d.toLocaleString("en-US", { month: "short" });
  d.setMonth(d.getMonth() - 1);
  const previous = d.toLocaleString("en-US", { month: "short" });
  return { current, previous };
}

/** Best-effort detail line from master fields + name (e.g. size / color in parentheses). */
function productSpecLine(product: ProductMaster): string {
  const skuType = getSubCategoryLabel(product.sub_category) || product.category || "—";
  const colorMatch = product.product_name.match(/\(([^)]+)\)\s*$/);
  const color = colorMatch ? colorMatch[1].trim() : null;
  const inchMatch = product.product_name.match(/(\d+)\s*(?:inch|Inch|")\b/i);
  const size = inchMatch ? `${inchMatch[1]} Inch` : null;
  const parts = [
    `SKU Type: ${skuType}`,
    size ? `Screen Size: ${size}` : null,
    color ? `Color: ${color}` : null,
  ].filter(Boolean);
  return parts.join(" • ");
}

function coverageStatus(docDays: number, shortage: number): { label: string; tone: "ok" | "watch" | "low" | "crit" } {
  if (shortage <= 0) {
    return { label: "On target", tone: "ok" };
  }
  if (docDays >= 35) return { label: "Moderate", tone: "watch" };
  if (docDays >= 18) return { label: "Low cover", tone: "low" };
  return { label: "Critical", tone: "crit" };
}

export function ProductPoPage() {
  const params = useParams<{
    productId?: string;
    marketplace?: string;
    code?: string;
  }>();
  const erpProductId = params.productId;
  const marketplace = (params.marketplace as Marketplace) ?? "amazon";
  const productCode = params.code ?? "";
  const [product, setProduct] = useState<ProductMaster | null>(null);
  const [metric, setMetric] = useState<ComputedMetric | null>(null);
  const [hoStock, setHoStock] = useState<HoStockUnits | null>(null);
  const [hoStockLoading, setHoStockLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { peers, loading: peersLoading } = useProductChannelPeers(
    marketplace,
    product?.product_code,
    product?.product_name,
  );

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    if (erpProductId) {
      void resolveProductContextByErpId(erpProductId)
        .then(async (ctx) => {
          if (!ctx) throw new Error("Product ID not found in HO stock report.");
          const listing =
            marketplace === "amazon" ? ctx.amazon : ctx.flipkart;
          if (!listing) {
            throw new Error(
              `No ${marketplace === "amazon" ? "Amazon" : "Flipkart"} listing for this product ID.`,
            );
          }
          const metricRow = await getLatestMetricForProduct(
            marketplace,
            listing.product_code,
          );
          setProduct(listing);
          setMetric(metricRow);
        })
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : "Failed to load PO details."),
        )
        .finally(() => setIsLoading(false));
      return;
    }

    void Promise.all([
      lookupProductMasterByCode(marketplace, productCode),
      getLatestMetricForProduct(marketplace, productCode),
    ])
      .then(([productRow, metricRow]) => {
        setProduct(productRow);
        setMetric(metricRow);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load PO details."),
      )
      .finally(() => setIsLoading(false));
  }, [erpProductId, marketplace, productCode]);

  useEffect(() => {
    if (!product) {
      setHoStock(null);
      return;
    }
    setHoStockLoading(true);
    void fetchHoStockUnits({
      erpProductId: erpProductId ?? peers?.erpProductId,
      marketplace:
        marketplace === "amazon" || marketplace === "flipkart" ? marketplace : undefined,
      productCode: product.product_code,
    })
      .then(setHoStock)
      .catch(() => setHoStock(null))
      .finally(() => setHoStockLoading(false));
  }, [product, erpProductId, peers?.erpProductId, marketplace]);

  const monthLabels = useMemo(
    () => getMonthLabels(metric?.as_of_date ?? new Date().toISOString().slice(0, 10)),
    [metric?.as_of_date],
  );

  if (isLoading) return <InlineLoader text="Loading PO details..." />;
  if (error) return <EmptyState title="Unable to load PO details" description={error} />;
  if (!product || !metric) {
    return (
      <EmptyState
        title="No PO data available"
        description="Upload the latest marketplace sheet."
      />
    );
  }

  const drrForPo = poDrrForProjection(metric);
  const targetStock = drrForPo * COVERAGE_TARGET_DAYS;
  const po = computeRecommendedPoUnits(drrForPo, metric.inventory_units);
  const codeLabel = getCodeLabel(marketplace);
  const channelLabel = marketplace === "amazon" ? "Amazon" : "Flipkart";
  const categoryLabel = getSubCategoryLabel(product.sub_category) || product.category || "—";
  const status = coverageStatus(metric.doc_days, po);
  const markerPct = Math.min(100, Math.max(0, (metric.doc_days / BAR_MAX_DAYS) * 100));

  const statusStyles = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
    watch: "border-amber-200 bg-amber-50 text-amber-900",
    low: "border-orange-200 bg-orange-50 text-orange-900",
    crit: "border-rose-200 bg-rose-50 text-rose-900",
  } as const;

  const activeCode = product.product_code;
  const hubPath = erpProductId
    ? productIdHubPath(erpProductId)
    : productWorkspacePath(marketplace, activeCode);

  return (
    <div className="space-y-6 pb-10">
      <Link
        to={hubPath}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to workspace
      </Link>

      <header className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
            {channelLabel} · PO Check
          </h1>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-zinc-500">
            Track inventory, sellout, stock coverage and recommended PO.
            <br />
            Live inventory and replenishment intelligence for this SKU.
          </p>
          <div className="mt-4">
            <ProductChannelToggle
              erpProductId={erpProductId ?? peers?.erpProductId}
              marketplace={marketplace}
              productCode={product.product_code}
              peers={peers}
              peersLoading={peersLoading}
              suffix="po"
            />
          </div>
        </div>
        <DataAsOnBadge isoDate={metric.as_of_date} />
      </header>

      {/* Product strip */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-5 md:flex-row md:items-start">
          <div className="flex h-36 w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-50 to-zinc-100 sm:h-40 sm:w-40">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.product_name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-1 text-xs font-medium text-zinc-400">
                <ImageIcon className="h-8 w-8" />
                No image
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                {codeLabel}: {product.product_code}
              </span>
              <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-800">
                {channelLabel}
              </span>
              <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-bold text-violet-800">
                Category: {categoryLabel}
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-bold leading-tight text-zinc-900 sm:text-3xl">
              {displayModelName(product.product_name, product.product_code)}
            </h2>
            <p className="mt-3 text-sm font-semibold text-zinc-700">{productSpecLine(product)}</p>
            {hoStockLoading ? (
              <p className="mt-4 text-xs font-medium text-zinc-500">Loading HO stock…</p>
            ) : hoStock ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900">
                  <Package className="h-4 w-4 shrink-0 text-emerald-600" />
                  HO: {formatInteger(hoStock.ho_units)} units
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-bold text-sky-900">
                  <Package className="h-4 w-4 shrink-0 text-sky-600" />
                  Gurgaon: {formatInteger(hoStock.gurgaon_units)} units
                </span>
                {hoStock.snapshotDate ? (
                  <span className="text-xs font-medium text-zinc-500">
                    From HO stock report · {hoStock.snapshotDate}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {/* Left column */}
        <div className="space-y-6">
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">
              Inventory health
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SmallStat
                icon={<Package className="h-5 w-5 text-sky-600" />}
                label="Inventory"
                value={`${formatInteger(metric.inventory_units)} units`}
                accent="sky"
              />
              <SmallStat
                icon={<CalendarDays className="h-5 w-5 text-sky-600" />}
                label="DOC"
                value={`${formatDecimal(metric.doc_days)} days`}
                accent="sky"
              />
              <SmallStat
                icon={<Gauge className="h-5 w-5 text-sky-600" />}
                label="28 days avg"
                value={`${formatDecimal(drrForPo)} units/day`}
                accent="sky"
              />
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">
              Demand snapshot
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SmallStat
                icon={<LineChart className="h-5 w-5 text-violet-600" />}
                label={`${monthLabels.current} MTD`}
                value={`${formatInteger(metric.may_mtd_units)} units`}
                accent="violet"
              />
              <SmallStat
                icon={<FileText className="h-5 w-5 text-violet-600" />}
                label={`${monthLabels.previous} SO`}
                value={`${formatInteger(metric.apr_so_units)} units`}
                accent="violet"
              />
              <SmallStat
                icon={<BarChart3 className="h-5 w-5 text-violet-600" />}
                label="Total SO"
                value={`${formatInteger(metric.total_so_units)} units`}
                accent="violet"
              />
            </div>
          </div>
        </div>

        {/* Recommended PO */}
        <section className="rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6 shadow-md ring-1 ring-amber-100">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-amber-900">
                Recommended purchase order
              </span>
            </div>
            <span
              className={`rounded-full border px-3 py-1 text-xs font-bold ${statusStyles[status.tone]}`}
            >
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-current opacity-80" />
              {status.label}
            </span>
          </div>

          <p className="mt-6 text-center text-5xl font-extrabold tabular-nums text-amber-700 sm:text-6xl">
            {formatInteger(po)}
            <span className="ml-2 text-2xl font-bold text-amber-600/90">units</span>
          </p>
          <p className="mt-2 text-center text-sm font-medium text-amber-900/85">
            Gap to {COVERAGE_TARGET_DAYS}-day cover at 28-day avg DRR.
          </p>

          <div className="mt-8 grid grid-cols-3 gap-3 border-t border-amber-200/80 pt-6 text-center">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Target stock</p>
              <p className="mt-1 text-lg font-extrabold text-zinc-900">{formatInteger(targetStock)}</p>
              <p className="text-[11px] font-medium text-zinc-500">units</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Shortage (gap)</p>
              <p className="mt-1 text-lg font-extrabold text-rose-600">{formatInteger(po)}</p>
              <p className="text-[11px] font-medium text-zinc-500">units</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Coverage left</p>
              <p className="mt-1 text-lg font-extrabold text-emerald-700">{formatDecimal(metric.doc_days)}</p>
              <p className="text-[11px] font-medium text-zinc-500">days</p>
            </div>
          </div>

          <div className="mt-8">
            <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-zinc-500">
              <span>Stock coverage (sheet DOC)</span>
              <span className="tabular-nums text-zinc-800">
                {formatDecimal(metric.doc_days)} / {COVERAGE_TARGET_DAYS} days
              </span>
            </div>
            <div className="relative">
              <div className="h-3 w-full overflow-hidden rounded-full bg-gradient-to-r from-emerald-200 via-amber-100 to-orange-200">
                <div
                  className="absolute top-0 h-full w-1 rounded-full bg-zinc-900 shadow-sm ring-2 ring-white"
                  style={{ left: `calc(${markerPct}% - 2px)` }}
                  title={`${formatDecimal(metric.doc_days)} days`}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] font-semibold text-zinc-500">
                <span>0</span>
                <span className="text-zinc-700">{COVERAGE_TARGET_DAYS} days (target)</span>
                <span>{BAR_MAX_DAYS} days</span>
              </div>
            </div>
          </div>

          <details className="group mt-6 rounded-xl border border-amber-200/80 bg-white/60">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-amber-950 [&::-webkit-details-marker]:hidden">
              How is PO calculated?
              <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-amber-100 px-4 pb-4 pt-2 text-sm font-medium leading-relaxed text-zinc-700">
              <p>
                We target <strong>{COVERAGE_TARGET_DAYS} days</strong> of cover at the sheet{" "}
                <strong>28 Days Avg</strong>. Recommended PO = max(0, 28-day avg ×{" "}
                {COVERAGE_TARGET_DAYS} − on-hand inventory).
              </p>
              <p className="mt-2 font-mono text-xs text-zinc-600">
                max(0, {formatDecimal(drrForPo)} × {COVERAGE_TARGET_DAYS} −{" "}
                {formatInteger(metric.inventory_units)}) = {formatInteger(po)}
              </p>
            </div>
          </details>
        </section>
      </div>

      <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-950">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
        <p>
          {COVERAGE_TARGET_DAYS}-day cover · 28-day avg{" "}
          <strong className="font-semibold">{formatDecimal(drrForPo)}</strong> units/day
          {metric.drr_28d_avg_units && metric.drr_units !== drrForPo ? (
            <>
              {" "}
              (sheet DRR {formatDecimal(metric.drr_units)})
            </>
          ) : null}
        </p>
      </div>

      <details className="group rounded-xl border border-zinc-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-sm font-bold text-zinc-900 [&::-webkit-details-marker]:hidden">
          <Settings className="h-4 w-4 text-zinc-500" />
          <div className="flex-1">
            <span>Advanced details</span>
            <p className="mt-0.5 text-xs font-medium text-zinc-500">
              Formula · uploaded PO · notes
            </p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400 transition group-open:rotate-180" />
        </summary>
        <div className="space-y-3 border-t border-zinc-100 px-5 py-4 text-sm text-zinc-700">
          <p>
            <span className="font-semibold text-zinc-900">Uploaded PO column:</span>{" "}
            {formatInteger(metric.purchase_order_units)} units
          </p>
          <p>
            <span className="font-semibold text-zinc-900">Computed PO (this page):</span>{" "}
            {formatInteger(po)} units
          </p>
          <p className="text-xs text-zinc-500">PO history / warehouse split not shown here.</p>
        </div>
      </details>
    </div>
  );
}

function SmallStat({
  icon,
  label,
  value,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accent: "sky" | "violet";
}) {
  const ring = accent === "sky" ? "border-sky-100 bg-sky-50/50" : "border-violet-100 bg-violet-50/50";
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${ring}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</span>
        {icon}
      </div>
      <p className="text-xl font-extrabold tabular-nums text-zinc-900">{value}</p>
    </div>
  );
}
