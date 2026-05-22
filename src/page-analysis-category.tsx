import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { DAWG_ANALYSIS_FILTER_OPTIONS } from "./dawg-scope";
import { isDawgDataScope } from "./data-scope";
import {
  SUB_CATEGORY_FILTER_LABELS,
  type SubCategoryFilter,
} from "./types";
import { useDataScope } from "./use-data-scope";
import { Button, DataAsOnDualChannelBadge, PageTitle, SubCategoryFilterSelect } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function AnalysisCategoryPage() {
  const dataScope = useDataScope();
  const isDawgScope = isDawgDataScope(dataScope);
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

  if (isDawgScope) {
    return (
      <div className="space-y-6">
        <Link
          to="/app/analysis"
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Data analysis
        </Link>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <PageTitle
            title="Category analysis"
            subtitle="Gaming - daWg and Personal Audio — Amazon and Flipkart combined."
          />
          {channelCoverage ? (
            <DataAsOnDualChannelBadge
              amazon={channelCoverage.amazon}
              flipkart={channelCoverage.flipkart}
            />
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DAWG_ANALYSIS_FILTER_OPTIONS.map((item) => (
            <Link
              key={item.key}
              to={`/app/analysis/category/${encodeURIComponent(item.key)}`}
              className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm transition hover:border-violet-400 hover:shadow-md"
            >
              <p className="text-lg font-bold text-zinc-900">{item.label}</p>
              <p className="mt-3 text-sm font-semibold text-violet-700">Open roll-up →</p>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return <AnalysisCategoryPageDefault channelCoverage={channelCoverage} />;
}

function AnalysisCategoryPageDefault({
  channelCoverage,
}: {
  channelCoverage: ReturnType<typeof useLatestUploadSheetCoverageByMarketplace>;
}) {
  const [subCategory, setSubCategory] = useState<SubCategoryFilter>("all");

  return (
    <div className="space-y-6">
      <Link
        to="/app/analysis"
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Data analysis
      </Link>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <PageTitle
          title="Category analysis"
          subtitle="Roll-up sell-out by category — Amazon and Flipkart combined."
        />
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <SubCategoryFilterSelect value={subCategory} onChange={setSubCategory} />
        <Link to={`/app/analysis/category/${encodeURIComponent(subCategory)}`}>
          <Button type="button" className="h-[42px]">
            Open {SUB_CATEGORY_FILTER_LABELS[subCategory]} roll-up →
          </Button>
        </Link>
      </div>
    </div>
  );
}
