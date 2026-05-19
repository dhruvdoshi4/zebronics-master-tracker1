import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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

export function productIdHubPath(erpProductId: string): string {
  return `/app/model/${encodeURIComponent(erpProductId)}`;
}

export function productIdWorkspacePath(
  erpProductId: string,
  suffix: ProductWorkspaceSuffix,
  marketplace: Marketplace,
): string {
  return `/app/model/${encodeURIComponent(erpProductId)}/${suffix}/${marketplace}`;
}

/** @deprecated Prefer productIdHubPath when ERP product ID is known. */
export function productWorkspacePath(
  marketplace: Marketplace,
  productCode: string,
  suffix?: ProductWorkspaceSuffix,
): string {
  const base = `/app/product/${marketplace}/${encodeURIComponent(productCode)}`;
  if (suffix === "po") return `${base}/po`;
  if (suffix === "sellout-growth") return `${base}/sellout-growth`;
  return base;
}

export function useProductContextByErpId(erpProductId: string | undefined) {
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
    void resolveProductContextByErpId(id)
      .then(setContext)
      .catch(() => setContext(null))
      .finally(() => setLoading(false));
  }, [erpProductId]);

  return { context, loading };
}

export function useProductChannelPeers(
  marketplace: Marketplace | undefined,
  productCode: string | undefined,
  productName?: string,
) {
  const [peers, setPeers] = useState<ProductChannelPeers | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!marketplace || !productCode?.trim()) {
      setPeers(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void getPeersForSelloutChannel(marketplace, productCode, productName)
      .then(setPeers)
      .catch(() =>
        setPeers({ amazon: null, flipkart: null, erpProductId: null }),
      )
      .finally(() => setLoading(false));
  }, [marketplace, productCode, productName]);

  return { peers, loading };
}

export function ProductChannelToggle({
  erpProductId,
  marketplace,
  productCode,
  peers,
  peersLoading,
  suffix,
  className,
}: {
  erpProductId?: string | null;
  marketplace: Marketplace;
  productCode: string;
  peers: ProductChannelPeers | null;
  peersLoading?: boolean;
  suffix: ProductWorkspaceSuffix;
  className?: string;
}) {
  const navigate = useNavigate();
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
          const peer = peers?.[ch] ?? null;
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
                  navigate(productIdWorkspacePath(pid, suffix, ch));
                  return;
                }
                if (targetCode) {
                  navigate(productWorkspacePath(ch, targetCode, suffix));
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
