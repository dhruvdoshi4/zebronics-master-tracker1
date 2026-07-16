import { useEffect, useState } from "react";
import { ANALYSIS_CATEGORY_ALL } from "./analysis-category-paths";
import type { AnalysisCategoryTree } from "./analysis-category-filters";
import { listAnalysisCategoryTree } from "./data";
import { useCatalogScope } from "./catalog-scope-context";
import { isDawgDataScope } from "./data-scope";
import { useDataScope } from "./use-data-scope";

const EMPTY_TREE: AnalysisCategoryTree = {
  categories: [ANALYSIS_CATEGORY_ALL],
  subCategoriesByCategory: { [ANALYSIS_CATEGORY_ALL]: [] },
};

/**
 * Manager workspaces (Pravin, Karan, Rithika, Rishabh) use a real top-level
 * category hierarchy with sheet sub-categories nested underneath — not a flat
 * sub-category list. HO Stock reuses the same analysis category tree so the
 * Category dropdown shows real top categories and Sub-category shows the subs
 * of the selected category.
 */
export function useManagerHoStockCategoryTree(): {
  useTree: boolean;
  tree: AnalysisCategoryTree;
  loading: boolean;
} {
  const { workspace, isManagerWorkspace } = useCatalogScope();
  const dataScope = useDataScope();
  const useTree = isManagerWorkspace && !isDawgDataScope(dataScope);
  const [tree, setTree] = useState<AnalysisCategoryTree>(EMPTY_TREE);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!useTree) {
      setTree(EMPTY_TREE);
      return;
    }
    setLoading(true);
    void listAnalysisCategoryTree(workspace)
      .then(setTree)
      .finally(() => setLoading(false));
  }, [useTree, workspace]);

  return { useTree, tree, loading };
}
