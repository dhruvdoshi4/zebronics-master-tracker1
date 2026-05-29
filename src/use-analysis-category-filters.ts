import { useEffect, useMemo, useState } from "react";
import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  analysisCategoryToUrlSegment,
  isAnalysisCategoryAll,
} from "./analysis-category-paths";
import { listAdminGlobalAnalysisCategoryTree } from "./admin-dashboard-data";
import { CATALOG_WORKSPACE_MONITOR } from "./catalog-workspace";
import { listAnalysisCategoryTree } from "./data";
import type { CatalogWorkspace } from "./catalog-workspace";
import { useCatalogScope } from "./catalog-scope-context";
import { getSubCategoryLabel, type DataScope } from "./types";
import { normalizeKey } from "./utils";

function normalizeHariSubCategoryValue(raw: string): string | null {
  const key = normalizeKey(raw);
  if (!key) return null;
  if (key === "monitor") return "monitor";
  if (key === "monitor arm" || key === "monitor_arm") return "monitor_arm";
  if (key === "projector" || key === "projectors") return "projector";
  if (key === "projector screen" || key === "projector_screen") return "projector_screen";
  if (key === "cartridge" || key === "cartridges") return "cartridge";
  return null;
}

export function useAnalysisCategoryFilters(
  catalogWorkspace: CatalogWorkspace,
  dataScope: DataScope,
  initialCategorySegment?: string,
  initialSubCategory?: string,
) {
  const { isMarketplaceGlobalScope } = useCatalogScope();
  const [tree, setTree] = useState<{
    categories: string[];
    subCategoriesByCategory: Record<string, string[]>;
  }>({ categories: [ANALYSIS_CATEGORY_ALL], subCategoriesByCategory: {} });
  const [loading, setLoading] = useState(true);
  const [categoryRaw, setCategoryRaw] = useState(ANALYSIS_CATEGORY_ALL);
  const [subCategory, setSubCategory] = useState(ANALYSIS_SUB_CATEGORY_ALL);

  useEffect(() => {
    setLoading(true);
    const load = isMarketplaceGlobalScope
      ? listAdminGlobalAnalysisCategoryTree()
      : listAnalysisCategoryTree(catalogWorkspace, dataScope);
    void load
      .then(setTree)
      .catch(() =>
        setTree({ categories: [ANALYSIS_CATEGORY_ALL], subCategoriesByCategory: {} }),
      )
      .finally(() => setLoading(false));
  }, [catalogWorkspace, dataScope, isMarketplaceGlobalScope]);

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

  const subCategoryOptionsFor = useMemo(
    () => (forCategoryRaw: string) => {
      const list = isAnalysisCategoryAll(forCategoryRaw)
        ? (tree.subCategoriesByCategory[ANALYSIS_CATEGORY_ALL] ?? [])
        : (tree.subCategoriesByCategory[forCategoryRaw] ?? []);
      if (
        !isMarketplaceGlobalScope &&
        catalogWorkspace === CATALOG_WORKSPACE_MONITOR
      ) {
        const seen = new Set<string>();
        const normalized: Array<{ value: string; label: string }> = [];
        for (const sub of list) {
          const value = normalizeHariSubCategoryValue(sub);
          if (!value || seen.has(value)) continue;
          seen.add(value);
          normalized.push({ value, label: getSubCategoryLabel(value) });
        }
        return normalized;
      }
      return list.map((sub) => ({
        value: sub,
        label: sub,
      }));
    },
    [tree.subCategoriesByCategory, catalogWorkspace, isMarketplaceGlobalScope],
  );

  const subCategoryOptions = useMemo(
    () => subCategoryOptionsFor(categoryRaw),
    [subCategoryOptionsFor, categoryRaw],
  );

  const showSubCategory = true;

  return {
    loading,
    categoryRaw,
    setCategoryRaw,
    categorySegment,
    subCategory,
    setSubCategory,
    categoryOptions,
    subCategoryOptions,
    subCategoryOptionsFor,
    showSubCategory,
  };
}
