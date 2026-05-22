import { type ChannelStockDemand } from "./metrics";
import { supabase } from "./supabase";
import { QCOM_MARKETPLACES, type QcomMarketplace } from "./types";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Failed to load QCom channel metrics.";
}

export function cleanQcomAsin(code: string): string | null {
  const v = code.trim().toUpperCase();
  return /^B0[A-Z0-9]{8,}$/i.test(v) ? v : null;
}

async function loadLatestQcomChannelMetrics(
  marketplace: QcomMarketplace,
): Promise<Map<string, ChannelStockDemand>> {
  const { data: uploads, error: uploadError } = await supabase
    .from("uploads")
    .select("id")
    .eq("marketplace", marketplace)
    .eq("status", "completed")
    .not("snapshot_date", "is", null)
    .order("uploaded_at", { ascending: false })
    .limit(1);
  if (uploadError) throw new Error(getErrorMessage(uploadError));

  const uploadId = uploads?.[0]?.id as string | undefined;
  if (!uploadId) return new Map();

  const { data, error } = await supabase
    .from("computed_metrics")
    .select("product_code, inventory_units, drr_units")
    .eq("marketplace", marketplace)
    .eq("upload_id", uploadId);
  if (error) throw new Error(getErrorMessage(error));

  const map = new Map<string, ChannelStockDemand>();
  for (const row of data ?? []) {
    const asin = cleanQcomAsin(String(row.product_code ?? ""));
    if (!asin) continue;
    const inv = Number(row.inventory_units ?? 0);
    const drr = Number(row.drr_units ?? 0);
    const prev = map.get(asin);
    if (prev) {
      map.set(asin, {
        inventory_units: prev.inventory_units + inv,
        drr_units: prev.drr_units + drr,
      });
    } else {
      map.set(asin, { inventory_units: inv, drr_units: drr });
    }
  }
  return map;
}

function mergeChannelMaps(
  target: Map<string, ChannelStockDemand>,
  source: Map<string, ChannelStockDemand>,
): void {
  for (const [asin, slice] of source) {
    const prev = target.get(asin);
    if (prev) {
      target.set(asin, {
        inventory_units: prev.inventory_units + slice.inventory_units,
        drr_units: prev.drr_units + slice.drr_units,
      });
    } else {
      target.set(asin, { ...slice });
    }
  }
}

/** Cumulative inventory and DRR across Zepto, Blinkit, Big Basket, and Instamart (by ASIN). */
export async function loadQcomChannelMetricsByAsin(): Promise<
  Map<string, ChannelStockDemand>
> {
  const channelsByAsin = new Map<string, ChannelStockDemand>();
  const perChannel = await Promise.all(
    QCOM_MARKETPLACES.map((marketplace) => loadLatestQcomChannelMetrics(marketplace)),
  );
  for (const channelMap of perChannel) {
    mergeChannelMaps(channelsByAsin, channelMap);
  }
  return channelsByAsin;
}
