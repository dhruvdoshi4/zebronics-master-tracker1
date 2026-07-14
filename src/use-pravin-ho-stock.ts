import { useEffect, useState } from "react";
import { ANALYSIS_CATEGORY_ALL } from "./analysis-category-paths";
import type { AnalysisCategoryTree } from "./analysis-category-filters";
import { CATALOG_WORKSPACE_PRAVIN } from "./catalog-workspace";
import { listAnalysisCategoryTree } from "./data";
import { useCatalogScope } from "./catalog-scope-context";
import { isDawgDataScope } from "./data-scope";
import { useDataScope } from "./use-data-scope";

/**
 * Pravin HO Stock uses a real top-level category hierarchy (ROMA, PowerBank) with
 * sheet sub-categories nested underneath — not a flat sub-category list.
 */
export function usePravinHoStockMode(): boolean {
  const { isPravin } = useCatalogScope();
  const dataScope = useDataScope();
  return isPravin && !isDawgDataScope(dataScope);
}

export function usePravinHoStockCategoryTree(): {
  usePravin: boolean;
  tree: AnalysisCategoryTree;
  loading: boolean;
} {
  const usePravin = usePravinHoStockMode();
  const [tree, setTree] = useState<AnalysisCategoryTree>({
    categories: [ANALYSIS_CATEGORY_ALL],
    subCategoriesByCategory: { [ANALYSIS_CATEGORY_ALL]: [] },
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!usePravin) return;
    setLoading(true);
    void listAnalysisCategoryTree(CATALOG_WORKSPACE_PRAVIN)
      .then(setTree)
      .finally(() => setLoading(false));
  }, [usePravin]);

  return { usePravin, tree, loading };
}
