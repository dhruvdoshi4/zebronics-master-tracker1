import {
  CATALOG_WORKSPACE_HOME_AUDIO,
  sheetCategoryHaystack,
  type CatalogWorkspace,
} from "./catalog-workspace";
import type { LegacyMarketplace } from "./types";
import { normalizeKey } from "./utils";

/** Sheet Category column for Rishabh (Amazon / Flipkart sellout masters). */
export function isRishabhHomeAudioSheetCategory(category: string | null | undefined): boolean {
  const c = normalizeKey(String(category ?? ""));
  return c === "home audio" || c === "homeaudio" || c === "home audio speakers";
}

export function isPersonalAudioSheetCategory(category: string | null | undefined): boolean {
  const c = normalizeKey(String(category ?? ""));
  return c === "personal audio" || c === "personal audio accessories";
}

/**
 * Rishabh scope: entire Home Audio category on AZ + FK.
 * Excludes Personal Audio (Karan) and other managers' top-level categories.
 */
export function rowPassesRishabhCategoryScope(
  rawCategory: string,
  rawSubCategory: string,
  productName: string,
): boolean {
  const cat = String(rawCategory ?? "").trim();
  const sub = String(rawSubCategory ?? "").trim();
  if (isPersonalAudioSheetCategory(cat)) return false;
  if (isRishabhHomeAudioSheetCategory(cat)) return true;
  const hay = sheetCategoryHaystack(cat, sub, productName);
  if (/\bpersonal\s*audio\b/.test(hay)) return false;
  if (/\bhome\s*audio\b/.test(hay)) return true;
  return false;
}

/** Stored sub_category = sheet Sub Category label (trimmed). */
export function normalizedRishabhSubCategory(
  rawSubCategory: string,
  rawCategory: string,
  productName: string,
): string | null {
  if (!rowPassesRishabhCategoryScope(rawCategory, rawSubCategory, productName)) {
    return null;
  }
  const sub = String(rawSubCategory ?? "").trim();
  if (sub) return sub;
  if (isRishabhHomeAudioSheetCategory(rawCategory)) {
    return "Home Audio";
  }
  return null;
}

export function productMatchesRishabhDashboardScopeForMarketplace(
  row: {
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
    catalog_workspace?: string | null;
  },
  _marketplace: LegacyMarketplace,
): boolean {
  /** Sheet Category = Home Audio wins over stale catalog_workspace (e.g. Hari monitor_projector). */
  return rowPassesRishabhCategoryScope(
    String(row.category ?? ""),
    String(row.sub_category ?? ""),
    String(row.product_name ?? ""),
  );
}

/** Category analysis / dashboard filter: match sheet sub-category label. */
export function productMatchesRishabhCategoryRollup(
  subCategoryFilter: string,
  row: Pick<
    { category?: string | null; sub_category?: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
): boolean {
  if (
    !productMatchesRishabhDashboardScopeForMarketplace(row, "amazon") &&
    !productMatchesRishabhDashboardScopeForMarketplace(row, "flipkart")
  ) {
    return false;
  }
  const filter = String(subCategoryFilter ?? "").trim();
  if (!filter || filter === "all") return true;
  const canonical = (value: string): string =>
    normalizeKey(value)
      .replace(/[\s_-]+/g, "")
      .trim();
  const sub = String(row.sub_category ?? "").trim();
  return canonical(sub) === canonical(filter);
}

export type RishabhSubCategoryFilter = string;

export const RISHABH_SUB_CATEGORY_FILTER_OPTIONS: readonly RishabhSubCategoryFilter[] = [
  "all",
] as const;

export const RISHABH_SUB_CATEGORY_FILTER_LABELS: Record<string, string> = {
  all: "All",
};

export function parseRishabhSubCategoryFilterParam(
  raw: string | null | undefined,
): RishabhSubCategoryFilter | null {
  const decoded = raw != null ? decodeURIComponent(raw) : "";
  if (decoded === "all") return "all";
  if (decoded.trim()) return decoded.trim();
  return null;
}

export function isRishabhWorkspace(workspace: CatalogWorkspace): boolean {
  return workspace === CATALOG_WORKSPACE_HOME_AUDIO;
}
