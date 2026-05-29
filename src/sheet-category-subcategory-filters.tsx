import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  analysisCategoryToUrlSegment,
  analysisSubCategoryFromUrlValue,
  analysisSubCategoryToUrlValue,
} from "./analysis-category-paths";
import { CategorySubCategoryFilterControls } from "./category-subcategory-filter-controls";
import { useAnalysisCategoryFilters } from "./use-analysis-category-filters";
import type { CatalogWorkspace } from "./catalog-workspace";
import type { DataScope } from "./types";

export function useSheetCategorySubCategoryFilterState(
  catalogWorkspace: CatalogWorkspace,
  dataScope: DataScope,
  initialCategorySegment?: string,
  initialSubCategory?: string,
) {
  const filters = useAnalysisCategoryFilters(
    catalogWorkspace,
    dataScope,
    initialCategorySegment,
    initialSubCategory,
  );
  return {
    ...filters,
    categoryLabel: filters.categoryOptions.find((o) => o.raw === filters.categoryRaw)?.label,
    subCategoryLabel: filters.subCategoryOptions.find((o) => o.value === filters.subCategory)
      ?.label,
  };
}

/** Category + sub category dropdowns (sheet labels) — same as Category analysis. */
export function SheetCategorySubCategoryFilters({
  catalogWorkspace,
  dataScope,
  initialCategorySegment,
  initialSubCategory,
  className,
}: {
  catalogWorkspace: CatalogWorkspace;
  dataScope: DataScope;
  initialCategorySegment?: string;
  initialSubCategory?: string;
  className?: string;
}) {
  const {
    loading,
    setCategoryRaw,
    categorySegment,
    subCategory,
    setSubCategory,
    categoryOptions,
    subCategoryOptions,
  } = useSheetCategorySubCategoryFilterState(
    catalogWorkspace,
    dataScope,
    initialCategorySegment,
    initialSubCategory,
  );

  if (loading) {
    return (
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Loading categories…</p>
    );
  }

  return (
    <div className={className ?? "flex flex-wrap items-end gap-3"}>
      <CategorySubCategoryFilterControls
        category={categorySegment}
        categories={categoryOptions.map((o) => o.segment)}
        categoryLabels={Object.fromEntries(
          categoryOptions.map((o) => [o.segment, o.label]),
        )}
        onCategoryChange={(segment) => {
          const picked = categoryOptions.find((o) => o.segment === segment);
          setCategoryRaw(picked?.raw ?? ANALYSIS_CATEGORY_ALL);
          setSubCategory(ANALYSIS_SUB_CATEGORY_ALL);
        }}
        subCategory={subCategory}
        subCategoryOptions={subCategoryOptions.map((o) => o.value)}
        onSubCategoryChange={setSubCategory}
        showSubCategory
      />
    </div>
  );
}

export function sheetCategorySubCategoryQueryParams(
  categoryRaw: string,
  subCategory: string,
): string {
  const cat = analysisCategoryToUrlSegment(categoryRaw);
  const sub = analysisSubCategoryToUrlValue(subCategory);
  const params = new URLSearchParams();
  if (!cat || cat === ANALYSIS_CATEGORY_ALL) {
    if (sub && sub !== ANALYSIS_SUB_CATEGORY_ALL) params.set("sub", sub);
    return params.toString();
  }
  params.set("cat", cat);
  if (sub && sub !== ANALYSIS_SUB_CATEGORY_ALL) params.set("sub", sub);
  return params.toString();
}

export function parseSheetCategorySubCategoryFromSearchParams(
  searchParams: URLSearchParams,
): { categorySegment?: string; subCategory?: string } {
  const cat = searchParams.get("cat");
  const sub = searchParams.get("sub");
  return {
    categorySegment: cat?.trim() || undefined,
    subCategory: sub ? analysisSubCategoryFromUrlValue(sub) : undefined,
  };
}
