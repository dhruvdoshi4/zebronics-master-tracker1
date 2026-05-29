import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useCatalogScope } from "./catalog-scope-context";
import { isDawgDataScope } from "./data-scope";
import { useDataScope } from "./use-data-scope";
import {
  SheetCategorySubCategoryFilters,
  sheetCategorySubCategoryQueryParams,
  useSheetCategorySubCategoryFilterState,
} from "./sheet-category-subcategory-filters";
import {
  analysisCategoryLabel,
  analysisSubCategoryLabel,
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
  const { categoryRaw, subCategory } = useSheetCategorySubCategoryFilterState(
    workspace,
    dataScope,
  );
  const query = sheetCategorySubCategoryQueryParams(categoryRaw, subCategory);
  const chartsPath = query
    ? `${routePrefix}/gms/category/charts?${query}`
    : `${routePrefix}/gms/category/charts`;

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

      <SheetCategorySubCategoryFilters catalogWorkspace={workspace} dataScope={dataScope} />

      <Link to={chartsPath}>
        <Button type="button" className="h-[42px]">
          Open GMS charts for {analysisCategoryLabel(categoryRaw)} ·{" "}
          {analysisSubCategoryLabel(subCategory)} →
        </Button>
      </Link>

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
  const { categoryRaw, subCategory } = useSheetCategorySubCategoryFilterState(
    workspace,
    dataScope,
  );
  const query = sheetCategorySubCategoryQueryParams(categoryRaw, subCategory);

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
        <SheetCategorySubCategoryFilters catalogWorkspace={workspace} dataScope={dataScope} />
        <Link
          to={
            query
              ? `${routePrefix}/gms/category/charts?${query}`
              : `${routePrefix}/gms/category/charts`
          }
        >
          <Button type="button" className="h-[42px]">
            Open {analysisCategoryLabel(categoryRaw)} · {analysisSubCategoryLabel(subCategory)} GMS
            charts →
          </Button>
        </Link>
      </div>
    </div>
  );
}
