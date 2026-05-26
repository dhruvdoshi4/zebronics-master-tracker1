import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Activity, Box, ClipboardList } from "lucide-react";
import { useCatalogScope } from "./catalog-scope-context";
import { loadProductIdMap, lookupErpProductId } from "./product-id-map";
import { resolveErpProductIdFromListing } from "./data";
import {
  productIdHubPath,
  productIdWorkspacePath,
  useProductContextByErpId,
} from "./product-channel";
import type { Marketplace } from "./types";
import { Card, EmptyState, InlineLoader, PageTitle } from "./ui";

function resolveErpProductIdParam(params: {
  productId?: string;
  marketplace?: string;
  code?: string;
}): string | undefined {
  if (params.productId?.trim()) return params.productId.trim();
  // `/app/product/id/47709` wrongly matched as marketplace=id, code=47709
  if (params.marketplace === "id" && params.code?.trim()) return params.code.trim();
  return undefined;
}

export function ProductHubPage() {
  const { routePrefix } = useCatalogScope();
  const params = useParams<{ productId?: string; marketplace?: string; code?: string }>();
  const erpProductId = resolveErpProductIdParam(params);
  const legacyMarketplace = params.marketplace;
  const legacyCode = params.code;
  const { context, loading } = useProductContextByErpId(erpProductId);

  if (
    !erpProductId &&
    legacyMarketplace &&
    legacyCode &&
    (legacyMarketplace === "amazon" || legacyMarketplace === "flipkart")
  ) {
    return (
      <LegacyProductHubRedirect
        marketplace={legacyMarketplace as Marketplace}
        productCode={legacyCode}
      />
    );
  }

  if (loading) return <InlineLoader text="Loading model workspace..." />;
  if (!context) {
    return (
      <EmptyState
        title="Model not found"
        description={
          erpProductId
            ? `Product ID ${erpProductId} was not found in the product link registry. Re-upload the HO stock file if this ID is new, or search again.`
            : "Search from Product Lookup to open a model by Product ID."
        }
      />
    );
  }

  const poPath = productIdWorkspacePath(
    context.erpProductId,
    "po",
    context.defaultMarketplace,
  );
  const selloutPath = productIdWorkspacePath(
    context.erpProductId,
    "sellout-growth",
    context.defaultMarketplace,
  );

  return (
    <div className="space-y-6">
      <PageTitle
        title="Model Workspace"
        subtitle="Choose PO or Sellout & Growth — switch Amazon / Flipkart inside each report."
      />

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
            Product ID {context.erpProductId}
          </span>
        </div>
        <h2 className="text-lg font-bold text-zinc-900">{context.modelName}</h2>
        <div className="flex flex-wrap gap-3 text-xs font-medium text-zinc-600">
          {context.amazon ? (
            <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-mono">
              ASIN {context.amazon.product_code}
            </span>
          ) : (
            <span className="rounded-lg border border-zinc-200 px-2.5 py-1 text-zinc-400">
              No Amazon listing
            </span>
          )}
          {context.flipkart ? (
            <span className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 font-mono">
              FSN {context.flipkart.product_code}
            </span>
          ) : (
            <span className="rounded-lg border border-zinc-200 px-2.5 py-1 text-zinc-400">
              No Flipkart listing
            </span>
          )}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          to={poPath}
          className="rounded-2xl border border-amber-300 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm transition hover:shadow-md"
        >
          <ClipboardList className="h-6 w-6 text-amber-700" />
          <h3 className="mt-3 text-xl font-bold tracking-tight">PO</h3>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            Inventory, coverage and suggested purchase order.
          </p>
        </Link>

        <Link
          to={selloutPath}
          className="rounded-2xl border border-violet-300 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm transition hover:shadow-md"
        >
          <Activity className="h-6 w-6 text-violet-700" />
          <h3 className="mt-3 text-xl font-bold tracking-tight">Sellout &amp; Growth</h3>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            YoY and MoM sellout trends with channel toggle inside.
          </p>
        </Link>
      </div>

      <Link
        to={`${routePrefix}/asin`}
        className="inline-flex items-center gap-2 text-base font-semibold text-violet-700 hover:underline"
      >
        <Box className="h-4 w-4" />
        Search another model
      </Link>
    </div>
  );
}

function LegacyProductHubRedirect({
  marketplace,
  productCode,
}: {
  marketplace: Marketplace;
  productCode: string;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const map = await loadProductIdMap(true);
        if (!map) {
          setFailure(
            "No product ID links are stored yet. Upload the consolidated HO stock report once (ASIN, FSN, and Product ID columns) from Upload Center — links are saved permanently and stay available even before the next stock file is uploaded.",
          );
          return;
        }
        const pid =
          lookupErpProductId(map, marketplace, productCode) ??
          (await resolveErpProductIdFromListing(marketplace, productCode));
        if (pid) {
          setTarget(productIdHubPath(pid));
          return;
        }
        const codeLabel = marketplace === "amazon" ? "ASIN" : "FSN";
        setFailure(
          `${codeLabel} ${productCode} is not linked to a Product ID in the catalogue. Re-upload the HO stock file if this listing is new, or search from Product Lookup.`,
        );
      } catch (e: unknown) {
        setFailure(e instanceof Error ? e.message : "Could not resolve Product ID.");
      }
    })();
  }, [marketplace, productCode]);

  if (target) return <Navigate to={target} replace />;
  if (failure) {
    return <EmptyState title="Product ID not linked" description={failure} />;
  }
  return <InlineLoader text="Linking ASIN / FSN to Product ID…" />;
}
