import {
  CORE_SELL_OUT_SUB_CATEGORY_SET,
  buildSelloutClassificationHaystack,
  isCartridgeSheetCategory,
  isExcludedNonDisplaySelloutProduct,
} from "./sellout-category-scope";
import type { ProductMaster } from "./types";
import { normalizeKey } from "./utils";

/**
 * Hari monitor + projector workspace — Amazon / Flipkart PO & ratings rows.
 * Kept separate from data.ts to avoid circular imports with manager-dashboard-scope.
 */

export function isMonitorAccessorySheetCategory(category: string | null | undefined): boolean {
  const c = normalizeKey(category ?? "");
  if (!c) return false;
  return c.includes("monitor") && (c.includes("acc") || c.includes("accessor"));
}

export function isProjectorAccessorySheetCategory(category: string | null | undefined): boolean {
  const c = normalizeKey(category ?? "");
  if (!c) return false;
  return c.includes("projector") && (c.includes("acc") || c.includes("accessor"));
}

export function isMarketplaceDashboardSheetCategory(
  category: string | null | undefined,
): boolean {
  const c = normalizeKey(category ?? "");
  if (!c) return false;
  if (isCartridgeSheetCategory(category)) return true;
  if (isMonitorAccessorySheetCategory(category)) return true;
  if (isProjectorAccessorySheetCategory(category)) return true;
  return false;
}

export type HariDashboardRow = Pick<ProductMaster, "category" | "sub_category"> & {
  product_name?: string | null;
};

function rowHaystack(row: HariDashboardRow): string {
  return buildSelloutClassificationHaystack(
    String(row.category ?? ""),
    String(row.sub_category ?? ""),
    String(row.product_name ?? ""),
  );
}

/** True when a product belongs on Hari's Amazon / Flipkart dashboards. */
export function productMatchesHariMonitorProjectorDashboardScope(row: HariDashboardRow): boolean {
  const sub = normalizeKey(row.sub_category ?? "");
  if (isCartridgeSheetCategory(row.category) || sub === "cartridge") {
    return true;
  }
  if (CORE_SELL_OUT_SUB_CATEGORY_SET.has(sub)) {
    return !isExcludedNonDisplaySelloutProduct(rowHaystack(row));
  }
  const cat = String(row.category ?? "").trim();
  if (!isMarketplaceDashboardSheetCategory(cat)) return false;
  return !isExcludedNonDisplaySelloutProduct(rowHaystack(row));
}
