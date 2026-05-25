import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useCatalogScope } from "./catalog-scope-context";
import { DAWG_ANALYSIS_FILTER_OPTIONS } from "./dawg-scope";
import { isDawgDataScope } from "./data-scope";
import {
  SUB_CATEGORY_FILTER_LABELS,
  type SubCategoryFilter,
} from "./types";
import { useDataScope } from "./use-data-scope";
import { Button, DataAsOnDualChannelBadge, PageTitle, SubCategoryFilterSelect } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function GmsCategoryPage() {
  const dataScope = useDataScope();
  const isDawgScope = isDawgDataScope(dataScope);
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

  if (isDawgScope) {
    return (
      <div className="space-y-6">
        <Link
          to="/app/gms"
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to GMS Tracker
        </Link>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <PageTitle
            title="GMS — Category wise"
            subtitle="Gaming - daWg and Personal Audio — BAU × SO roll-up (Amazon + Flipkart)."
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
              to={`/app/gms/category/${encodeURIComponent(item.key)}`}
              className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm transition hover:border-violet-400 hover:shadow-md"
            >
              <p className="text-lg font-bold text-zinc-900">{item.label}</p>
              <p className="mt-3 text-sm font-semibold text-violet-700">Open GMS charts →</p>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return <GmsCategoryPageDefault channelCoverage={channelCoverage} />;
}

function GmsCategoryPageDefault({
  channelCoverage,
}: {
  channelCoverage: ReturnType<typeof useLatestUploadSheetCoverageByMarketplace>;
}) {
  const { routePrefix, isPersonalAudio, filterLabels, filterOptions } = useCatalogScope();
  const [subCategory, setSubCategory] = useState<SubCategoryFilter>("all");
  const categoryLabels = isPersonalAudio ? filterLabels : SUB_CATEGORY_FILTER_LABELS;

  return (
    <div className="space-y-6">
      <Link
        to={`${routePrefix}/gms`}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to GMS Tracker
      </Link>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <PageTitle
          title="GMS — Category wise"
          subtitle="Roll-up GMS (BAU × SO ÷ 1.18) — Amazon + Flipkart combined."
        />
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
          onChange={setSubCategory}
          options={isPersonalAudio ? filterOptions : undefined}
          labels={isPersonalAudio ? filterLabels : undefined}
        />
        <Link to={`${routePrefix}/gms/category/${encodeURIComponent(subCategory)}`}>
          <Button type="button" className="h-[42px]">
            Open {categoryLabels[subCategory]} GMS charts →
          </Button>
        </Link>
      </div>
    </div>
  );
}
