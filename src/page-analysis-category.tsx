import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useCatalogScope } from "./catalog-scope-context";
import {
  SUB_CATEGORY_FILTER_LABELS,
  type SubCategoryFilter,
} from "./types";
import { Button, DataAsOnDualChannelBadge, PageTitle, SubCategoryFilterSelect } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function AnalysisCategoryPage() {
  const { isManagerWorkspace, filterLabels, filterOptions, routePrefix } = useCatalogScope();
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const [subCategory, setSubCategory] = useState<SubCategoryFilter>("all");
  const categoryLabels: Record<string, string> = isManagerWorkspace
    ? filterLabels
    : SUB_CATEGORY_FILTER_LABELS;

  return (
    <div className="space-y-6">
      <Link
        to={`${routePrefix}/analysis`}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Data analysis
      </Link>

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

      <div className="flex flex-wrap items-end gap-3">
        <SubCategoryFilterSelect
          value={subCategory}
          options={isManagerWorkspace ? filterOptions : undefined}
          labels={isManagerWorkspace ? filterLabels : undefined}
          onChange={setSubCategory}
        />
        <Link to={`${routePrefix}/analysis/category/${encodeURIComponent(subCategory)}`}>
          <Button type="button" className="h-[42px]">
            Open {categoryLabels[subCategory]} roll-up →
          </Button>
        </Link>
      </div>
    </div>
  );
}
