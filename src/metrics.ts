import { format } from "date-fns";
import type { ComputedMetric, MetricInput } from "./types";

export function safeDivide(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return 0;
  return a / b;
}

export type ChannelStockDemand = {
  inventory_units: number;
  drr_units: number;
};

/**
 * Network DOC for HO Stock: warehouse + marketplace inventory vs combined daily run rate.
 *
 * Formula (same intent as ops spreadsheets):
 *   (HO + Gurgaon + Amazon inv + Flipkart inv) ÷ (Amazon DRR + Flipkart DRR)
 *
 * Only channels present on the listing are included in the marketplace terms.
 * Returns null when there is stock but no DRR (undefined coverage), not 0 days.
 */
export function computeNetworkDocDays({
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
  const warehouseStock = Math.max(0, ho_units) + Math.max(0, gurgaon_units);
  let marketplaceStock = 0;
  let totalDrr = 0;

  if (amazon) {
    marketplaceStock += Math.max(0, amazon.inventory_units);
    totalDrr += Math.max(0, amazon.drr_units);
  }
  if (flipkart) {
    marketplaceStock += Math.max(0, flipkart.inventory_units);
    totalDrr += Math.max(0, flipkart.drr_units);
  }

  const totalStock = warehouseStock + marketplaceStock;
  if (totalDrr <= 0) {
    return totalStock > 0 ? null : 0;
  }
  return Math.floor(safeDivide(totalStock, totalDrr));
}

export function buildComputedMetric(input: MetricInput): ComputedMetric {
  const drr = Math.max(0, input.drr_units);
  const inventory = Math.max(0, input.inventory_units);
  const docDays =
    input.doc_days_excel !== null && input.doc_days_excel !== undefined
      ? Math.max(0, input.doc_days_excel)
      : safeDivide(inventory, drr);
  const purchaseOrder = Math.max(0, drr * 45 - inventory);

  const row: ComputedMetric = {
    marketplace: input.marketplace,
    product_code: input.product_code,
    as_of_date: input.as_of_date,
    inventory_units: Number(inventory.toFixed(2)),
    total_so_units: Number(input.total_so_units.toFixed(2)),
    may_mtd_units: Number(input.may_mtd_units.toFixed(2)),
    latest_day_so_units: Number((input.latest_day_so_units ?? 0).toFixed(2)),
    apr_so_units: Number(input.apr_so_units.toFixed(2)),
    prior_fy_so_units: Number((input.prior_fy_so_units ?? 0).toFixed(2)),
    drr_units: Number(drr.toFixed(2)),
    doc_days: Number(docDays.toFixed(2)),
    purchase_order_units: Number(purchaseOrder.toFixed(2)),
  };
  if (input.upload_id) {
    row.upload_id = input.upload_id;
  }
  return row;
}

export function monthLabel(dateString: string): string {
  return format(new Date(`${dateString}T00:00:00.000Z`), "MMM dd");
}
