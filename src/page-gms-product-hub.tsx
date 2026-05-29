import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useCatalogScope } from "./catalog-scope-context";
import { useDataScope } from "./use-data-scope";
import {
  analysisCategoryLabel,
  analysisSubCategoryLabel,
} from "./analysis-category-paths";
import {
  SheetCategorySubCategoryFilters,
  useSheetCategorySubCategoryFilterState,
} from "./sheet-category-subcategory-filters";
import { ProductLookupPanel } from "./product-lookup-panel";
import { Card, DataAsOnDualChannelBadge, PageTitle } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function GmsProductHubPage() {
  const { routePrefix, workspace } = useCatalogScope();
  const dataScope = useDataScope();
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const { categoryRaw, subCategory } = useSheetCategorySubCategoryFilterState(
    workspace,
    dataScope,
  );
  const scopeLabel = `${analysisCategoryLabel(categoryRaw)} · ${analysisSubCategoryLabel(subCategory)}`;

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
          title="GMS — Product wise"
          subtitle="Unified lookup: search once by ASIN / FSN / product ID / model and open GMS charts."
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
        <span className="rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {scopeLabel}
        </span>
      </div>

      <Card className="space-y-4">
        <ProductLookupPanel
          destination={{ type: "gms" }}
          routePrefix={routePrefix}
          fieldLabel="ASIN, FSN, product ID, or model name"
          placeholder="Unified GMS lookup"
          searchButtonLabel="Open GMS charts"
          searchingButtonLabel="Opening…"
        />
      </Card>

      <Card className="text-sm text-zinc-600">
        Search resolves to Amazon or Flipkart automatically using the same unified lookup logic as Product Lookup.
      </Card>
    </div>
  );
}
