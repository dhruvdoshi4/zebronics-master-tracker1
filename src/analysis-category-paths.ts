/** Category analysis URL helpers (marketplace / PA / daWg). */

export const ANALYSIS_CATEGORY_ALL = "all";
export const ANALYSIS_SUB_CATEGORY_ALL = "all";

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
