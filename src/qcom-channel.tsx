import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./supabase";
import type { ProductMaster, QcomMarketplace } from "./types";
import { QCOM_MARKETPLACES } from "./types";
import { marketplaceLabel } from "./marketplace-labels";
import { qcomSelloutPath } from "./qcom-paths";
import { cn } from "./utils";

export type QcomChannelPeers = Partial<Record<QcomMarketplace, ProductMaster>>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/** Same ASIN (or listing code) on other quick-commerce channels. */
export async function getQcomPeersByListing(
  marketplace: QcomMarketplace,
  productCode: string,
): Promise<QcomChannelPeers> {
  const code = productCode.trim();
  const peers: QcomChannelPeers = {};
  if (!code) return peers;

  let asin = /^B0[A-Z0-9]{8,}$/i.test(code) ? code.toUpperCase() : "";

  if (!asin) {
    const { data: row } = await supabase
      .from("product_master")
      .select("product_code, product_name, category, sub_category, brand, marketplace")
      .eq("marketplace", marketplace)
      .eq("product_code", code)
      .maybeSingle();
    const hit = row as ProductMaster | null;
    if (hit) {
      peers[marketplace] = hit;
      const { data: byName } = await supabase
        .from("product_master")
        .select("product_code, product_name, category, sub_category, brand, marketplace")
        .eq("marketplace", marketplace)
        .ilike("product_name", hit.product_name)
        .limit(5);
      for (const r of byName ?? []) {
        const p = r as ProductMaster;
        if (/^B0[A-Z0-9]{8,}$/i.test(p.product_code)) {
          asin = p.product_code.toUpperCase();
          break;
        }
      }
    }
  }

  for (const ch of QCOM_MARKETPLACES) {
    if (asin) {
      const { data, error } = await supabase
        .from("product_master")
        .select("*")
        .eq("marketplace", ch)
        .eq("product_code", asin)
        .maybeSingle();
      if (error) throw new Error(getErrorMessage(error));
      if (data) peers[ch] = data as ProductMaster;
      continue;
    }
    if (ch === marketplace) {
      const { data, error } = await supabase
        .from("product_master")
        .select("*")
        .eq("marketplace", ch)
        .eq("product_code", code)
        .maybeSingle();
      if (error) throw new Error(getErrorMessage(error));
      if (data) peers[ch] = data as ProductMaster;
    }
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
  peers,
  peersLoading,
  className,
}: {
  marketplace: QcomMarketplace;
  productCode: string;
  peers: QcomChannelPeers | null;
  peersLoading?: boolean;
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
