import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  isAnalysisCategoryAll,
  isAnalysisSubCategoryAll,
} from "./analysis-category-paths";
import {
  DAWG_ANALYSIS_FILTER_OPTIONS,
  DAWG_SHEET_CATEGORIES,
  productMatchesDawgScope,
} from "./dawg-scope";
import { TRACKED_SUB_CATEGORIES, type SubCategory } from "./types";
import { normalizeKey } from "./utils";

export type AnalysisCategoryTree = {
  categories: string[];
  subCategoriesByCategory: Record<string, string[]>;
};

const DAWG_CATEGORY_SLUG_TO_LABEL: Record<string, string> = {
  "gaming-dawg": "Gaming - daWg",
  "personal-audio": "Personal Audio",
};

const DAWG_LABEL_TO_SLUG: Record<string, string> = {
  "gaming - dawg": "gaming-dawg",
  "personal audio": "personal-audio",
};

const DAWG_SUB_SLUG_TO_LABEL: Record<string, string> = {
  "gaming-mouse": "Gaming Mouse",
  "gaming-keyboard": "Gaming Keyboard",
  "gaming-headphone": "Gaming Headphone",
  "gaming-chassis": "Gaming Chassis",
  "gaming-mousepad": "Gaming Mousepad",
  "aio-cooler": "AIO Cooler",
};

export function analysisCategoryToUrlSegment(category: string): string {
  if (isAnalysisCategoryAll(category)) return ANALYSIS_CATEGORY_ALL;
  const norm = normalizeKey(category);
  const slug = DAWG_LABEL_TO_SLUG[norm];
  if (slug) return slug;
  return encodeURIComponent(category.trim());
}

export function analysisCategoryFromUrlSegment(raw: string): string {
  const decoded = decodeURIComponent(raw).trim();
  if (isAnalysisCategoryAll(decoded)) return ANALYSIS_CATEGORY_ALL;
  const label = DAWG_CATEGORY_SLUG_TO_LABEL[decoded.toLowerCase()];
  if (label) return label;
  return decoded;
}

export function analysisSubCategoryToUrlValue(subCategory: string): string {
  if (isAnalysisSubCategoryAll(subCategory)) return ANALYSIS_SUB_CATEGORY_ALL;
  const norm = normalizeKey(subCategory);
  for (const [slug, label] of Object.entries(DAWG_SUB_SLUG_TO_LABEL)) {
    if (normalizeKey(label) === norm) return slug;
  }
  return subCategory.trim();
}

export function analysisSubCategoryFromUrlValue(raw: string): string {
  const decoded = decodeURIComponent(raw).trim();
  if (isAnalysisSubCategoryAll(decoded)) return ANALYSIS_SUB_CATEGORY_ALL;
  const label = DAWG_SUB_SLUG_TO_LABEL[decoded.toLowerCase()];
  if (label) return label;
  return decoded;
}

/** Map legacy single-segment daWg URLs (`/analysis/category/gaming-keyboard`). */
export function migrateLegacyDawgAnalysisUrlSegment(
  segment: string,
): { category: string; subCategory: string } | null {
  const key = decodeURIComponent(segment).trim().toLowerCase();
  if (!DAWG_ANALYSIS_FILTER_OPTIONS.some((o) => o.key === key)) return null;
  if (key === "all") {
    return { category: ANALYSIS_CATEGORY_ALL, subCategory: ANALYSIS_SUB_CATEGORY_ALL };
  }
  if (key === "gaming-dawg" || key === "personal-audio") {
    return {
      category: analysisCategoryFromUrlSegment(key),
      subCategory: ANALYSIS_SUB_CATEGORY_ALL,
    };
  }
  const subLabel = DAWG_SUB_SLUG_TO_LABEL[key];
  if (subLabel) {
    return {
      category: "Gaming - daWg",
      subCategory: subLabel,
    };
  }
  return null;
}

/** Map legacy Hari URL that used tracked sub-category as the only segment. */
export function migrateLegacyMonitorAnalysisUrlSegment(
  segment: string,
): { category: string; subCategory: string } | null {
  const decoded = decodeURIComponent(segment).trim();
  if (decoded === ANALYSIS_CATEGORY_ALL) {
    return { category: ANALYSIS_CATEGORY_ALL, subCategory: ANALYSIS_SUB_CATEGORY_ALL };
  }
  if (TRACKED_SUB_CATEGORIES.includes(decoded as SubCategory)) {
    return { category: ANALYSIS_CATEGORY_ALL, subCategory: decoded };
  }
  return null;
}

export function productMatchesDawgCategoryAnalysis(
  category: string,
  subCategory: string,
  row: { category?: string | null; sub_category?: string | null },
): boolean {
  if (!productMatchesDawgScope(row)) return false;
  if (isAnalysisCategoryAll(category)) {
    if (isAnalysisSubCategoryAll(subCategory)) return true;
    return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
  }
  if (normalizeKey(row.category ?? "") !== normalizeKey(category)) return false;
  if (isAnalysisSubCategoryAll(subCategory)) return true;
  return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
}

/** Static daWg category tree (sheet categories are fixed). */
export function buildDawgAnalysisCategoryTree(): AnalysisCategoryTree {
  const categories = [ANALYSIS_CATEGORY_ALL, ...DAWG_SHEET_CATEGORIES];
  const subCategoriesByCategory: Record<string, string[]> = {
    [ANALYSIS_CATEGORY_ALL]: [],
    "Gaming - daWg": [
      "Gaming Mouse",
      "Gaming Keyboard",
      "Gaming Headphone",
      "Gaming Chassis",
      "Gaming Mousepad",
      "AIO Cooler",
    ],
    "Personal Audio": [],
  };
  return { categories, subCategoriesByCategory };
}

export function mergeAnalysisCategoryTree(
  a: AnalysisCategoryTree,
  b: AnalysisCategoryTree,
): AnalysisCategoryTree {
  const categories = new Set<string>([ANALYSIS_CATEGORY_ALL]);
  const subCategoriesByCategory: Record<string, string[]> = {
    [ANALYSIS_CATEGORY_ALL]: [],
  };

  for (const c of [...a.categories, ...b.categories]) {
    if (!isAnalysisCategoryAll(c)) categories.add(c);
  }
  for (const cat of categories) {
    if (isAnalysisCategoryAll(cat)) continue;
    const subs = new Set<string>();
    for (const list of [a.subCategoriesByCategory[cat], b.subCategoriesByCategory[cat]]) {
      for (const sub of list ?? []) {
        if (sub.trim()) subs.add(sub.trim());
      }
    }
    subCategoriesByCategory[cat] = [...subs].sort((x, y) => x.localeCompare(y));
  }

  return {
    categories: [ANALYSIS_CATEGORY_ALL, ...[...categories].filter((c) => !isAnalysisCategoryAll(c)).sort()],
    subCategoriesByCategory,
  };
}

export function treeFromProductMasterRows(
  rows: Array<{
    marketplace: string;
    product_code: string;
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
  }>,
  allowedByMarketplace: { amazon: Set<string>; flipkart: Set<string> },
  matchesScope: (row: (typeof rows)[number]) => boolean,
): AnalysisCategoryTree {
  const categories = new Set<string>();
  const subs = new Map<string, Set<string>>();

  for (const row of rows) {
    if (!matchesScope(row)) continue;
    const code = String(row.product_code ?? "").trim();
    const codeUpper = code.toUpperCase();
    const mp = row.marketplace;
    const allowed =
      mp === "amazon"
        ? allowedByMarketplace.amazon
        : mp === "flipkart"
          ? allowedByMarketplace.flipkart
          : null;
    if (!allowed || (!allowed.has(code) && !allowed.has(codeUpper))) continue;

    const cat = String(row.category ?? "").trim();
    if (!cat) continue;
    categories.add(cat);
    const sub = String(row.sub_category ?? "").trim();
    if (!subs.has(cat)) subs.set(cat, new Set());
    if (sub) subs.get(cat)!.add(sub);
  }

  const sortedCategories = [...categories].sort((a, b) => a.localeCompare(b));
  const subCategoriesByCategory: Record<string, string[]> = {};
  for (const cat of sortedCategories) {
    subCategoriesByCategory[cat] = [...(subs.get(cat) ?? [])].sort((a, b) => a.localeCompare(b));
  }

  return {
    categories: [ANALYSIS_CATEGORY_ALL, ...sortedCategories],
    subCategoriesByCategory,
  };
}
