import {
  CATALOG_WORKSPACE_MONITOR,
  parseWorkspaceToken,
  type CatalogWorkspace,
} from "./catalog-workspace";
import {
  getLatestUploadContextByMarketplace,
  listWorkspaceSelloutUploadIds,
  type UploadContextScope,
} from "./data";
import {
  computeNetworkDocDays,
  selloutDrrUnits,
  type ChannelStockDemand,
} from "./metrics";
import { splitFsnCell } from "./parsers-ho-stock";
import { supabase } from "./supabase";
import type { ComputedMetric, Marketplace } from "./types";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Unknown error";
}

export type HoStockChannelMaps = {
  amazon: Map<string, ChannelStockDemand>;
  flipkart: Map<string, ChannelStockDemand>;
};

function catalogWorkspaceFromScope(scope: UploadContextScope): CatalogWorkspace | null {
  return typeof scope === "string" ? parseWorkspaceToken(scope) : null;
}

function metricsRowsToMap(rows: ComputedMetric[]): Map<string, ChannelStockDemand> {
  const map = new Map<string, ChannelStockDemand>();
  for (const row of rows) {
    const code = String(row.product_code ?? "")
      .trim()
      .toUpperCase();
    if (!code || map.has(code)) continue;
    map.set(code, {
      inventory_units: Number(row.inventory_units ?? 0),
      drr_units: selloutDrrUnits(row),
    });
  }
  return map;
}

/** Latest completed sellout per channel for the active catalog workspace (Monitor, Rithika, etc.). */
export async function loadHoStockChannelMetricMaps(
  scope: UploadContextScope = CATALOG_WORKSPACE_MONITOR,
): Promise<HoStockChannelMaps> {
  const uploadCtx = await getLatestUploadContextByMarketplace(scope);
  const workspaceScope = catalogWorkspaceFromScope(scope);

  async function loadMap(
    marketplace: "amazon" | "flipkart",
  ): Promise<Map<string, ChannelStockDemand>> {
    async function fetchRowsByUploadId(uploadId: string | null) {
      if (!uploadId) return [] as ComputedMetric[];
      const { data, error } = await supabase
        .from("computed_metrics")
        .select("product_code, inventory_units, drr_units")
        .eq("marketplace", marketplace)
        .eq("upload_id", uploadId);
      if (error) throw new Error(getErrorMessage(error));
      return (data ?? []) as ComputedMetric[];
    }

    const ctx = uploadCtx[marketplace];
    let rows = await fetchRowsByUploadId(ctx?.id ?? null);

    /**
     * If the newest upload has zero metric rows (bad/partial upload), walk recent workspace uploads
     * and use the first one with KPI rows. Mirrors dashboard sellout fallback behavior.
     */
    if (rows.length === 0 && workspaceScope) {
      const recent = await listWorkspaceSelloutUploadIds(marketplace, workspaceScope, 12);
      const tried = new Set<string>(ctx?.id ? [ctx.id] : []);
      for (const upload of recent) {
        if (tried.has(upload.id)) continue;
        rows = await fetchRowsByUploadId(upload.id);
        if (rows.length > 0) break;
      }
    }

    return metricsRowsToMap(rows);
  }

  const [amazon, flipkart] = await Promise.all([loadMap("amazon"), loadMap("flipkart")]);
  return { amazon, flipkart };
}

export function flipkartChannelTotals(
  fsnCell: string,
  flipkart: Map<string, ChannelStockDemand>,
): ChannelStockDemand {
  let inventory_units = 0;
  let drr_units = 0;
  for (const code of splitFsnCell(fsnCell)) {
    const metric = flipkart.get(code);
    if (!metric) continue;
    inventory_units += metric.inventory_units;
    drr_units += metric.drr_units;
  }
  return { inventory_units, drr_units };
}

export function computeNetworkDocFromSlices({
  ho_units,
  gurgaon_units,
  amazon,
  flipkart,
}: {
  ho_units: number;
  gurgaon_units: number;
  amazon?: ChannelStockDemand | null;
  flipkart?: ChannelStockDemand | null;
}): number | null {
  return computeNetworkDocDays({
    ho_units,
    gurgaon_units,
    amazon,
    flipkart,
  });
}

export function resolveChannelSlices(
  maps: HoStockChannelMaps,
  asin: string,
  fsn: string,
): {
  amazon: ChannelStockDemand | null;
  flipkart: ChannelStockDemand | null;
} {
  const asinKey = asin.trim().toUpperCase();
  const hasAmazon = asinKey.length > 0;
  const hasFlipkart = splitFsnCell(fsn).length > 0;
  return {
    amazon: hasAmazon ? (maps.amazon.get(asinKey) ?? { inventory_units: 0, drr_units: 0 }) : null,
    flipkart: hasFlipkart ? flipkartChannelTotals(fsn, maps.flipkart) : null,
  };
}

/** Primary DRR column for a single-channel marketplace dashboard row. */
export function channelDrrForMarketplace(
  marketplace: Marketplace,
  fields: {
    amazon_drr_units: number;
    flipkart_drr_units: number;
    fallback_drr_units?: number;
  },
): number {
  if (marketplace === "amazon") {
    return fields.amazon_drr_units > 0
      ? fields.amazon_drr_units
      : (fields.fallback_drr_units ?? 0);
  }
  if (marketplace === "flipkart") {
    return fields.flipkart_drr_units > 0
      ? fields.flipkart_drr_units
      : (fields.fallback_drr_units ?? 0);
  }
  return fields.fallback_drr_units ?? 0;
}
