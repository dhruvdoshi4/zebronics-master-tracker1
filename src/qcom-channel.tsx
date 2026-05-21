import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./supabase";
import type { ProductMaster } from "./types";
import {
  QCOM_HO_STOCK_CATALOG_MARKETPLACE,
  QCOM_MARKETPLACES,
} from "./types";
import { qcomWorkspaceLabel } from "./marketplace-labels";
import {
  qcomProductWorkspacePath,
  qcomSelloutPath,
  type QcomWorkspaceSuffix,
} from "./qcom-paths";
import {
  QCOM_WORKSPACE_KEYS,
  type QcomWorkspaceKey,
} from "./tenants";
import { cn } from "./utils";

export type QcomWorkspacePeers = Partial<Record<QcomWorkspaceKey, ProductMaster>>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/** Same ASIN on Consolidated + quick-commerce channels. */
export async function getQcomPeersByListing(
  workspace: QcomWorkspaceKey,
  productCode: string,
): Promise<QcomWorkspacePeers> {
  const code = productCode.trim();
  const peers: QcomWorkspacePeers = {};
  if (!code) return peers;

  let asin = /^B0[A-Z0-9]{8,}$/i.test(code) ? code.toUpperCase() : "";

  if (!asin) {
    const marketplace =
      workspace === "consolidated"
        ? QCOM_HO_STOCK_CATALOG_MARKETPLACE
        : workspace;
    const { data: row, error } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", marketplace)
      .or(`product_code.eq.${code},listing_code.eq.${code}`)
      .maybeSingle();
    if (error) throw new Error(getErrorMessage(error));
    const hit = row as ProductMaster | null;
    if (hit) {
      peers[workspace] = hit;
      if (/^B0[A-Z0-9]{8,}$/i.test(hit.product_code)) {
        asin = hit.product_code.toUpperCase();
      }
    }
  }

  if (asin) {
    const { data: consolidated, error: consolidatedErr } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", QCOM_HO_STOCK_CATALOG_MARKETPLACE)
      .eq("product_code", asin)
      .maybeSingle();
    if (consolidatedErr) throw new Error(getErrorMessage(consolidatedErr));
    if (consolidated) {
      peers.consolidated = consolidated as ProductMaster;
    }

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

  if (!peers[workspace]) {
    const marketplace =
      workspace === "consolidated"
        ? QCOM_HO_STOCK_CATALOG_MARKETPLACE
        : workspace;
    const { data, error } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", marketplace)
      .eq("product_code", code)
      .maybeSingle();
    if (error) throw new Error(getErrorMessage(error));
    if (data) peers[workspace] = data as ProductMaster;
  }

  return peers;
}

export function useQcomChannelPeers(
  workspace: QcomWorkspaceKey | undefined,
  productCode: string | undefined,
) {
  const [peers, setPeers] = useState<QcomWorkspacePeers | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workspace || !productCode?.trim()) {
      setPeers(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void getQcomPeersByListing(workspace, productCode)
      .then(setPeers)
      .catch(() => setPeers({}))
      .finally(() => setLoading(false));
  }, [workspace, productCode]);

  return { peers, loading };
}

const WORKSPACE_COLORS: Record<QcomWorkspaceKey, { active: string; idle: string }> = {
  consolidated: {
    active: "bg-indigo-600 text-white shadow",
    idle: "text-zinc-700 hover:bg-white",
  },
  zepto: { active: "bg-violet-600 text-white shadow", idle: "text-zinc-700 hover:bg-white" },
  blinkit: { active: "bg-amber-500 text-white shadow", idle: "text-zinc-700 hover:bg-white" },
  bigbasket: { active: "bg-emerald-600 text-white shadow", idle: "text-zinc-700 hover:bg-white" },
  instamart: { active: "bg-sky-600 text-white shadow", idle: "text-zinc-700 hover:bg-white" },
};

export function QcomChannelToggle({
  workspace,
  productCode,
  canonicalProductCode,
  peers,
  peersLoading,
  workspaceSuffix = "sellout-growth",
  className,
}: {
  workspace: QcomWorkspaceKey;
  productCode: string;
  /** ASIN / hub code — keeps workspace switches on the same model URLs. */
  canonicalProductCode?: string;
  peers: QcomWorkspacePeers | null;
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
        {QCOM_WORKSPACE_KEYS.map((key) => {
          const active = key === workspace;
          const peer = peers?.[key];
          const available = active || Boolean(peer);
          const disabled = peersLoading || (!active && !available);
          const colors = WORKSPACE_COLORS[key];

          return (
            <button
              key={key}
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
                  navigate(qcomProductWorkspacePath(hubCode, workspaceSuffix, key));
                  return;
                }
                navigate(qcomSelloutPath(key, targetCode));
              }}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-bold transition",
                active ? colors.active : available ? colors.idle : "cursor-not-allowed text-zinc-400 opacity-60",
              )}
            >
              {qcomWorkspaceLabel(key)}
            </button>
          );
        })}
      </div>
      {peersLoading ? (
        <p className="text-xs text-zinc-500">Loading channel links…</p>
      ) : (
        <p className="text-xs font-medium text-zinc-500">
          Switch between Consolidated network totals and each channel listing.
        </p>
      )}
    </div>
  );
}
