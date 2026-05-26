import {
  CATALOG_WORKSPACE_PRAVIN,
  sheetCategoryHaystack,
  type CatalogWorkspace,
} from "./catalog-workspace";
import type { LegacyMarketplace } from "./types";
import { normalizeKey } from "./utils";

/** Top-level sheet categories for Pravin (category analysis dropdown). */
export const PRAVIN_TOP_CATEGORIES = ["ROMA", "PowerBank"] as const;

export type PravinTopCategory = (typeof PRAVIN_TOP_CATEGORIES)[number];

export type PravinSubCategoryFilter = string;

export const PRAVIN_SUB_CATEGORY_FILTER_OPTIONS: readonly PravinSubCategoryFilter[] = [
  "all",
] as const;

export const PRAVIN_SUB_CATEGORY_FILTER_LABELS: Record<string, string> = {
  all: "All",
};

function isPowerBank(cat: string, sub: string, hay: string): boolean {
  if (cat === "powerbank" || cat === "power bank") return true;
  if (sub === "powerbank" || sub === "power bank") return true;
  if (/\bpower\s*bank\b/.test(hay)) return true;
  return false;
}

function isExcludedPravinSub(sub: string): boolean {
  if (/\b(bike|selfie|smart\s*tag)\b/.test(sub)) return true;
  return false;
}

function isRomaAccessorySub(sub: string): boolean {
  if (!sub || isExcludedPravinSub(sub) || isPowerBank("", sub, sub)) return false;
  if (
    /\b(cable|otg|adapter|charger|holder|charging pad|induction|universal adapter|cable protector)\b/.test(
      sub,
    )
  ) {
    return true;
  }
  if (sub.includes("mobile adapter") || sub.includes("mobile holder")) return true;
  if (sub.includes("car charger") || sub.includes("car mobile")) return true;
  return false;
}

function isRomaCategory(cat: string): boolean {
  return cat === "roma" || cat === "cables" || cat === "cable";
}

/** Row belongs to Pravin if it is PowerBank or ROMA accessories (not IT/gaming/audio). */
export function rowPassesPravinCategoryScope(
  rawCategory: string,
  rawSubCategory: string,
  productName: string,
): boolean {
  const cat = normalizeKey(rawCategory);
  const sub = normalizeKey(rawSubCategory);
  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);

  if (isPowerBank(cat, sub, hay)) return true;

  if (isRomaCategory(cat) && !isPowerBank(cat, sub, hay)) return true;

  if (isRomaAccessorySub(sub)) return true;

  if (isRomaCategory(cat) && sub) return true;

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
  const cat = normalizeKey(rawCategory);
  const sub = normalizeKey(rawSubCategory);
  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);
  if (isPowerBank(cat, sub, hay)) return "PowerBank";
  return "ROMA";
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
  if (
    row.catalog_workspace &&
    row.catalog_workspace !== CATALOG_WORKSPACE_PRAVIN
  ) {
    return false;
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
