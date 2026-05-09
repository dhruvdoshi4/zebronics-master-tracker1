import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Activity, Box, ClipboardList, Warehouse } from "lucide-react";
import { getProductByCode } from "./data";
import type { Marketplace, ProductMaster } from "./types";
import { Card, EmptyState, InlineLoader, PageTitle } from "./ui";

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

export function ProductHubPage() {
  const params = useParams<{ marketplace: string; code: string }>();
  const marketplace = (params.marketplace as Marketplace) ?? "amazon";
  const productCode = params.code ?? "";
  const [product, setProduct] = useState<ProductMaster | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void getProductByCode(marketplace, productCode)
      .then((data) => setProduct(data))
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
  return (
    <div className="space-y-6">
      <PageTitle
        title="Model Workspace"
        subtitle="Choose what you want to review for this model."
      />
      <Card className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
          {codeLabel}
        </span>
        <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
          {product.product_code}
        </span>
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {product.product_name}
        </span>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Link
          to={`/app/product/${marketplace}/${encodeURIComponent(product.product_code)}/po`}
          className="rounded-2xl border border-amber-300 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm transition hover:shadow-md dark:border-amber-900/50 dark:from-amber-950/30 dark:to-zinc-900"
        >
          <ClipboardList className="h-6 w-6 text-amber-700 dark:text-amber-300" />
          <h3 className="mt-3 text-lg font-semibold">Check PO</h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Inventory, total sellout, MTD, previous month SO, DRR, DOC and PO.
          </p>
        </Link>

        <Link
          to={`/app/product/${marketplace}/${encodeURIComponent(product.product_code)}/sellout-growth`}
          className="rounded-2xl border border-violet-300 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm transition hover:shadow-md dark:border-violet-900/50 dark:from-violet-950/30 dark:to-zinc-900"
        >
          <Activity className="h-6 w-6 text-violet-700 dark:text-violet-300" />
          <h3 className="mt-3 text-lg font-semibold">Sellout & Growth</h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            FY totals, monthly trends, YoY and MoM growth insights.
          </p>
        </Link>

        <Link
          to={`/app/product/${marketplace}/${encodeURIComponent(product.product_code)}/ho-stock`}
          className="rounded-2xl border border-sky-300 bg-gradient-to-br from-sky-50 to-white p-5 shadow-sm transition hover:shadow-md dark:border-sky-900/50 dark:from-sky-950/30 dark:to-zinc-900"
        >
          <Warehouse className="h-6 w-6 text-sky-700 dark:text-sky-300" />
          <h3 className="mt-3 text-lg font-semibold">HO Stock</h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Placeholder ready. You can define HO stock logic next.
          </p>
        </Link>
      </div>

      <Link
        to="/app/asin"
        className="inline-flex items-center gap-2 text-sm font-medium text-violet-700 hover:underline dark:text-violet-300"
      >
        <Box className="h-4 w-4" />
        Search another model
      </Link>
    </div>
  );
}
