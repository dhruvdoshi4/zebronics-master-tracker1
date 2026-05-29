import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useCatalogScope } from "./catalog-scope-context";
import { EmptyState } from "./ui";
import type { Marketplace } from "./types";

function parseMarketplaceParam(raw: string | undefined): Marketplace | null {
  if (raw === "amazon" || raw === "flipkart") return raw;
  return null;
}

/** Legacy `/gms/product/amazon|flipkart` URLs → unified product hub (channel picked on search). */
export function GmsProductPage() {
  const { routePrefix } = useCatalogScope();
  const params = useParams<{ marketplace: string }>();
  const [searchParams] = useSearchParams();
  const marketplace = parseMarketplaceParam(params.marketplace);

  if (!marketplace) {
    return (
      <EmptyState
        title="Unknown channel"
        description="Open GMS product tracker from the Product wise hub."
      />
    );
  }

  const query = searchParams.toString();
  return (
    <Navigate
      to={query ? `${routePrefix}/gms/product?${query}` : `${routePrefix}/gms/product`}
      replace
    />
  );
}
