import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Activity, Box, ClipboardList } from "lucide-react";
import { getLatestMetricForProduct, getProductByCode } from "./data";
import { displayModelName } from "./product-display";
import type { Marketplace, ProductMaster } from "./types";
import { Card, DataAsOnBadge, EmptyState, InlineLoader, PageTitle } from "./ui";

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

function channelTitle(marketplace: Marketplace) {
  return marketplace === "amazon" ? "Amazon" : "Flipkart";
}

export function ProductHubPage() {
  const params = useParams<{ marketplace: string; code: string }>();
  const marketplace = (params.marketplace as Marketplace) ?? "amazon";
  const productCode = params.code ?? "";
  const [product, setProduct] = useState<ProductMaster | null>(null);
  const [coverageIso, setCoverageIso] = useState<string | null>(null);
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
        setCoverageIso(metricRow?.as_of_date ?? null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Unable to load product."),
      )
      .finally(() => setIsLoading(false));
  }, [marketplace, productCode]);

  if (isLoading) return <InlineLoader text="Loading model workspace..." />;
  if (error) return <EmptyState title="Failed to load model" description={error} />;
  if (!product) {
    return (
      <EmptyState
        title="Model not found"
        description="Please search again from Product Lookup."
      />
    );
  }

  const codeLabel = getCodeLabel(marketplace);
  const ch = channelTitle(marketplace);
  const encodedCode = encodeURIComponent(product.product_code);
  const poPath = `/app/product/${marketplace}/${encodedCode}/po`;
  const selloutPath = `/app/product/${marketplace}/${encodedCode}/sellout-growth`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Model Workspace"
            subtitle="Choose what you want to review for this model."
          />
        </div>
        {coverageIso ? <DataAsOnBadge isoDate={coverageIso} className="self-start" /> : null}
      </div>
      <Card className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
          {codeLabel}
        </span>
        <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
          {product.product_code}
        </span>
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {displayModelName(product.product_name, product.product_code)}
        </span>
      </Card>

      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-400">
          {ch} — actions
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Link
            to={poPath}
            className={
              marketplace === "amazon"
                ? "rounded-2xl border border-amber-300 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm transition hover:shadow-md dark:border-amber-900/50 dark:from-amber-950/30 dark:to-zinc-900"
                : "rounded-2xl border border-orange-300 bg-gradient-to-br from-orange-50 to-white p-5 shadow-sm transition hover:shadow-md dark:border-orange-900/50 dark:from-orange-950/30 dark:to-zinc-900"
            }
          >
            <ClipboardList
              className={`h-6 w-6 ${marketplace === "amazon" ? "text-amber-700 dark:text-amber-300" : "text-orange-700 dark:text-orange-300"}`}
            />
            <h3 className="mt-3 text-xl font-bold tracking-tight">{ch} PO</h3>
            <p className="mt-1 font-mono text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              {product.product_code}
            </p>
            <p className="mt-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Inventory, coverage and suggested PO — latest {ch} snapshot.
            </p>
          </Link>

          <Link
            to={selloutPath}
            className="rounded-2xl border border-violet-300 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm transition hover:shadow-md dark:border-violet-900/50 dark:from-violet-950/30 dark:to-zinc-900"
          >
            <Activity className="h-6 w-6 text-violet-700 dark:text-violet-300" />
            <h3 className="mt-3 text-xl font-bold tracking-tight">{ch} — Sellout &amp; Growth</h3>
            <p className="mt-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              YoY and MoM sellout — this listing only.
            </p>
          </Link>
        </div>
      </div>

      <Link
        to="/app/asin"
        className="inline-flex items-center gap-2 text-base font-semibold text-violet-700 hover:underline dark:text-violet-300"
      >
        <Box className="h-4 w-4" />
        Search another model
      </Link>
    </div>
  );
}
