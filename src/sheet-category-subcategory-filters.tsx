import { useEffect, useMemo, useState } from "react";
import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  analysisCategoryToUrlSegment,
  analysisSubCategoryFromUrlValue,
  analysisSubCategoryToUrlValue,
} from "./analysis-category-paths";
import { CategorySubCategoryFilterControls } from "./category-subcategory-filter-controls";
import { useAnalysisCategoryFilters } from "./use-analysis-category-filters";
import { Button } from "./ui";
import type { CatalogWorkspace } from "./catalog-workspace";
import type { DataScope } from "./types";

export type SheetCategoryFilterState = ReturnType<typeof useSheetCategorySubCategoryFilterState>;

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
  filterState: filterStateProp,
  showApplyButton = false,
  onApply,
  applyLabel = "Apply filters",
}: {
  catalogWorkspace: CatalogWorkspace;
  dataScope: DataScope;
  initialCategorySegment?: string;
  initialSubCategory?: string;
  className?: string;
  /** Pass parent hook state so dropdown changes update charts / scope (avoid duplicate hooks). */
  filterState?: SheetCategoryFilterState;
  /** When true, category/sub selections commit only after Apply (like Category analysis). */
  showApplyButton?: boolean;
  onApply?: (categoryRaw: string, subCategory: string) => void;
  applyLabel?: string;
}) {
  const internalState = useSheetCategorySubCategoryFilterState(
    catalogWorkspace,
    dataScope,
    initialCategorySegment,
    initialSubCategory,
  );
  const filterState = filterStateProp ?? internalState;

  const {
    loading,
    setCategoryRaw,
    categorySegment,
    categoryRaw,
    subCategory,
    setSubCategory,
    categoryOptions,
    subCategoryOptions,
    subCategoryOptionsFor,
  } = filterState;

  const [draftCategoryRaw, setDraftCategoryRaw] = useState(categoryRaw);
  const [draftSubCategory, setDraftSubCategory] = useState(subCategory);

  useEffect(() => {
    setDraftCategoryRaw(categoryRaw);
    setDraftSubCategory(subCategory);
  }, [categoryRaw, subCategory]);

  const draftCategorySegment = analysisCategoryToUrlSegment(draftCategoryRaw);
  const draftSubCategoryOptions = useMemo(
    () => subCategoryOptionsFor(draftCategoryRaw),
    [subCategoryOptionsFor, draftCategoryRaw],
  );

  const activeCategorySegment = showApplyButton ? draftCategorySegment : categorySegment;
  const activeSubCategory = showApplyButton ? draftSubCategory : subCategory;
  const activeSubCategoryOptions = showApplyButton
    ? draftSubCategoryOptions
    : subCategoryOptions;

  function commitFilters() {
    setCategoryRaw(draftCategoryRaw);
    setSubCategory(draftSubCategory);
    onApply?.(draftCategoryRaw, draftSubCategory);
  }

  if (loading) {
    return (
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Loading categories…</p>
    );
  }

  return (
    <div className={className ?? "flex flex-wrap items-end gap-3"}>
      <CategorySubCategoryFilterControls
        category={activeCategorySegment}
        categories={categoryOptions.map((o) => o.segment)}
        categoryLabels={Object.fromEntries(
          categoryOptions.map((o) => [o.segment, o.label]),
        )}
        onCategoryChange={(segment) => {
          const picked = categoryOptions.find((o) => o.segment === segment);
          const nextRaw = picked?.raw ?? ANALYSIS_CATEGORY_ALL;
          if (showApplyButton) {
            setDraftCategoryRaw(nextRaw);
            setDraftSubCategory(ANALYSIS_SUB_CATEGORY_ALL);
          } else {
            setCategoryRaw(nextRaw);
            setSubCategory(ANALYSIS_SUB_CATEGORY_ALL);
          }
        }}
        subCategory={activeSubCategory}
        subCategoryOptions={activeSubCategoryOptions.map((o) => o.value)}
        onSubCategoryChange={(value) => {
          if (showApplyButton) {
            setDraftSubCategory(value);
          } else {
            setSubCategory(value);
          }
        }}
        showSubCategory
      />
      {showApplyButton ? (
        <Button type="button" className="h-[42px] shrink-0" onClick={commitFilters}>
          {applyLabel}
        </Button>
      ) : null}
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
