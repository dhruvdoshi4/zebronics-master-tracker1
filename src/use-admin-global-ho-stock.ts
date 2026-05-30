import { useEffect, useMemo, useState } from "react";
import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  isAnalysisCategoryAll,
} from "./analysis-category-paths";
import {
  analysisSubCategoryOptionLabel,
  normalizeHariSubCategoryValue,
  type AnalysisCategoryTree,
} from "./analysis-category-filters";
import { listAdminGlobalAnalysisCategoryTree } from "./admin-dashboard-data";
import { useAdminRealm } from "./admin-realm-context";
import { isDawgDataScope } from "./data-scope";
import { getSubCategoryLabel } from "./types";
import { useDataScope } from "./use-data-scope";

export function useAdminGlobalHoStockMode(): boolean {
  const { isMarketplaceGlobal, impersonatedWorkspace } = useAdminRealm();
  const dataScope = useDataScope();
  return (
    isMarketplaceGlobal &&
    impersonatedWorkspace == null &&
    !isDawgDataScope(dataScope)
  );
}

export function adminHoStockSubCategoryLabel(sub: string): string {
  if (isAnalysisCategoryAll(sub) || sub === ANALYSIS_SUB_CATEGORY_ALL) return "All";
  const hari = normalizeHariSubCategoryValue(sub);
  if (hari) return getSubCategoryLabel(hari);
  return analysisSubCategoryOptionLabel(sub);
}

export function useAdminGlobalHoStockCategoryTree(): {
  useAdminGlobal: boolean;
  tree: AnalysisCategoryTree;
  loading: boolean;
} {
  const useAdminGlobal = useAdminGlobalHoStockMode();
  const [tree, setTree] = useState<AnalysisCategoryTree>({
    categories: [ANALYSIS_CATEGORY_ALL],
    subCategoriesByCategory: { [ANALYSIS_CATEGORY_ALL]: [] },
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!useAdminGlobal) return;
    setLoading(true);
    void listAdminGlobalAnalysisCategoryTree()
      .then(setTree)
      .finally(() => setLoading(false));
  }, [useAdminGlobal]);

  return { useAdminGlobal, tree, loading };
}

export function adminHoStockTopCategoryOptions(tree: AnalysisCategoryTree): string[] {
  return tree.categories.filter((cat) => !isAnalysisCategoryAll(cat));
}

export function adminHoStockSubCategoryOptions(
  tree: AnalysisCategoryTree,
  selectedCategory: string,
): string[] {
  const subs =
    isAnalysisCategoryAll(selectedCategory) || selectedCategory === "all"
      ? (tree.subCategoriesByCategory[ANALYSIS_CATEGORY_ALL] ?? [])
      : (tree.subCategoriesByCategory[selectedCategory] ?? []);
  return [ANALYSIS_SUB_CATEGORY_ALL, ...subs];
}

export function adminHoStockCategoryFromUrlSegment(segment: string): string {
  const decoded = decodeURIComponent(segment).trim();
  return isAnalysisCategoryAll(decoded) ? ANALYSIS_CATEGORY_ALL : decoded;
}

export function adminHoStockSubCategoryFromQuery(raw: string | null): string {
  const decoded = (raw ?? ANALYSIS_SUB_CATEGORY_ALL).trim() || ANALYSIS_SUB_CATEGORY_ALL;
  return decoded.toLowerCase() === ANALYSIS_SUB_CATEGORY_ALL ? ANALYSIS_SUB_CATEGORY_ALL : decoded;
}

export function useAdminHoStockFilterOptions(
  tree: AnalysisCategoryTree,
  selectedCategory: string,
) {
  return useMemo(
    () => ({
      categoryOptions: [
        { value: "all", label: "All categories" },
        ...adminHoStockTopCategoryOptions(tree).map((cat) => ({
          value: cat,
          label: cat,
        })),
      ],
      subCategoryOptions: adminHoStockSubCategoryOptions(tree, selectedCategory).map((sub) => ({
        value: sub,
        label: adminHoStockSubCategoryLabel(sub),
      })),
    }),
    [tree, selectedCategory],
  );
}
