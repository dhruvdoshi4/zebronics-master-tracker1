import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ImageIcon, Sparkles } from "lucide-react";
import { getLatestMetricForProduct, getProductByCode } from "./data";
import type { ComputedMetric, Marketplace, ProductMaster } from "./types";
import { Card, EmptyState, InlineLoader, PageTitle } from "./ui";
import { formatDecimal, formatInteger } from "./utils";

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

export function ProductPoPage() {
  const params = useParams<{ marketplace: string; code: string }>();
  const marketplace = (params.marketplace as Marketplace) ?? "amazon";
  const productCode = params.code ?? "";
  const [product, setProduct] = useState<ProductMaster | null>(null);
  const [metric, setMetric] = useState<ComputedMetric | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void Promise.all([
      getProductByCode(marketplace, productCode),
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
  }, [marketplace, productCode]);

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
        description="Upload the latest sheet and try again."
      />
    );
  }

  const po = Math.max(0, metric.drr_units * 45 - metric.inventory_units);
  const codeLabel = getCodeLabel(marketplace);

  return (
    <div className="space-y-6">
      <Link
        to={`/app/product/${marketplace}/${encodeURIComponent(productCode)}`}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to workspace
      </Link>

      <PageTitle
        title={`${marketplace === "amazon" ? "Amazon" : "Flipkart"} · PO Check`}
        subtitle="PO numbers are separate per channel (different SKUs). MTD and previous month SO follow your upload date."
      />

      <Card className="grid gap-5 md:grid-cols-[180px_1fr]">
        <div className="flex h-44 w-44 items-center justify-center overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-50 to-zinc-100 text-zinc-400 dark:border-zinc-700 dark:from-zinc-900 dark:to-zinc-950">
          {product.image_url ? (
            <img src={product.image_url} alt={product.product_name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-xs text-zinc-400">
              <ImageIcon className="h-6 w-6" />
              No Image
            </div>
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
              {codeLabel}
            </span>
            <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
              {product.product_code}
            </span>
          </div>
          <h3 className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            {product.product_name}
          </h3>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="Inventory" value={formatInteger(metric.inventory_units)} />
            <Metric label="Total SO" value={formatInteger(metric.total_so_units)} />
            <Metric label="DOC" value={`${formatDecimal(metric.doc_days)} days`} />
            <Metric
              label={`${monthLabels.current} MTD`}
              value={formatInteger(metric.may_mtd_units)}
            />
            <Metric
              label={`${monthLabels.previous} SO`}
              value={formatInteger(metric.apr_so_units)}
            />
            <Metric label="DRR" value={formatDecimal(metric.drr_units)} hint="units/day" />
          </div>
        </div>
      </Card>

      <Card className="border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:border-amber-800/70 dark:from-amber-950/40 dark:via-zinc-900 dark:to-orange-950/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-300" />
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Purchase Order Recommendation
              </p>
            </div>
            <p className="mt-2 text-5xl font-bold text-amber-700 dark:text-amber-200">
              {formatInteger(po)}
              <span className="ml-1 text-base font-medium text-amber-600 dark:text-amber-300">
                units
              </span>
            </p>
            <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-200/80">
              Target stock = {formatInteger(metric.drr_units * 45)} units (DRR x 45)
            </p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-white/70 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-zinc-900/40 dark:text-amber-100">
            <p>
              <span className="font-semibold">Formula:</span> max(0, DRR x 45 - Inventory)
            </p>
            <p className="mt-1 font-mono text-[11px]">
              max(0, {formatDecimal(metric.drr_units)} x 45 - {formatInteger(metric.inventory_units)}) = {formatInteger(po)}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {hint ? <p className="text-[11px] text-zinc-500">{hint}</p> : null}
    </div>
  );
}
