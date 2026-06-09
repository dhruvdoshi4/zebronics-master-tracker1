import * as XLSX from "xlsx";
import { formatMarginPercent } from "./pricing";
import type { ProductMasterPricingRow } from "./data-product-pricing";
import type { LegacyMarketplace } from "./types";
import { formatInr } from "./utils";

function channelLabel(marketplace: LegacyMarketplace): string {
  return marketplace === "amazon" ? "Amazon" : "Flipkart";
}

export function exportProductMasterTableToExcel(
  rows: ProductMasterPricingRow[],
  marketplace: LegacyMarketplace,
  fileName?: string,
): void {
  const codeLabel = marketplace === "amazon" ? "ASIN" : "FSN";
  const sheetRows = rows.map((row) => {
    const p = row.pricing;
    return {
      [codeLabel]: row.product_code,
      Model: row.product_name,
      Category: row.category ?? "",
      "Sub category": row.sub_category ?? "",
      "BAU SP": p.bau_sp,
      "Margin %": formatMarginPercent(p.bau_margin_pct),
      "Basic SP": p.basic_sp,
      "Event SP": p.event_sp,
      "Event margin %": formatMarginPercent(p.event_margin_pct),
      "Event basic": p.event_basic,
      Flat: p.is_flat_price ? "Yes" : "No",
      "Basic support PU": p.basic_support_pu,
      "Base IBD": p.base_ibd,
      "Top up IBD": p.top_up_ibd,
      NEP: p.nep,
      "Net real %": p.resolved_net_real_factor * 100,
      "Coupon value": p.resolved_coupon_value,
      "Coupon support %": p.resolved_coupon_support_pct * 100,
      "Coupon deduction": p.coupon_deduction,
      "Net realisation": p.net_realisation,
      DRR: row.drr_units,
      ATP: row.atp_units,
      HO: row.ho_stock_units,
    };
  });

  const ws = XLSX.utils.json_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Product Master");
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(
    wb,
    fileName ?? `product-master-${marketplace}-${stamp}.xlsx`,
  );
}

/** Human-readable export for clipboard/debug (not used in UI). */
export function formatProductMasterRowSummary(row: ProductMasterPricingRow): string {
  const p = row.pricing;
  return `${row.product_code}: BAU ${formatInr(p.bau_sp)} · Basic ${formatInr(p.basic_sp)} · Net ${formatInr(p.net_realisation)}`;
}

export { channelLabel };
