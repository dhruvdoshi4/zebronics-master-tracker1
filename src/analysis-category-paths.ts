/** Category analysis URL helpers (marketplace / PA / daWg). */

import { normalizeKey } from "./utils";

export const ANALYSIS_CATEGORY_ALL = "all";
export const ANALYSIS_SUB_CATEGORY_ALL = "all";

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

export function isAnalysisCategoryAll(category: string): boolean {
  return category.trim().toLowerCase() === ANALYSIS_CATEGORY_ALL;
}

export function isAnalysisSubCategoryAll(subCategory: string): boolean {
  return subCategory.trim().toLowerCase() === ANALYSIS_SUB_CATEGORY_ALL;
}

export function analysisCategoryDetailPath(
  routePrefix: string,
  category: string,
  subCategory?: string | null,
): string {
  const base = `${routePrefix}/analysis/category/${encodeURIComponent(category)}`;
  const sub = subCategory?.trim();
  if (!sub || isAnalysisSubCategoryAll(sub)) return base;
  return `${base}?sub=${encodeURIComponent(sub)}`;
}

export function analysisCategoryLabel(category: string): string {
  return isAnalysisCategoryAll(category) ? "All categories" : category.trim();
}

export function analysisSubCategoryLabel(subCategory: string): string {
  return isAnalysisSubCategoryAll(subCategory) ? "All sub categories" : subCategory.trim();
}

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
