import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./supabase";
import type { ProductMaster, QcomMarketplace } from "./types";
import { QCOM_MARKETPLACES } from "./types";
import { marketplaceLabel } from "./marketplace-labels";
import {
  qcomProductWorkspacePath,
  qcomSelloutPath,
  type QcomWorkspaceSuffix,
} from "./qcom-paths";
import { cn } from "./utils";

export type QcomChannelPeers = Partial<Record<QcomMarketplace, ProductMaster>>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/** Same ASIN on other quick-commerce channels (Consolidated-linked product_code). */
export async function getQcomPeersByListing(
  marketplace: QcomMarketplace,
  productCode: string,
): Promise<QcomChannelPeers> {
  const code = productCode.trim();
  const peers: QcomChannelPeers = {};
  if (!code) return peers;

  let asin = /^B0[A-Z0-9]{8,}$/i.test(code) ? code.toUpperCase() : "";

  if (!asin) {
    const { data: row, error } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", marketplace)
      .or(`product_code.eq.${code},listing_code.eq.${code}`)
      .maybeSingle();
    if (error) throw new Error(getErrorMessage(error));
    const hit = row as ProductMaster | null;
    if (hit) {
      peers[marketplace] = hit;
      if (/^B0[A-Z0-9]{8,}$/i.test(hit.product_code)) {
        asin = hit.product_code.toUpperCase();
      }
    }
  }

  if (asin) {
    await Promise.all(
      QCOM_MARKETPLACES.map(async (ch) => {
        const { data, error } = await supabase
          .from("product_master")
          .select("*")
          .eq("marketplace", ch)
          .eq("product_code", asin)
          .maybeSingle();
        if (error) throw new Error(getErrorMessage(error));
        if (data) peers[ch] = data as ProductMaster;
      }),
    );
    return peers;
  }

  if (!peers[marketplace]) {
    const { data, error } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", marketplace)
      .eq("product_code", code)
      .maybeSingle();
    if (error) throw new Error(getErrorMessage(error));
    if (data) peers[marketplace] = data as ProductMaster;
  }

  return peers;
}

export function useQcomChannelPeers(
  marketplace: QcomMarketplace | undefined,
  productCode: string | undefined,
) {
  const [peers, setPeers] = useState<QcomChannelPeers | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!marketplace || !productCode?.trim()) {
      setPeers(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void getQcomPeersByListing(marketplace, productCode)
      .then(setPeers)
      .catch(() => setPeers({}))
      .finally(() => setLoading(false));
  }, [marketplace, productCode]);

  return { peers, loading };
}

const CHANNEL_COLORS: Record<QcomMarketplace, { active: string; idle: string }> = {
  zepto: { active: "bg-violet-600 text-white shadow", idle: "text-zinc-700 hover:bg-white" },
  blinkit: { active: "bg-amber-500 text-white shadow", idle: "text-zinc-700 hover:bg-white" },
  bigbasket: { active: "bg-emerald-600 text-white shadow", idle: "text-zinc-700 hover:bg-white" },
  instamart: { active: "bg-sky-600 text-white shadow", idle: "text-zinc-700 hover:bg-white" },
};

export function QcomChannelToggle({
  marketplace,
  productCode,
  canonicalProductCode,
  peers,
  peersLoading,
  workspaceSuffix = "sellout-growth",
  className,
}: {
  marketplace: QcomMarketplace;
  productCode: string;
  /** ASIN / hub code — keeps channel switches on the same model workspace URLs. */
  canonicalProductCode?: string;
  peers: QcomChannelPeers | null;
  peersLoading?: boolean;
  workspaceSuffix?: QcomWorkspaceSuffix;
  className?: string;
}) {
  const navigate = useNavigate();

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1"
        role="group"
        aria-label="Quick commerce channel"
      >
        {QCOM_MARKETPLACES.map((ch) => {
          const active = ch === marketplace;
          const peer = peers?.[ch];
          const available = active || Boolean(peer);
          const disabled = peersLoading || (!active && !available);
          const colors = CHANNEL_COLORS[ch];

          return (
            <button
              key={ch}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (active) return;
                const targetCode = peer?.product_code ?? productCode;
                const hubCode =
                  canonicalProductCode?.trim() ||
                  (/^B0[A-Z0-9]{8,}$/i.test(productCode)
                    ? productCode.toUpperCase()
                    : /^B0[A-Z0-9]{8,}$/i.test(targetCode)
                      ? targetCode.toUpperCase()
                      : "");
                if (hubCode) {
                  navigate(qcomProductWorkspacePath(hubCode, workspaceSuffix, ch));
                  return;
                }
                navigate(qcomSelloutPath(ch, targetCode));
              }}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-bold transition",
                active ? colors.active : available ? colors.idle : "cursor-not-allowed text-zinc-400 opacity-60",
              )}
            >
              {marketplaceLabel(ch)}
            </button>
          );
        })}
      </div>
      {peersLoading ? (
        <p className="text-xs text-zinc-500">Loading channel links…</p>
      ) : (
        <p className="text-xs font-medium text-zinc-500">
          Switch channel for the same ASIN when listed on Zepto, Blinkit, Instamart, or Big Basket.
        </p>
      )}
    </div>
  );
}
