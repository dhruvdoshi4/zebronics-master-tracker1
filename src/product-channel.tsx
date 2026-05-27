import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCatalogScope } from "./catalog-scope-context";
import {
  getPeersForSelloutChannel,
  resolveProductContextByErpId,
  type ProductContext,
} from "./data";
import type { Marketplace, ProductMaster } from "./types";
import { cn } from "./utils";

export type ProductChannelPeers = {
  amazon: ProductMaster | null;
  flipkart: ProductMaster | null;
  erpProductId: string | null;
};

export type ProductWorkspaceSuffix = "po" | "sellout-growth";

/** Hari `/app` vs Karan `/app/pa` vs Rithika `/app/ri` — must match URL or TenantGate redirects. */
export function appRoutePrefixFromLocation(pathname?: string): string {
  const path =
    pathname ??
    (typeof globalThis.location !== "undefined" ? globalThis.location.pathname : "");
  if (path.startsWith("/app/pa")) return "/app/pa";
  if (path.startsWith("/app/ri")) return "/app/ri";
  if (path.startsWith("/app/pv")) return "/app/pv";
  return "/app";
}

/** Product Lookup route — manager workspaces use `/lookup`, Hari uses `/asin`. */
export function productLookupPath(routePrefix?: string): string {
  const prefix = routePrefix ?? appRoutePrefixFromLocation();
  if (
    prefix === "/app/pa" ||
    prefix === "/app/ri" ||
    prefix === "/app/pv"
  ) {
    return `${prefix}/lookup`;
  }
  return `${prefix}/asin`;
}

/** Model workspace from a dashboard ASIN/FSN row (same destination as Product Lookup). */
export function dashboardListingModelPath(
  marketplace: Marketplace,
  productCode: string,
  routePrefix?: string,
): string {
  return productWorkspacePath(marketplace, productCode, undefined, routePrefix);
}

export function productIdHubPath(erpProductId: string, routePrefix?: string): string {
  const prefix = routePrefix ?? appRoutePrefixFromLocation();
  return `${prefix}/model/${encodeURIComponent(erpProductId)}`;
}

export function productIdWorkspacePath(
  erpProductId: string,
  suffix: ProductWorkspaceSuffix,
  marketplace: Marketplace,
  routePrefix?: string,
): string {
  const prefix = routePrefix ?? appRoutePrefixFromLocation();
  return `${prefix}/model/${encodeURIComponent(erpProductId)}/${suffix}/${marketplace}`;
}

/** @deprecated Prefer productIdHubPath when ERP product ID is known. */
export function productWorkspacePath(
  marketplace: Marketplace,
  productCode: string,
  suffix?: ProductWorkspaceSuffix,
  routePrefix?: string,
): string {
  const prefix = routePrefix ?? appRoutePrefixFromLocation();
  const base = `${prefix}/product/${marketplace}/${encodeURIComponent(productCode)}`;
  if (suffix === "po") return `${base}/po`;
  if (suffix === "sellout-growth") return `${base}/sellout-growth`;
  return base;
}

export function useProductContextByErpId(erpProductId: string | undefined) {
  const { workspace: catalogWorkspace } = useCatalogScope();
  const [context, setContext] = useState<ProductContext | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const id = erpProductId?.trim();
    if (!id) {
      setContext(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void resolveProductContextByErpId(id, catalogWorkspace)
      .then(setContext)
      .catch(() => setContext(null))
      .finally(() => setLoading(false));
  }, [erpProductId, catalogWorkspace]);

  return { context, loading };
}

export function useProductChannelPeers(
  marketplace: Marketplace | undefined,
  productCode: string | undefined,
  productName?: string,
) {
  const { workspace: catalogWorkspace } = useCatalogScope();
  const [peers, setPeers] = useState<ProductChannelPeers | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!marketplace || !productCode?.trim()) {
      setPeers(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void getPeersForSelloutChannel(
      marketplace,
      productCode,
      productName,
      catalogWorkspace,
    )
      .then(setPeers)
      .catch(() =>
        setPeers({ amazon: null, flipkart: null, erpProductId: null }),
      )
      .finally(() => setLoading(false));
  }, [marketplace, productCode, productName, catalogWorkspace]);

  return { peers, loading };
}

export function ProductChannelToggle({
  erpProductId,
  marketplace,
  productCode,
  peers,
  peersLoading,
  suffix,
  routePrefix: routePrefixProp,
  className,
}: {
  erpProductId?: string | null;
  marketplace: Marketplace;
  productCode: string;
  peers: ProductChannelPeers | null;
  peersLoading?: boolean;
  suffix: ProductWorkspaceSuffix;
  routePrefix?: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const { routePrefix: scopePrefix } = useCatalogScope();
  const routePrefix = routePrefixProp ?? scopePrefix;
  const channels: Marketplace[] = ["amazon", "flipkart"];
  const pid = erpProductId ?? peers?.erpProductId ?? null;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1"
        role="group"
        aria-label="Marketplace channel"
      >
        {channels.map((ch) => {
          const active = ch === marketplace;
          const peer =
            ch === marketplace
              ? null
              : ch === "amazon"
                ? peers?.amazon
                : peers?.flipkart;
          const targetCode = active ? productCode : peer?.product_code;
          const available = Boolean(pid ? peer ?? (active && productCode) : targetCode);
          const disabled = peersLoading || (!active && !available);

          return (
            <button
              key={ch}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (active) return;
                if (pid) {
                  navigate(productIdWorkspacePath(pid, suffix, ch, routePrefix));
                  return;
                }
                if (targetCode) {
                  navigate(productWorkspacePath(ch, targetCode, suffix, routePrefix));
                }
              }}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-bold transition",
                active
                  ? ch === "amazon"
                    ? "bg-orange-600 text-white shadow"
                    : "bg-blue-600 text-white shadow"
                  : available
                    ? "text-zinc-700 hover:bg-white"
                    : "cursor-not-allowed text-zinc-400 opacity-60",
              )}
            >
              {ch === "amazon" ? "Amazon" : "Flipkart"}
            </button>
          );
        })}
      </div>
      {pid ? (
        <p className="text-xs font-medium text-zinc-500">
          Product ID <span className="font-mono font-semibold text-zinc-700">{pid}</span>
        </p>
      ) : peersLoading ? (
        <p className="text-xs text-zinc-500">Resolving channel link…</p>
      ) : null}
    </div>
  );
}
