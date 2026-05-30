import type { NavigateFunction } from "react-router-dom";
import {
  resolveSelloutMarketplaceForListing,
  type UnifiedProductSuggestion,
} from "./data";
import type { CatalogWorkspace } from "./catalog-workspace";
import {
  productIdHubPath,
  productIdWorkspacePath,
  productWorkspacePath,
  type ProductWorkspaceSuffix,
} from "./product-channel";
import type { Marketplace } from "./types";

/** Where unified Product Lookup should land after a match. */
export type ProductLookupDestination =
  | { type: "hub" }
  | { type: "workspace"; suffix: ProductWorkspaceSuffix; from?: string }
  | { type: "gms"; marketplace?: Marketplace };

function appendFromQuery(path: string, from?: string): string {
  if (!from) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}from=${encodeURIComponent(from)}`;
}

function defaultMarketplaceForRow(row: UnifiedProductSuggestion): Marketplace {
  if (row.asin) return "amazon";
  if (row.fsn) return "flipkart";
  return "amazon";
}

/**
 * Navigate after a unified lookup match — ERP product ID first, then channel listing codes.
 * Uses latest sellout upload per channel (FK-only uploads open Flipkart, not Amazon).
 */
export async function navigateFromUnifiedProductLookup(
  navigate: NavigateFunction,
  row: UnifiedProductSuggestion,
  destination: ProductLookupDestination,
  routePrefix: string,
  catalogWorkspace?: CatalogWorkspace,
  queryHint?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (destination.type === "hub") {
    if (row.erpProductId) {
      navigate(productIdHubPath(row.erpProductId, routePrefix));
      return { ok: true };
    }
    const hubMarketplace = catalogWorkspace
      ? await resolveSelloutMarketplaceForListing(row, catalogWorkspace, { queryHint })
      : defaultMarketplaceForRow(row);
    const hubListingCode = hubMarketplace === "amazon" ? row.asin : row.fsn;
    if (hubListingCode) {
      navigate(productWorkspacePath(hubMarketplace, hubListingCode, undefined, routePrefix));
      return { ok: true };
    }
    return { ok: false, message: "No linked Amazon or Flipkart listing for this product." };
  }

  if (destination.type === "gms") {
    if (row.erpProductId) {
      navigate(`${routePrefix}/gms/product/id/${encodeURIComponent(row.erpProductId)}`);
      return { ok: true };
    }
    const marketplace =
      destination.marketplace ??
      (catalogWorkspace
        ? await resolveSelloutMarketplaceForListing(row, catalogWorkspace, { queryHint })
        : defaultMarketplaceForRow(row));
    const code = marketplace === "amazon" ? row.asin : row.fsn;
    const fallbackMarketplace: Marketplace = marketplace === "amazon" ? "flipkart" : "amazon";
    const fallbackCode = fallbackMarketplace === "amazon" ? row.asin : row.fsn;
    const resolvedMarketplace = code ? marketplace : fallbackCode ? fallbackMarketplace : marketplace;
    const resolvedCode = code || fallbackCode;
    if (!resolvedCode) {
      const channel = resolvedMarketplace === "amazon" ? "Amazon" : "Flipkart";
      return { ok: false, message: `No ${channel} listing for this product.` };
    }
    navigate(
      `${routePrefix}/gms/product/${resolvedMarketplace}/${encodeURIComponent(resolvedCode)}`,
    );
    return { ok: true };
  }

  const marketplace = catalogWorkspace
    ? await resolveSelloutMarketplaceForListing(row, catalogWorkspace, {
        queryHint,
      })
    : defaultMarketplaceForRow(row);

  if (row.erpProductId) {
    navigate(
      appendFromQuery(
        productIdWorkspacePath(
          row.erpProductId,
          destination.suffix,
          marketplace,
          routePrefix,
        ),
        destination.from,
      ),
    );
    return { ok: true };
  }

  const listingCode = marketplace === "amazon" ? row.asin : row.fsn;
  if (!listingCode) {
    const channel = marketplace === "amazon" ? "Amazon" : "Flipkart";
    return { ok: false, message: `No ${channel} listing for this product.` };
  }
  navigate(
    appendFromQuery(
      productWorkspacePath(marketplace, listingCode, destination.suffix, routePrefix),
      destination.from,
    ),
  );
  return { ok: true };
}
