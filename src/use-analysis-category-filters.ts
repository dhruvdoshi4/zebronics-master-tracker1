import { useEffect, useMemo, useState } from "react";
import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  analysisCategoryToUrlSegment,
  isAnalysisCategoryAll,
} from "./analysis-category-paths";
import { listAnalysisCategoryTree } from "./data";
import type { CatalogWorkspace } from "./catalog-workspace";
import type { DataScope } from "./types";

export function useAnalysisCategoryFilters(
  catalogWorkspace: CatalogWorkspace,
  dataScope: DataScope,
  initialCategorySegment?: string,
  initialSubCategory?: string,
) {
  const [tree, setTree] = useState<{
    categories: string[];
    subCategoriesByCategory: Record<string, string[]>;
  }>({ categories: [ANALYSIS_CATEGORY_ALL], subCategoriesByCategory: {} });
  const [loading, setLoading] = useState(true);
  const [categoryRaw, setCategoryRaw] = useState(ANALYSIS_CATEGORY_ALL);
  const [subCategory, setSubCategory] = useState(ANALYSIS_SUB_CATEGORY_ALL);

  useEffect(() => {
    setLoading(true);
    void listAnalysisCategoryTree(catalogWorkspace, dataScope)
      .then(setTree)
      .catch(() =>
        setTree({ categories: [ANALYSIS_CATEGORY_ALL], subCategoriesByCategory: {} }),
      )
      .finally(() => setLoading(false));
  }, [catalogWorkspace, dataScope]);

  useEffect(() => {
    if (!initialCategorySegment || loading) return;
    const match = tree.categories.find(
      (c) => analysisCategoryToUrlSegment(c) === initialCategorySegment,
    );
    if (match) setCategoryRaw(match);
    else if (initialCategorySegment === ANALYSIS_CATEGORY_ALL) {
      setCategoryRaw(ANALYSIS_CATEGORY_ALL);
    }
  }, [initialCategorySegment, loading, tree.categories]);

  useEffect(() => {
    if (!initialSubCategory || loading) return;
    setSubCategory(initialSubCategory);
  }, [initialSubCategory, loading]);

  const categorySegment = analysisCategoryToUrlSegment(categoryRaw);

  const categoryOptions = useMemo(
    () =>
      tree.categories.map((c) => ({
        raw: c,
        segment: analysisCategoryToUrlSegment(c),
        label: isAnalysisCategoryAll(c) ? "All categories" : c,
      })),
    [tree.categories],
  );

  const subCategoryOptions = useMemo(() => {
    if (isAnalysisCategoryAll(categoryRaw)) return [];
    return (tree.subCategoriesByCategory[categoryRaw] ?? []).map((sub) => ({
      value: sub,
      label: sub,
    }));
  }, [categoryRaw, tree.subCategoriesByCategory]);

  const showSubCategory = !isAnalysisCategoryAll(categoryRaw);

  return {
    loading,
    categoryRaw,
    setCategoryRaw,
    categorySegment,
    subCategory,
    setSubCategory,
    categoryOptions,
    subCategoryOptions,
    showSubCategory,
  };
}
