import { displayModelName } from "./product-display";
import { type ChannelStockDemand } from "./metrics";
import { supabase } from "./supabase";
import {
  QCOM_HO_STOCK_CATALOG_MARKETPLACE,
  QCOM_MARKETPLACES,
  type QcomMarketplace,
} from "./types";
import { splitFsnCell } from "./parsers-ho-stock";
import { normalizeKey } from "./utils";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Failed to load QCom channel metrics.";
}

export function cleanQcomAsin(code: string): string | null {
  const v = code.trim().toUpperCase();
  return /^B0[A-Z0-9]{8,}$/i.test(v) ? v : null;
}

function pickCanonicalCatalogKey(productCode: string): string {
  const asin = cleanQcomAsin(productCode);
  return asin ?? productCode.trim().toUpperCase();
}

function preferCatalogKey(a: string, b: string): string {
  const aAsin = cleanQcomAsin(a);
  const bAsin = cleanQcomAsin(b);
  if (aAsin) return aAsin;
  if (bAsin) return bAsin;
  return a.length >= b.length ? a : b;
}

export type QcomCatalogResolver = {
  /** Channel listing / ASIN / FSN / internal code → canonical catalogue key. */
  codeToKey: Map<string, string>;
  /** Normalized model name → canonical catalogue key (cross-channel). */
  modelNameToKey: Map<string, string>;
};

/**
 * Build cross-channel catalogue keys from product_master (all QCom tabs + Consolidated).
 * Channel metrics are stored under PVID / Item ID — this maps them back to the same SKU as HO stock.
 */
export async function loadQcomCatalogResolver(): Promise<QcomCatalogResolver> {
  const codeToKey = new Map<string, string>();
  const modelNameToKey = new Map<string, string>();

  const marketplaces = [
    ...QCOM_MARKETPLACES,
    QCOM_HO_STOCK_CATALOG_MARKETPLACE,
  ] as const;

  type MasterRow = {
    product_code: string;
    product_name: string | null;
    listing_code: string | null;
  };

  const rowsByMarketplace = await Promise.all(
    marketplaces.map(async (marketplace) => {
      const { data, error } = await supabase
        .from("product_master")
        .select("product_code, product_name, listing_code")
        .eq("marketplace", marketplace);
      if (error) throw new Error(getErrorMessage(error));
      return (data ?? []) as MasterRow[];
    }),
  );

  const allRows = rowsByMarketplace.flat();

  for (const row of allRows) {
    const pc = String(row.product_code ?? "").trim();
    if (!pc) continue;
    const name = normalizeKey(displayModelName(row.product_name, pc));
    const key = pickCanonicalCatalogKey(pc);
    if (!name) continue;
    const existing = modelNameToKey.get(name);
    modelNameToKey.set(name, existing ? preferCatalogKey(existing, key) : key);
  }

  for (const row of allRows) {
    const pc = String(row.product_code ?? "").trim();
    if (!pc) continue;
    const listing = String(row.listing_code ?? "").trim();
    const name = normalizeKey(displayModelName(row.product_name, pc));
    const key = name
      ? (modelNameToKey.get(name) ?? pickCanonicalCatalogKey(pc))
      : pickCanonicalCatalogKey(pc);

    const register = (code: string) => {
      const c = code.trim();
      if (!c) return;
      codeToKey.set(c, key);
      codeToKey.set(c.toUpperCase(), key);
    };

    register(pc);
    if (listing) register(listing);
    const asin = cleanQcomAsin(key);
    if (asin) register(asin);
  }

  return { codeToKey, modelNameToKey };
}

export function resolveCatalogKeyFromCode(
  productCode: string,
  resolver: QcomCatalogResolver,
): string | null {
  const trimmed = productCode.trim();
  if (!trimmed) return null;
  return (
    resolver.codeToKey.get(trimmed) ??
    resolver.codeToKey.get(trimmed.toUpperCase()) ??
    cleanQcomAsin(trimmed) ??
    null
  );
}

/** HO stock row → same catalogue key used when summing channel DRR. */
export function resolveHoStockCatalogKey(
  row: { asin: string; fsn: string; model_name: string },
  resolver: QcomCatalogResolver,
): string | null {
  const asinRaw = String(row.asin ?? "").trim();
  if (asinRaw) {
    const hit =
      resolver.codeToKey.get(asinRaw) ??
      resolver.codeToKey.get(asinRaw.toUpperCase()) ??
      cleanQcomAsin(asinRaw);
    if (hit) return hit;
  }

  for (const fsn of splitFsnCell(row.fsn)) {
    const hit = resolver.codeToKey.get(fsn) ?? resolver.codeToKey.get(fsn.toUpperCase());
    if (hit) return hit;
  }

  const name = normalizeKey(row.model_name);
  if (name && resolver.modelNameToKey.has(name)) {
    return resolver.modelNameToKey.get(name)!;
  }

  return null;
}

/** @deprecated Use {@link resolveHoStockCatalogKey} */
export function resolveHoStockRowAsin(
  row: { asin: string; fsn: string },
  fsnToAsin: Map<string, string>,
): string | null {
  void fsnToAsin;
  return cleanQcomAsin(row.asin);
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

type MetricRow = {
  product_code: string;
  inventory_units: number;
  drr_units: number;
};

const METRICS_PAGE_SIZE = 1000;

async function fetchAllChannelMetrics(
  marketplace: QcomMarketplace,
  uploadId: string | null,
): Promise<MetricRow[]> {
  const all: MetricRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("computed_metrics")
      .select("product_code, inventory_units, drr_units")
      .eq("marketplace", marketplace);
    if (uploadId) {
      query = query.eq("upload_id", uploadId);
    } else {
      query = query.order("as_of_date", { ascending: false });
    }
    const { data, error } = await query.range(offset, offset + METRICS_PAGE_SIZE - 1);
    if (error) throw new Error(getErrorMessage(error));

    const batch = (data ?? []) as MetricRow[];
    all.push(...batch);
    if (batch.length < METRICS_PAGE_SIZE) break;
    offset += METRICS_PAGE_SIZE;
  }

  return all;
}

/** One channel tab: DRR/inventory rolled up to catalogue key (sums duplicate codes on that tab). */
async function loadPerChannelMetricsByCatalogKey(
  marketplace: QcomMarketplace,
  resolver: QcomCatalogResolver,
): Promise<Map<string, ChannelStockDemand>> {
  const uploadId = await getLatestQcomSelloutUploadId(marketplace);
  let metrics = uploadId ? await fetchAllChannelMetrics(marketplace, uploadId) : [];
  if (metrics.length === 0) {
    metrics = await fetchAllChannelMetrics(marketplace, null);
  }

  const byKey = new Map<string, ChannelStockDemand>();

  for (const row of metrics) {
    const catalogKey = resolveCatalogKeyFromCode(String(row.product_code ?? ""), resolver);
    if (!catalogKey) continue;

    const inv = Number(row.inventory_units ?? 0);
    const drr = Number(row.drr_units ?? 0);
    const prev = byKey.get(catalogKey);
    byKey.set(catalogKey, {
      inventory_units: (prev?.inventory_units ?? 0) + inv,
      drr_units: (prev?.drr_units ?? 0) + drr,
    });
  }

  return byKey;
}

/**
 * Cumulative DRR = sum of each channel's DRR for the same catalogue SKU.
 * Example: Zepto 2 + Blinkit 2 + Instamart 2 + Big Basket 2 → 8.
 */
export function sumQcomCumulativeMetrics(
  perChannel: Map<string, ChannelStockDemand>[],
): Map<string, ChannelStockDemand> {
  const cumulative = new Map<string, ChannelStockDemand>();

  for (const channelMap of perChannel) {
    for (const [catalogKey, slice] of channelMap) {
      const prev = cumulative.get(catalogKey) ?? {
        inventory_units: 0,
        drr_units: 0,
      };
      cumulative.set(catalogKey, {
        inventory_units: prev.inventory_units + slice.inventory_units,
        drr_units: prev.drr_units + slice.drr_units,
      });
    }
  }

  return cumulative;
}

export type QcomChannelMetricsContext = {
  byAsin: Map<string, ChannelStockDemand>;
  resolver: QcomCatalogResolver;
  perChannel: Record<QcomMarketplace, Map<string, ChannelStockDemand>>;
};

/** Cumulative inventory and DRR across Zepto, Blinkit, Big Basket, and Instamart. */
export async function loadQcomChannelMetricsContext(): Promise<QcomChannelMetricsContext> {
  const resolver = await loadQcomCatalogResolver();

  const perChannelList = await Promise.all(
    QCOM_MARKETPLACES.map(async (marketplace) => ({
      marketplace,
      map: await loadPerChannelMetricsByCatalogKey(marketplace, resolver),
    })),
  );

  const perChannel = {} as Record<QcomMarketplace, Map<string, ChannelStockDemand>>;
  for (const { marketplace, map } of perChannelList) {
    perChannel[marketplace] = map;
  }

  const byAsin = sumQcomCumulativeMetrics(perChannelList.map((p) => p.map));

  return { byAsin, resolver, perChannel };
}

/** @deprecated Use {@link loadQcomChannelMetricsContext} */
export async function loadQcomChannelMetricsByAsin(): Promise<
  Map<string, ChannelStockDemand>
> {
  const ctx = await loadQcomChannelMetricsContext();
  return ctx.byAsin;
}
