import { type ChannelStockDemand } from "./metrics";
import { supabase } from "./supabase";
import { QCOM_MARKETPLACES, type QcomMarketplace } from "./types";
import { splitFsnCell } from "./parsers-ho-stock";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Failed to load QCom channel metrics.";
}

export function cleanQcomAsin(code: string): string | null {
  const v = code.trim().toUpperCase();
  return /^B0[A-Z0-9]{8,}$/i.test(v) ? v : null;
}

function isMissingUploadKindColumn(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes("upload_kind") && msg.includes("does not exist");
}

function isSelloutUploadRow(row: {
  upload_kind?: string | null;
  notes?: string | null;
}): boolean {
  const kind = String(row.upload_kind ?? "").trim().toLowerCase();
  if (kind === "sellout") return true;
  if (kind && kind !== "sellout") return false;
  const notes = String(row.notes ?? "").toLowerCase();
  return !notes.includes("ho stock") && !notes.includes("bau") && !notes.includes("gms plan");
}

async function getLatestQcomSelloutUploadId(
  marketplace: QcomMarketplace,
): Promise<string | null> {
  const baseQuery = () =>
    supabase
      .from("uploads")
      .select("id, upload_kind, notes")
      .eq("marketplace", marketplace)
      .eq("status", "completed")
      .not("snapshot_date", "is", null)
      .order("uploaded_at", { ascending: false })
      .limit(12);

  let rows: Array<{ id: string; upload_kind?: string | null; notes?: string | null }> = [];

  const withKind = await baseQuery().eq("upload_kind", "sellout");
  if (withKind.error) {
    if (!isMissingUploadKindColumn(withKind.error)) {
      throw new Error(getErrorMessage(withKind.error));
    }
    const fallback = await baseQuery();
    if (fallback.error) throw new Error(getErrorMessage(fallback.error));
    rows = ((fallback.data ?? []) as typeof rows).filter(isSelloutUploadRow);
  } else {
    rows = (withKind.data ?? []) as typeof rows;
  }

  return rows[0]?.id ?? null;
}

/** Channel listing ID (PVID, item id, …) and ASIN → canonical ASIN from product_master. */
async function loadChannelListingToAsinMap(
  marketplace: QcomMarketplace,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await supabase
    .from("product_master")
    .select("product_code, listing_code")
    .eq("marketplace", marketplace);
  if (error) throw new Error(getErrorMessage(error));

  for (const row of data ?? []) {
    const asin = cleanQcomAsin(String(row.product_code ?? ""));
    if (!asin) continue;
    map.set(asin, asin);
    const listing = String(row.listing_code ?? "").trim();
    if (listing) map.set(listing, asin);
    const code = String(row.product_code ?? "").trim();
    if (code && code !== asin) map.set(code, asin);
  }
  return map;
}

function resolveMetricCodeToAsin(
  productCode: string,
  listingToAsin: Map<string, string>,
): string | null {
  const trimmed = productCode.trim();
  if (!trimmed) return null;
  return cleanQcomAsin(trimmed) ?? listingToAsin.get(trimmed) ?? null;
}

/** HO stock row → ASIN for joining channel metrics (sheet ASIN, else FSN via channel catalogue). */
export function resolveHoStockRowAsin(
  row: { asin: string; fsn: string },
  fsnToAsin: Map<string, string>,
): string | null {
  const fromSheet = cleanQcomAsin(row.asin);
  if (fromSheet) return fromSheet;
  for (const fsn of splitFsnCell(row.fsn)) {
    const mapped = fsnToAsin.get(fsn.trim().toUpperCase());
    if (mapped) return mapped;
  }
  return null;
}

async function loadFsnToAsinFromChannelCatalogues(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const listingMaps = await Promise.all(
    QCOM_MARKETPLACES.map((m) => loadChannelListingToAsinMap(m)),
  );
  for (const listingToAsin of listingMaps) {
    for (const [key, asin] of listingToAsin) {
      if (cleanQcomAsin(key)) continue;
      map.set(key.trim().toUpperCase(), asin);
    }
  }
  return map;
}

async function loadLatestQcomChannelMetrics(
  marketplace: QcomMarketplace,
): Promise<Map<string, ChannelStockDemand>> {
  const [uploadId, listingToAsin] = await Promise.all([
    getLatestQcomSelloutUploadId(marketplace),
    loadChannelListingToAsinMap(marketplace),
  ]);

  const map = new Map<string, ChannelStockDemand>();

  async function ingestMetrics(uploadFilter: string | null): Promise<void> {
    let query = supabase
      .from("computed_metrics")
      .select("product_code, inventory_units, drr_units")
      .eq("marketplace", marketplace);
    if (uploadFilter) {
      query = query.eq("upload_id", uploadFilter);
    } else {
      query = query.order("as_of_date", { ascending: false });
    }
    const { data, error } = await query;
    if (error) throw new Error(getErrorMessage(error));

    for (const row of data ?? []) {
      const asin = resolveMetricCodeToAsin(
        String(row.product_code ?? ""),
        listingToAsin,
      );
      if (!asin) continue;
      if (!uploadFilter && map.has(asin)) continue;
      const inv = Number(row.inventory_units ?? 0);
      const drr = Number(row.drr_units ?? 0);
      const prev = map.get(asin);
      if (prev && uploadFilter) {
        map.set(asin, {
          inventory_units: prev.inventory_units + inv,
          drr_units: prev.drr_units + drr,
        });
      } else if (!prev) {
        map.set(asin, { inventory_units: inv, drr_units: drr });
      }
    }
  }

  if (uploadId) {
    await ingestMetrics(uploadId);
  }
  if (map.size === 0) {
    await ingestMetrics(null);
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

export type QcomChannelMetricsContext = {
  byAsin: Map<string, ChannelStockDemand>;
  fsnToAsin: Map<string, string>;
};

/** Cumulative inventory and DRR across Zepto, Blinkit, Big Basket, and Instamart (by ASIN). */
export async function loadQcomChannelMetricsContext(): Promise<QcomChannelMetricsContext> {
  const [byAsin, fsnToAsin] = await Promise.all([
    (async () => {
      const channelsByAsin = new Map<string, ChannelStockDemand>();
      const perChannel = await Promise.all(
        QCOM_MARKETPLACES.map((marketplace) => loadLatestQcomChannelMetrics(marketplace)),
      );
      for (const channelMap of perChannel) {
        mergeChannelMaps(channelsByAsin, channelMap);
      }
      return channelsByAsin;
    })(),
    loadFsnToAsinFromChannelCatalogues(),
  ]);
  return { byAsin, fsnToAsin };
}

/** @deprecated Use {@link loadQcomChannelMetricsContext} */
export async function loadQcomChannelMetricsByAsin(): Promise<
  Map<string, ChannelStockDemand>
> {
  const ctx = await loadQcomChannelMetricsContext();
  return ctx.byAsin;
}
