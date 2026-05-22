import { getLatestHoStockUpload } from "./data-ho-stock";
import { fetchAllHoStockSnapshotRows } from "./ho-stock-snapshot-query";
import { computeQcomNetworkDocDays, type ChannelStockDemand } from "./metrics";
import { supabase } from "./supabase";
import { QCOM_MARKETPLACES, type QcomMarketplace } from "./types";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Failed to load network DOC.";
}

export function cleanQcomAsin(code: string): string | null {
  const v = code.trim().toUpperCase();
  return /^B0[A-Z0-9]{8,}$/i.test(v) ? v : null;
}

export type QcomNetworkDocMaps = {
  hoByAsin: Map<string, { ho_units: number; gurgaon_units: number }>;
  channelsByAsin: Map<string, ChannelStockDemand>;
};

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

/** HO/Gurgaon by ASIN plus cumulative inventory and DRR across all QCom channel uploads. */
export async function loadQcomNetworkDocMaps(): Promise<QcomNetworkDocMaps> {
  const hoByAsin = new Map<string, { ho_units: number; gurgaon_units: number }>();
  const channelsByAsin = new Map<string, ChannelStockDemand>();

  const upload = await getLatestHoStockUpload();
  if (upload?.id) {
    const rows = await fetchAllHoStockSnapshotRows(
      upload.id,
      "asin, ho_units, gurgaon_units",
    );
    for (const raw of rows) {
      const asin = cleanQcomAsin(String(raw.asin ?? ""));
      if (!asin) continue;
      const ho_units = Number(raw.ho_units ?? 0);
      const gurgaon_units = Number(raw.gurgaon_units ?? 0);
      const prev = hoByAsin.get(asin);
      if (prev) {
        hoByAsin.set(asin, {
          ho_units: prev.ho_units + ho_units,
          gurgaon_units: prev.gurgaon_units + gurgaon_units,
        });
      } else {
        hoByAsin.set(asin, { ho_units, gurgaon_units });
      }
    }
  }

  const perChannel = await Promise.all(
    QCOM_MARKETPLACES.map((marketplace) => loadLatestQcomChannelMetrics(marketplace)),
  );
  for (const channelMap of perChannel) {
    mergeChannelMaps(channelsByAsin, channelMap);
  }

  return { hoByAsin, channelsByAsin };
}

export function networkDocDaysForProductCode(
  productCode: string,
  maps: QcomNetworkDocMaps,
): number | null {
  const asin = cleanQcomAsin(productCode);
  if (!asin) return null;
  const ho = maps.hoByAsin.get(asin);
  const channels = maps.channelsByAsin.get(asin) ?? {
    inventory_units: 0,
    drr_units: 0,
  };
  return computeQcomNetworkDocDays({
    ho_units: ho?.ho_units ?? 0,
    gurgaon_units: ho?.gurgaon_units ?? 0,
    channels,
  });
}
