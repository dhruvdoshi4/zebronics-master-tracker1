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

/**
 * Any product_code / listing_code on this channel tab → canonical ASIN (when Consolidated linked).
 */
async function loadChannelCodeToAsinMap(
  marketplace: QcomMarketplace,
): Promise<Map<string, string>> {
  const codeToAsin = new Map<string, string>();
  const { data, error } = await supabase
    .from("product_master")
    .select("product_code, listing_code")
    .eq("marketplace", marketplace);
  if (error) throw new Error(getErrorMessage(error));

  for (const row of data ?? []) {
    const pc = String(row.product_code ?? "").trim();
    const listing = String(row.listing_code ?? "").trim();
    const asin = cleanQcomAsin(pc);
    if (!asin) continue;
    codeToAsin.set(asin, asin);
    if (pc) codeToAsin.set(pc, asin);
    if (listing) codeToAsin.set(listing, asin);
  }

  for (const row of data ?? []) {
    const pc = String(row.product_code ?? "").trim();
    if (!pc || codeToAsin.has(pc)) continue;
    const listing = String(row.listing_code ?? "").trim();
    if (listing && codeToAsin.has(listing)) {
      codeToAsin.set(pc, codeToAsin.get(listing)!);
    }
  }

  return codeToAsin;
}

function resolveMetricCodeToAsin(
  productCode: string,
  codeToAsin: Map<string, string>,
): string | null {
  const trimmed = productCode.trim();
  if (!trimmed) return null;
  return cleanQcomAsin(trimmed) ?? codeToAsin.get(trimmed) ?? null;
}

type MetricRow = {
  product_code: string;
  inventory_units: number;
  drr_units: number;
};

/** Latest sellout metrics for one channel, rolled up to ASIN (sums duplicate rows on that tab only). */
async function loadPerChannelMetricsByAsin(
  marketplace: QcomMarketplace,
): Promise<Map<string, ChannelStockDemand>> {
  const [uploadId, codeToAsin] = await Promise.all([
    getLatestQcomSelloutUploadId(marketplace),
    loadChannelCodeToAsinMap(marketplace),
  ]);

  const byAsin = new Map<string, ChannelStockDemand>();

  async function ingest(uploadFilter: string | null): Promise<void> {
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

    for (const row of (data ?? []) as MetricRow[]) {
      const asin = resolveMetricCodeToAsin(String(row.product_code ?? ""), codeToAsin);
      if (!asin) continue;
      if (!uploadFilter && byAsin.has(asin)) continue;

      const inv = Number(row.inventory_units ?? 0);
      const drr = Number(row.drr_units ?? 0);
      const prev = byAsin.get(asin);
      byAsin.set(asin, {
        inventory_units: (prev?.inventory_units ?? 0) + inv,
        drr_units: (prev?.drr_units ?? 0) + drr,
      });
    }
  }

  if (uploadId) {
    await ingest(uploadId);
  }
  if (byAsin.size === 0) {
    await ingest(null);
  }

  return byAsin;
}

/**
 * Cumulative DRR = sum of each channel's DRR for the same ASIN.
 * Example: Zepto 2 + Blinkit 2 + Instamart 2 + Big Basket 2 → 8.
 */
export function sumQcomCumulativeMetrics(
  perChannel: Map<string, ChannelStockDemand>[],
): Map<string, ChannelStockDemand> {
  const cumulative = new Map<string, ChannelStockDemand>();

  for (const channelMap of perChannel) {
    for (const [asin, slice] of channelMap) {
      const prev = cumulative.get(asin) ?? { inventory_units: 0, drr_units: 0 };
      cumulative.set(asin, {
        inventory_units: prev.inventory_units + slice.inventory_units,
        drr_units: prev.drr_units + slice.drr_units,
      });
    }
  }

  return cumulative;
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
    QCOM_MARKETPLACES.map((m) => loadChannelCodeToAsinMap(m)),
  );
  for (const codeToAsin of listingMaps) {
    for (const [key, asin] of codeToAsin) {
      if (cleanQcomAsin(key)) continue;
      map.set(key.trim().toUpperCase(), asin);
    }
  }
  return map;
}

export type QcomChannelMetricsContext = {
  byAsin: Map<string, ChannelStockDemand>;
  fsnToAsin: Map<string, string>;
  /** Per-channel ASIN metrics (zepto, blinkit, bigbasket, instamart) for debugging/display if needed. */
  perChannel: Record<QcomMarketplace, Map<string, ChannelStockDemand>>;
};

/** Cumulative inventory and DRR across Zepto, Blinkit, Big Basket, and Instamart (by ASIN). */
export async function loadQcomChannelMetricsContext(): Promise<QcomChannelMetricsContext> {
  const perChannelList = await Promise.all(
    QCOM_MARKETPLACES.map(async (marketplace) => ({
      marketplace,
      map: await loadPerChannelMetricsByAsin(marketplace),
    })),
  );

  const perChannel = {} as Record<QcomMarketplace, Map<string, ChannelStockDemand>>;
  for (const { marketplace, map } of perChannelList) {
    perChannel[marketplace] = map;
  }

  const [byAsin, fsnToAsin] = await Promise.all([
    Promise.resolve(sumQcomCumulativeMetrics(perChannelList.map((p) => p.map))),
    loadFsnToAsinFromChannelCatalogues(),
  ]);

  return { byAsin, fsnToAsin, perChannel };
}

/** @deprecated Use {@link loadQcomChannelMetricsContext} */
export async function loadQcomChannelMetricsByAsin(): Promise<
  Map<string, ChannelStockDemand>
> {
  const ctx = await loadQcomChannelMetricsContext();
  return ctx.byAsin;
}
