/**
 * HO Stock network coverage — shared across HO Stock, PO dashboard, sellout dashboard, etc.
 *
 * Not used for daWg data scope. Quick Commerce HO Stock uses {@link computeCombinedNetworkDocDays}
 * (Amazon + Flipkart + QCom + warehouse).
 *
 * Formula (same as HO Stock category tables):
 *   DOC = (HO + Gurgaon + Amazon inv + Flipkart inv) ÷ (Amazon DRR + Flipkart DRR)
 *
 * DRR values come from workspace-scoped sellout uploads (see sellout-drr-sheet-contract.ts).
 */

import type { CatalogWorkspace } from "./catalog-workspace";
import { CATALOG_WORKSPACE_MONITOR } from "./catalog-workspace";
import {
  channelDrrForMarketplace,
  computeNetworkDocFromSlices,
  loadHoStockChannelMetricMaps,
  resolveChannelSlices,
  type HoStockChannelMaps,
} from "./ho-stock-channel-metrics";
import type { ComputedMetric } from "./types";
import {
  fetchAllHoStockSnapshotRows,
  getLatestGlobalHoStockUpload,
  type HoStockUnits,
} from "./ho-stock-snapshot-query";
import { splitFsnCell } from "./parsers-ho-stock";
import type { DataScope, Marketplace } from "./types";

export type { HoStockChannelMaps } from "./ho-stock-channel-metrics";

export type HoStockNetworkFields = {
  ho_units: number;
  gurgaon_units: number;
  amazon_inventory_units: number;
  flipkart_inventory_units: number;
  amazon_drr_units: number;
  flipkart_drr_units: number;
  network_doc_days: number | null;
};

export const EMPTY_HO_STOCK_NETWORK: HoStockNetworkFields = {
  ho_units: 0,
  gurgaon_units: 0,
  amazon_inventory_units: 0,
  flipkart_inventory_units: 0,
  amazon_drr_units: 0,
  flipkart_drr_units: 0,
  network_doc_days: null,
};

export type HoStockSnapshotSlice = {
  asin: string;
  fsn: string;
  erp_product_id: string;
  ho_units: number;
  gurgaon_units: number;
};

export type HoStockNetworkContext = {
  hoByAsin: Map<string, HoStockSnapshotSlice>;
  hoByErpId: Map<string, HoStockSnapshotSlice>;
  hoByFsn: Map<string, HoStockSnapshotSlice>;
  channelMaps: HoStockChannelMaps;
  snapshotDate: string | null;
  fileName: string | null;
};

export function usesHoStockNetworkPattern(dataScope?: DataScope | null): boolean {
  return dataScope !== "dawg";
}

/** HO + Gurgaon + linked Amazon / Flipkart channel inventory. */
export function networkInventoryUnits(fields: HoStockNetworkFields): number {
  return (
    Math.max(0, fields.ho_units) +
    Math.max(0, fields.gurgaon_units) +
    Math.max(0, fields.amazon_inventory_units) +
    Math.max(0, fields.flipkart_inventory_units)
  );
}

/** Network DOC when HO context is loaded; otherwise channel-only DOC from the metric row. */
export function effectiveNetworkDocDays(row: {
  network_doc_days?: number | null;
  doc_days?: number;
}): number | null {
  if (row.network_doc_days !== undefined) return row.network_doc_days;
  const channelDoc = row.doc_days;
  return channelDoc !== undefined && Number.isFinite(channelDoc) ? channelDoc : null;
}

/**
 * Apply HO Stock network DOC (and channel DRR for display) to a sellout metric row.
 * PO stays on marketplace inventory: max(0, 28-day avg × 28 − channel inventory).
 * Skipped for Quick Commerce marketplaces and daWg scope (callers must gate).
 */
export function applyHoStockNetworkToMetricRow<
  T extends ComputedMetric & Partial<HoStockNetworkFields>,
>(row: T, opts: { hoNetworkActive: boolean }): T {
  if (!opts.hoNetworkActive) return row;

  const networkDoc = row.network_doc_days;
  const doc_days =
    networkDoc !== null && networkDoc !== undefined ? networkDoc : (row.doc_days ?? 0);

  const displayDrr = channelDrrForMarketplace(row.marketplace, {
    amazon_drr_units: row.amazon_drr_units ?? 0,
    flipkart_drr_units: row.flipkart_drr_units ?? 0,
    fallback_drr_units: row.drr_units,
  });

  return {
    ...row,
    doc_days,
    drr_units: displayDrr > 0 ? displayDrr : row.drr_units,
  };
}

function parseHoSnapshotRow(raw: Record<string, unknown>): HoStockSnapshotSlice {
  return {
    asin: String(raw.asin ?? "").trim().toUpperCase(),
    fsn: String(raw.fsn ?? "").trim(),
    erp_product_id: String(raw.erp_product_id ?? "").trim(),
    ho_units: Number(raw.ho_units ?? 0),
    gurgaon_units: Number(raw.gurgaon_units ?? 0),
  };
}

export async function loadHoStockNetworkContext(
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
): Promise<HoStockNetworkContext | null> {
  const upload = await getLatestGlobalHoStockUpload();
  if (!upload) return null;

  const rows = await fetchAllHoStockSnapshotRows(
    upload.id,
    "asin, fsn, erp_product_id, ho_units, gurgaon_units",
  );

  const hoByAsin = new Map<string, HoStockSnapshotSlice>();
  const hoByErpId = new Map<string, HoStockSnapshotSlice>();
  const hoByFsn = new Map<string, HoStockSnapshotSlice>();

  for (const raw of rows) {
    const slice = parseHoSnapshotRow(raw);
    if (slice.asin) hoByAsin.set(slice.asin, slice);
    if (slice.erp_product_id) hoByErpId.set(slice.erp_product_id, slice);
    for (const fsn of splitFsnCell(slice.fsn)) {
      hoByFsn.set(fsn, slice);
    }
  }

  const channelMaps = await loadHoStockChannelMetricMaps(catalogWorkspace);

  return {
    hoByAsin,
    hoByErpId,
    hoByFsn,
    channelMaps,
    snapshotDate: upload.snapshot_date,
    fileName: upload.file_name,
  };
}

export function resolveHoSnapshotSlice(
  ctx: HoStockNetworkContext,
  opts: {
    asin?: string;
    fsn?: string;
    erpProductId?: string;
  },
): HoStockSnapshotSlice | null {
  const pid = String(opts.erpProductId ?? "").trim();
  if (pid && ctx.hoByErpId.has(pid)) return ctx.hoByErpId.get(pid)!;

  const asin = String(opts.asin ?? "").trim().toUpperCase();
  if (asin && ctx.hoByAsin.has(asin)) return ctx.hoByAsin.get(asin)!;

  const fsn = String(opts.fsn ?? "").trim().toUpperCase();
  if (fsn && ctx.hoByFsn.has(fsn)) return ctx.hoByFsn.get(fsn)!;

  for (const part of splitFsnCell(opts.fsn ?? "")) {
    if (ctx.hoByFsn.has(part)) return ctx.hoByFsn.get(part)!;
  }

  return null;
}

export function computeHoStockNetworkFields(
  ctx: HoStockNetworkContext,
  opts: {
    asin?: string;
    fsn?: string;
    erpProductId?: string;
  },
): HoStockNetworkFields {
  const ho =
    resolveHoSnapshotSlice(ctx, opts) ??
    ({
      asin: String(opts.asin ?? "").trim().toUpperCase(),
      fsn: String(opts.fsn ?? "").trim(),
      erp_product_id: String(opts.erpProductId ?? "").trim(),
      ho_units: 0,
      gurgaon_units: 0,
    } satisfies HoStockSnapshotSlice);

  const asin = ho.asin || String(opts.asin ?? "").trim().toUpperCase();
  const fsn = ho.fsn || String(opts.fsn ?? "").trim();
  const { amazon, flipkart } = resolveChannelSlices(ctx.channelMaps, asin, fsn);

  const network_doc_days = computeNetworkDocFromSlices({
    ho_units: ho.ho_units,
    gurgaon_units: ho.gurgaon_units,
    amazon,
    flipkart,
  });

  return {
    ho_units: ho.ho_units,
    gurgaon_units: ho.gurgaon_units,
    amazon_inventory_units: amazon?.inventory_units ?? 0,
    flipkart_inventory_units: flipkart?.inventory_units ?? 0,
    amazon_drr_units: amazon?.drr_units ?? 0,
    flipkart_drr_units: flipkart?.drr_units ?? 0,
    network_doc_days,
  };
}

export function attachHoStockNetworkFields<T extends object>(
  row: T,
  ctx: HoStockNetworkContext | null,
  opts: {
    marketplace: Marketplace;
    productCode: string;
    erpProductId?: string | null;
    dataScope?: DataScope | null;
  },
): T & HoStockNetworkFields {
  if (!ctx || !usesHoStockNetworkPattern(opts.dataScope)) {
    return { ...row, ...EMPTY_HO_STOCK_NETWORK };
  }

  const asin = opts.marketplace === "amazon" ? opts.productCode : undefined;
  const fsn = opts.marketplace === "flipkart" ? opts.productCode : undefined;

  return {
    ...row,
    ...computeHoStockNetworkFields(ctx, {
      asin,
      fsn,
      erpProductId: opts.erpProductId ?? undefined,
    }),
  };
}

export type HoStockNetworkSnapshot = HoStockUnits & HoStockNetworkFields;

/** Product / PO pages — HO warehouse + network DOC for a listing. */
export async function fetchHoStockNetworkForProduct(opts: {
  catalogWorkspace: CatalogWorkspace;
  marketplace: "amazon" | "flipkart";
  productCode: string;
  erpProductId?: string | null;
}): Promise<HoStockNetworkSnapshot | null> {
  const ctx = await loadHoStockNetworkContext(opts.catalogWorkspace);
  if (!ctx) return null;

  const slice = resolveHoSnapshotSlice(ctx, {
    asin: opts.marketplace === "amazon" ? opts.productCode : undefined,
    fsn: opts.marketplace === "flipkart" ? opts.productCode : undefined,
    erpProductId: opts.erpProductId ?? undefined,
  });

  if (!slice) return null;

  const network = computeHoStockNetworkFields(ctx, {
    asin: slice.asin,
    fsn: slice.fsn,
    erpProductId: slice.erp_product_id,
  });

  return {
    ...network,
    total_units: network.ho_units + network.gurgaon_units,
    snapshotDate: ctx.snapshotDate,
    fileName: ctx.fileName,
  };
}
