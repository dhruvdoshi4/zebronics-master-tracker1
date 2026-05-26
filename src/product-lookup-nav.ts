import type { NavigateFunction } from "react-router-dom";
import type { UnifiedProductSuggestion } from "./data";
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
  | { type: "gms"; marketplace: Marketplace };

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
 * Shared by Product Lookup and Sellout & growth entry points (Hari + Karan workspaces).
 */
export function navigateFromUnifiedProductLookup(
  navigate: NavigateFunction,
  row: UnifiedProductSuggestion,
  destination: ProductLookupDestination,
  routePrefix: string,
): { ok: true } | { ok: false; message: string } {
  if (destination.type === "hub") {
    if (row.erpProductId) {
      navigate(productIdHubPath(row.erpProductId, routePrefix));
      return { ok: true };
    }
    if (row.asin) {
      navigate(productWorkspacePath("amazon", row.asin, undefined, routePrefix));
      return { ok: true };
    }
    if (row.fsn) {
      navigate(productWorkspacePath("flipkart", row.fsn, undefined, routePrefix));
      return { ok: true };
    }
    return { ok: false, message: "No linked Amazon or Flipkart listing for this product." };
  }

  if (destination.type === "gms") {
    const code =
      destination.marketplace === "amazon" ? row.asin : row.fsn;
    if (!code) {
      const channel = destination.marketplace === "amazon" ? "Amazon" : "Flipkart";
      return { ok: false, message: `No ${channel} listing for this product.` };
    }
    navigate(
      `${routePrefix}/gms/product/${destination.marketplace}/${encodeURIComponent(code)}`,
    );
    return { ok: true };
  }

  const marketplace = defaultMarketplaceForRow(row);
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
  if (row.asin) {
    navigate(
      appendFromQuery(
        productWorkspacePath("amazon", row.asin, destination.suffix, routePrefix),
        destination.from,
      ),
    );
    return { ok: true };
  }
  if (row.fsn) {
    navigate(
      appendFromQuery(
        productWorkspacePath("flipkart", row.fsn, destination.suffix, routePrefix),
        destination.from,
      ),
    );
    return { ok: true };
  }
  return { ok: false, message: "No linked Amazon or Flipkart listing for this product." };
}
