import {
  CATALOG_WORKSPACE_PRAVIN,
  sheetCategoryHaystack,
  type CatalogWorkspace,
} from "./catalog-workspace";
import type { LegacyMarketplace } from "./types";
import { normalizeKey } from "./utils";

/** Top-level sheet categories for Pravin (category analysis + dashboard). */
export const PRAVIN_TOP_CATEGORIES = ["ROMA", "PowerBank"] as const;

export type PravinTopCategory = (typeof PRAVIN_TOP_CATEGORIES)[number];

export type PravinSubCategoryFilter = string;

export const PRAVIN_SUB_CATEGORY_FILTER_OPTIONS: readonly PravinSubCategoryFilter[] = [
  "all",
] as const;

export const PRAVIN_SUB_CATEGORY_FILTER_LABELS: Record<string, string> = {
  all: "All",
};

/** Sheet Sub Category (or Category on ratings) is PowerBank — not ROMA. */
export function isPravinPowerBankSubCategory(
  rawSubCategory: string,
  rawCategory = "",
): boolean {
  const sub = normalizeKey(rawSubCategory);
  const cat = normalizeKey(rawCategory);
  return (
    sub === "powerbank" ||
    sub === "power bank" ||
    cat === "powerbank" ||
    cat === "power bank"
  );
}

/**
 * Pravin sellout scope: any row with a sub category from the ROMA & Powerbank workbook.
 * Top-level rollup: PowerBank only when sub/category is PowerBank; all other subs → ROMA.
 */
export function rowPassesPravinCategoryScope(
  rawCategory: string,
  rawSubCategory: string,
  productName: string,
): boolean {
  const sub = String(rawSubCategory ?? "").trim();
  const cat = String(rawCategory ?? "").trim();
  if (isPravinPowerBankSubCategory(sub, cat)) return true;
  if (sub) return true;
  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);
  if (/\bpower\s*bank\b/.test(hay)) return true;
  return false;
}

export function pravinTopCategoryForRow(
  rawCategory: string,
  rawSubCategory: string,
  productName: string,
): PravinTopCategory | null {
  if (!rowPassesPravinCategoryScope(rawCategory, rawSubCategory, productName)) {
    return null;
  }
  if (isPravinPowerBankSubCategory(rawSubCategory, rawCategory)) {
    return "PowerBank";
  }
  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);
  if (/\bpower\s*bank\b/.test(hay) && !String(rawSubCategory ?? "").trim()) {
    return "PowerBank";
  }
  if (String(rawSubCategory ?? "").trim()) return "ROMA";
  return "ROMA";
}

/** Dashboard / ratings category filter: ROMA vs PowerBank. */
export function pravinDashboardSheetCategory(row: {
  category?: string | null;
  sub_category?: string | null;
  product_name?: string | null;
}): PravinTopCategory | null {
  return pravinTopCategoryForRow(
    String(row.category ?? ""),
    String(row.sub_category ?? ""),
    String(row.product_name ?? ""),
  );
}

/** Stored sub_category = sheet Sub Category label (trimmed). */
export function normalizedPravinSubCategory(
  rawSubCategory: string,
  rawCategory: string,
  productName: string,
): string | null {
  if (!rowPassesPravinCategoryScope(rawCategory, rawSubCategory, productName)) {
    return null;
  }
  const sub = String(rawSubCategory ?? "").trim();
  if (sub) return sub;
  const top = pravinTopCategoryForRow(rawCategory, rawSubCategory, productName);
  return top ?? null;
}

export function productMatchesPravinDashboardScopeForMarketplace(
  row: {
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
    catalog_workspace?: string | null;
  },
  _marketplace: LegacyMarketplace,
): boolean {
  const tagged = String(row.catalog_workspace ?? "").trim();
  if (tagged && tagged !== CATALOG_WORKSPACE_PRAVIN) {
    return false;
  }
  if (tagged === CATALOG_WORKSPACE_PRAVIN) {
    return true;
  }
  return rowPassesPravinCategoryScope(
    String(row.category ?? ""),
    String(row.sub_category ?? ""),
    String(row.product_name ?? ""),
  );
}

export function productMatchesPravinDashboardScope(row: {
  category?: string | null;
  sub_category?: string | null;
  product_name?: string | null;
  catalog_workspace?: string | null;
}): boolean {
  return productMatchesPravinDashboardScopeForMarketplace(row, "amazon");
}

export function productMatchesPravinCategoryRollup(
  subCategory: string,
  row: Pick<
    { category: string | null; sub_category: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
): boolean {
  const sub = String(row.sub_category ?? "").trim();
  if (normalizeKey(sub) !== normalizeKey(subCategory)) return false;
  return productMatchesPravinDashboardScope({
    category: row.category ?? null,
    sub_category: row.sub_category ?? null,
    product_name: row.product_name ?? null,
  });
}

export function productMatchesPravinTopCategory(
  topCategory: string,
  row: Pick<
    { category: string | null; sub_category: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
): boolean {
  const top = pravinTopCategoryForRow(
    String(row.category ?? ""),
    String(row.sub_category ?? ""),
    String(row.product_name ?? ""),
  );
  if (!top) return false;
  return normalizeKey(top) === normalizeKey(topCategory);
}

export function isPravinWorkspace(workspace: CatalogWorkspace): boolean {
  return workspace === CATALOG_WORKSPACE_PRAVIN;
}

export function parsePravinSubCategoryFilterParam(
  raw: string | null | undefined,
): PravinSubCategoryFilter | null {
  const decoded = raw != null ? decodeURIComponent(raw) : "";
  if (decoded === "all") return "all";
  if (decoded.trim()) return decoded.trim();
  return null;
}
