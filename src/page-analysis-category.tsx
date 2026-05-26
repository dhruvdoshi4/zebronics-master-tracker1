import { Link } from "react-router-dom";
import {
  analysisCategoryDetailPath,
  analysisCategoryLabel,
  analysisSubCategoryLabel,
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
} from "./analysis-category-paths";
import { CategorySubCategoryFilterControls } from "./category-subcategory-filter-controls";
import { useCatalogScope } from "./catalog-scope-context";
import { useDataScope } from "./use-data-scope";
import { useAnalysisCategoryFilters } from "./use-analysis-category-filters";
import { Button, DataAsOnDualChannelBadge, PageTitle } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function AnalysisCategoryPage() {
  const { workspace, routePrefix } = useCatalogScope();
  const dataScope = useDataScope();
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const {
    loading,
    categoryRaw,
    setCategoryRaw,
    categorySegment,
    subCategory,
    setSubCategory,
    categoryOptions,
    subCategoryOptions,
    showSubCategory,
  } = useAnalysisCategoryFilters(workspace, dataScope);

  const rollUpPath = analysisCategoryDetailPath(routePrefix, categorySegment, subCategory);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Category analysis"
            subtitle="Roll-up sell-out by category — Amazon and Flipkart combined."
          />
        </div>
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm font-medium text-zinc-500">Loading categories…</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap items-end gap-3">
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
              showSubCategory={showSubCategory}
            />
          </div>
          <Link to={rollUpPath}>
            <Button type="button" className="h-[42px]">
              Open {analysisCategoryLabel(categoryRaw)}
              {showSubCategory && subCategory !== ANALYSIS_SUB_CATEGORY_ALL
                ? ` · ${analysisSubCategoryLabel(subCategory)}`
                : showSubCategory
                  ? " · all sub categories"
                  : ""}{" "}
              roll-up →
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
