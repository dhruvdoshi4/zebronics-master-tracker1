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

/** ROMA sheet Sub categories (PowerBank is a separate top category). */
export const PRAVIN_ROMA_SUB_CATEGORIES = [
  "3 in 1",
  "Bike Mobile Holder",
  "Cable",
  "Cable Protector",
  "Car Charger",
  "Car Mobile Holder",
  "Charging Pad",
  "Induction charger with Cleaning Kit",
  "Mobile Holder",
  "Mobile Stand",
  "Smart Tag",
  "Universal Adapter",
] as const;

export const PRAVIN_POWERBANK_SUB_LABEL = "PowerBank";

export const PRAVIN_SUB_CATEGORY_FILTER_OPTIONS: readonly string[] = [
  "all",
  ...PRAVIN_ROMA_SUB_CATEGORIES,
  PRAVIN_POWERBANK_SUB_LABEL,
];

export const PRAVIN_SUB_CATEGORY_FILTER_LABELS: Record<string, string> = {
  all: "All",
  ...Object.fromEntries(PRAVIN_ROMA_SUB_CATEGORIES.map((s) => [s, s])),
  [PRAVIN_POWERBANK_SUB_LABEL]: PRAVIN_POWERBANK_SUB_LABEL,
};

/** Dashboard sub filter — ROMA sheet subs + PowerBank (not limited to loaded PO rows). */
export function pravinDashboardSubCategoryDisplayOptions(topCategory: string): string[] {
  const sort = (a: string, b: string) =>
    a.localeCompare(b, "en-IN", { numeric: true, sensitivity: "base" });
  const all = [...PRAVIN_ROMA_SUB_CATEGORIES, PRAVIN_POWERBANK_SUB_LABEL];
  if (topCategory === "all") return [...all].sort(sort);
  if (normalizeKey(topCategory) === normalizeKey("ROMA")) {
    return [...PRAVIN_ROMA_SUB_CATEGORIES].sort(sort);
  }
  if (normalizeKey(topCategory) === normalizeKey(PRAVIN_POWERBANK_SUB_LABEL)) {
    return [PRAVIN_POWERBANK_SUB_LABEL];
  }
  return [];
}

function isRomaCategoryColumn(rawCategory: string): boolean {
  const cat = normalizeKey(rawCategory);
  return cat === "roma" || cat.includes("roma");
}

/** Pravin-owned ROMA / cable / holder rows — Karan must not ingest. */
export function isPravinManagedRomaSub(rawSubCategory: string, rawCategory: string): boolean {
  if (isPravinPowerBankSubCategory(rawSubCategory, rawCategory)) return true;
  if (isRomaCategoryColumn(rawCategory)) return true;
  const sub = normalizeKey(rawSubCategory);
  if (!sub) return false;
  for (const label of PRAVIN_ROMA_SUB_CATEGORIES) {
    if (normalizeKey(label) === sub) return true;
  }
  if (sub.includes("cable") && !sub.includes("pc cable")) return true;
  if (sub.includes("mobile holder") || sub.includes("car mobile")) return true;
  return false;
}

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
  if (isRomaCategoryColumn(cat)) return true;
  if (sub) return true;
  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);
  if (/\bpower\s*bank\b/.test(hay)) return true;
  return false;
}

/** ROMA vs PowerBank for dashboard / ratings filters (sheet Category or Sub category). */
export function resolvePravinDashboardTopCategory(
  rawCategory: string,
  rawSubCategory: string,
  productName: string,
): PravinTopCategory | null {
  const cat = String(rawCategory ?? "").trim();
  const sub = String(rawSubCategory ?? "").trim();
  if (isPravinPowerBankSubCategory(sub, cat)) return "PowerBank";
  const normCat = normalizeKey(cat);
  if (normCat === "powerbank" || normCat === "power bank") return "PowerBank";
  if (isRomaCategoryColumn(cat)) return "ROMA";
  if (!rowPassesPravinCategoryScope(cat, sub, productName)) return null;
  return pravinTopCategoryForRow(cat, sub, productName);
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
  const sub = String(rawSubCategory ?? "").trim();
  if (sub && isRomaCategoryColumn(rawCategory)) return "ROMA";
  if (sub) return "ROMA";
  return "ROMA";
}

/** Dashboard / ratings category filter: ROMA vs PowerBank. */
export function pravinDashboardSheetCategory(row: {
  category?: string | null;
  sub_category?: string | null;
  product_name?: string | null;
}): PravinTopCategory | null {
  return resolvePravinDashboardTopCategory(
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
  const top = resolvePravinDashboardTopCategory(
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
