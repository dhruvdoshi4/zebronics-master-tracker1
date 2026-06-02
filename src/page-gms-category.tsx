import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useCatalogScope } from "./catalog-scope-context";
import { isDawgDataScope } from "./data-scope";
import { useDataScope } from "./use-data-scope";
import {
  SheetCategorySubCategoryFilters,
  useSheetCategorySubCategoryFilterState,
} from "./sheet-category-subcategory-filters";
import {
  analysisCategoryLabel,
  analysisSubCategoryLabel,
  analysisCategoryToUrlSegment,
  analysisSubCategoryToUrlValue,
} from "./analysis-category-paths";
import { DAWG_ANALYSIS_FILTER_OPTIONS } from "./dawg-scope";
import { Button, DataAsOnDualChannelBadge, PageTitle } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function GmsCategoryPage() {
  const dataScope = useDataScope();
  const isDawgScope = isDawgDataScope(dataScope);
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

  if (isDawgScope) {
    return <GmsCategoryPageDawg channelCoverage={channelCoverage} />;
  }

  return <GmsCategoryPageDefault channelCoverage={channelCoverage} />;
}

function GmsCategoryPageDawg({
  channelCoverage,
}: {
  channelCoverage: ReturnType<typeof useLatestUploadSheetCoverageByMarketplace>;
}) {
  const { routePrefix, workspace } = useCatalogScope();
  const dataScope = useDataScope();
  const filterState = useSheetCategorySubCategoryFilterState(workspace, dataScope);
  const { categoryRaw, subCategory } = filterState;
  const [appliedChartsQuery, setAppliedChartsQuery] = useState<string | null>(null);

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
          subtitle="Gaming - daWg and Personal Audio — BAU × SO roll-up (Amazon + Flipkart)."
        />
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      <SheetCategorySubCategoryFilters
        catalogWorkspace={workspace}
        dataScope={dataScope}
        filterState={filterState}
        showApplyButton
        applyLabel="Apply scope"
        onApply={(nextCategoryRaw, nextSubCategory) => {
          const params = new URLSearchParams();
          params.set("cat", analysisCategoryToUrlSegment(nextCategoryRaw));
          params.set("sub", analysisSubCategoryToUrlValue(nextSubCategory));
          setAppliedChartsQuery(params.toString());
        }}
      />

      <Link
        to={
          appliedChartsQuery
            ? `${routePrefix}/gms/category/charts?${appliedChartsQuery}`
            : `${routePrefix}/gms/category`
        }
      >
        <Button type="button" className="h-[42px]">
          Open GMS charts for {analysisCategoryLabel(categoryRaw)} ·{" "}
          {analysisSubCategoryLabel(subCategory)} →
        </Button>
      </Link>
      {!appliedChartsQuery ? (
        <p className="text-sm font-medium text-amber-700">
          Click Apply scope first.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DAWG_ANALYSIS_FILTER_OPTIONS.map((item) => (
          <Link
            key={item.key}
            to={`${routePrefix}/gms/category/${encodeURIComponent(item.key)}`}
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

function GmsCategoryPageDefault({
  channelCoverage,
}: {
  channelCoverage: ReturnType<typeof useLatestUploadSheetCoverageByMarketplace>;
}) {
  const { routePrefix, workspace } = useCatalogScope();
  const dataScope = useDataScope();
  const filterState = useSheetCategorySubCategoryFilterState(workspace, dataScope);
  const { categoryRaw, subCategory } = filterState;
  const [appliedChartsQuery, setAppliedChartsQuery] = useState<string | null>(null);

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
          subtitle="Amazon: GMS_AVS only (missing → 0). Flipkart: BAU × SO roll-up. Combined charts."
        />
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <SheetCategorySubCategoryFilters
          catalogWorkspace={workspace}
          dataScope={dataScope}
          filterState={filterState}
          showApplyButton
          applyLabel="Apply scope"
          onApply={(nextCategoryRaw, nextSubCategory) => {
            const params = new URLSearchParams();
            params.set("cat", analysisCategoryToUrlSegment(nextCategoryRaw));
            params.set("sub", analysisSubCategoryToUrlValue(nextSubCategory));
            setAppliedChartsQuery(params.toString());
          }}
        />
        <Link
          to={
            appliedChartsQuery
              ? `${routePrefix}/gms/category/charts?${appliedChartsQuery}`
              : `${routePrefix}/gms/category`
          }
        >
          <Button type="button" className="h-[42px]">
            Open {analysisCategoryLabel(categoryRaw)} · {analysisSubCategoryLabel(subCategory)} GMS
            charts →
          </Button>
        </Link>
      </div>
      {!appliedChartsQuery ? (
        <p className="text-sm font-medium text-amber-700">
          Click Apply scope first.
        </p>
      ) : null}
    </div>
  );
}
