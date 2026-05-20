import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Activity, ArrowLeft, ShoppingBag, Store } from "lucide-react";
import { getPeersForSelloutChannel, getProductByCode } from "./data";
import { displayModelName } from "./product-display";
import type { Marketplace, ProductMaster } from "./types";
import { Card, DataAsOnDualChannelBadge, EmptyState, InlineLoader, PageTitle } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

function codeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

export function SelloutChannelPage() {
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const params = useParams<{ marketplace: string; code: string }>();
  const routeMarketplace = (params.marketplace as Marketplace) ?? "amazon";
  const productCode = params.code ?? "";
  const [product, setProduct] = useState<ProductMaster | null>(null);
  const [peers, setPeers] = useState<{
    amazon: ProductMaster | null;
    flipkart: ProductMaster | null;
    erpProductId: string | null;
  }>({ amazon: null, flipkart: null, erpProductId: null });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const row = await getProductByCode(routeMarketplace, productCode);
        if (cancelled) return;
        setProduct(row);
        if (row) {
          const p = await getPeersForSelloutChannel(
            routeMarketplace,
            productCode,
            row.product_name,
          );
          if (cancelled) return;
          setPeers(p);
        } else {
          setPeers({ amazon: null, flipkart: null, erpProductId: null });
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Unable to load product.");
          setPeers({ amazon: null, flipkart: null, erpProductId: null });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeMarketplace, productCode]);

  if (isLoading) return <InlineLoader text="Loading channels..." />;
  if (error) return <EmptyState title="Something went wrong" description={error} />;
  if (!product) {
    return (
      <EmptyState
        title="Model not found"
        description="Please search again from Product Lookup."
      />
    );
  }

  const amazonListing: ProductMaster | null =
    peers.amazon ?? (product.marketplace === "amazon" ? product : null);
  const flipkartListing: ProductMaster | null =
    peers.flipkart ?? (product.marketplace === "flipkart" ? product : null);

  const hubPath = `/app/product/${routeMarketplace}/${encodeURIComponent(productCode)}`;

  return (
    <div className="space-y-6">
      <Link
        to={hubPath}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Model Workspace
      </Link>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Sellout & Growth"
            subtitle="Pick Amazon or Flipkart for this model’s sellout view."
          />
        </div>
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      <Card className="flex flex-wrap items-center gap-2 text-base font-semibold">
        <Activity className="h-5 w-5 text-violet-600" />
        <span className="font-bold text-zinc-900 dark:text-zinc-100">
          {displayModelName(product.product_name, product.product_code)}
        </span>
        <span className="text-zinc-500">·</span>
        <span className="text-zinc-700 dark:text-zinc-400">
          Opened from {routeMarketplace === "amazon" ? "Amazon" : "Flipkart"} (
          <span className="font-mono text-xs">{product.product_code}</span>)
        </span>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <ChannelCard
          title="Amazon"
          description="Latest Amazon snapshot for this listing."
          Icon={ShoppingBag}
          enabled={Boolean(amazonListing)}
          disabledReason="No Amazon listing for this model yet."
          marketplace="amazon"
          listing={amazonListing}
        />

        <ChannelCard
          title="Flipkart"
          description="Latest Flipkart snapshot for this listing."
          Icon={Store}
          enabled={Boolean(flipkartListing)}
          disabledReason="No Flipkart listing for this model yet."
          marketplace="flipkart"
          listing={flipkartListing}
        />
      </div>
    </div>
  );
}

function ChannelCard({
  title,
  description,
  Icon,
  enabled,
  disabledReason,
  marketplace,
  listing,
}: {
  title: string;
  description: string;
  Icon: typeof ShoppingBag;
  enabled: boolean;
  disabledReason: string;
  marketplace: Marketplace;
  listing: ProductMaster | null;
}) {
  const label = codeLabel(marketplace);

  if (!enabled || !listing) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-6 opacity-80 dark:border-zinc-600 dark:bg-zinc-900/40">
        <Icon className="h-8 w-8 text-zinc-400" />
        <h3 className="mt-3 text-xl font-bold text-zinc-800 dark:text-zinc-200">{title}</h3>
        <p className="mt-1 text-sm font-semibold text-zinc-600">{description}</p>
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
          {disabledReason}
        </p>
      </div>
    );
  }

  const to = `/app/product/${marketplace}/${encodeURIComponent(listing.product_code)}/sellout-growth`;

  return (
    <Link
      to={to}
      className={`rounded-2xl border bg-gradient-to-br p-6 shadow-sm transition hover:shadow-md ${
        marketplace === "amazon"
          ? "border-amber-200 from-amber-50 to-white dark:border-amber-900/50 dark:from-amber-950/30 dark:to-zinc-900"
          : "border-violet-200 from-violet-50 to-white dark:border-violet-900/50 dark:from-violet-950/30 dark:to-zinc-900"
      }`}
    >
      <Icon className={`h-8 w-8 ${marketplace === "amazon" ? "text-amber-700" : "text-violet-700"}`} />
      <h3 className="mt-3 text-xl font-bold tracking-tight">{title}</h3>
      <p className="mt-1 text-sm font-semibold leading-relaxed text-zinc-700 dark:text-zinc-300">{description}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-white/80 px-2 py-0.5 font-medium text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-900/80 dark:text-zinc-200 dark:ring-zinc-600">
          {label}
        </span>
        <span className="font-mono text-zinc-600 dark:text-zinc-400">{listing.product_code}</span>
      </div>
      <p className="mt-4 text-base font-bold text-violet-700 dark:text-violet-300">Open Sellout →</p>
    </Link>
  );
}
