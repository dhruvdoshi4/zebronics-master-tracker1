import { format } from "date-fns";
import type { ComputedMetric, MetricInput } from "./types";

export function safeDivide(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return 0;
  return a / b;
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
    apr_so_units: Number(input.apr_so_units.toFixed(2)),
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
