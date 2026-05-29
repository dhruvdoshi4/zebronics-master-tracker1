import { useEffect, useMemo, useState } from "react";
import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  analysisCategoryFromUrlSegment,
  analysisCategoryToUrlSegment,
  isAnalysisCategoryAll,
} from "./analysis-category-paths";
import { CATALOG_WORKSPACE_MONITOR } from "./catalog-workspace";
import { listAnalysisCategoryTree } from "./data";
import { listAdminGlobalAnalysisCategoryTree } from "./admin-dashboard-data";
import { useAdminRealm } from "./admin-realm-context";
import { useAuth } from "./use-auth";
import type { CatalogWorkspace } from "./catalog-workspace";
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

function categoryRawFromUrlSegment(segment?: string): string {
  if (!segment || segment === ANALYSIS_CATEGORY_ALL) return ANALYSIS_CATEGORY_ALL;
  return analysisCategoryFromUrlSegment(segment);
}

function subCategoryFromUrlValue(sub?: string): string {
  if (!sub || sub === ANALYSIS_SUB_CATEGORY_ALL) return ANALYSIS_SUB_CATEGORY_ALL;
  return sub;
}

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
  /** Seed from URL immediately so the first data fetch is not stuck on "all categories". */
  const [categoryRaw, setCategoryRaw] = useState(() =>
    categoryRawFromUrlSegment(initialCategorySegment),
  );
  const [subCategory, setSubCategory] = useState(() =>
    subCategoryFromUrlValue(initialSubCategory),
  );

  const { isLoading: authLoading } = useAuth();
  const { isMarketplaceGlobal, impersonatedWorkspace } = useAdminRealm();
  const useAdminGlobalTree =
    !authLoading && isMarketplaceGlobal && impersonatedWorkspace == null;

  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;
    setLoading(true);
    void (useAdminGlobalTree
      ? listAdminGlobalAnalysisCategoryTree()
      : listAnalysisCategoryTree(catalogWorkspace, dataScope))
      .then((next) => {
        if (!cancelled) setTree(next);
      })
      .catch(() => {
        if (!cancelled) {
          setTree({ categories: [ANALYSIS_CATEGORY_ALL], subCategoriesByCategory: {} });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [catalogWorkspace, dataScope, authLoading, useAdminGlobalTree]);

  useEffect(() => {
    setCategoryRaw(categoryRawFromUrlSegment(initialCategorySegment));
  }, [initialCategorySegment]);

  useEffect(() => {
    setSubCategory(subCategoryFromUrlValue(initialSubCategory));
  }, [initialSubCategory]);

  useEffect(() => {
    if (!initialCategorySegment || loading) return;
    const match = tree.categories.find(
      (c) => analysisCategoryToUrlSegment(c) === initialCategorySegment,
    );
    if (match) setCategoryRaw(match);
  }, [initialCategorySegment, loading, tree.categories]);

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
      if (catalogWorkspace === CATALOG_WORKSPACE_MONITOR) {
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
    [tree.subCategoriesByCategory, catalogWorkspace],
  );

  const subCategoryOptions = useMemo(
    () => subCategoryOptionsFor(categoryRaw),
    [subCategoryOptionsFor, categoryRaw],
  );

  /** Category analysis always shows Category + Sub category dropdowns. */
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
