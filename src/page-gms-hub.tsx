import { useState } from "react";
import { Link } from "react-router-dom";
import { IndianRupee, Layers, Package } from "lucide-react";
import { useCatalogScope } from "./catalog-scope-context";
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
import { Card, DataAsOnDualChannelBadge, PageTitle } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function GmsHubPage() {
  const { routePrefix, workspace } = useCatalogScope();
  const dataScope = useDataScope();
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const { categoryRaw, subCategory } = useSheetCategorySubCategoryFilterState(
    workspace,
    dataScope,
  );
  const [filterKey, setFilterKey] = useState(0);

  const query = sheetCategorySubCategoryQueryParams(categoryRaw, subCategory);
  const scopeLabel = `${analysisCategoryLabel(categoryRaw)} · ${analysisSubCategoryLabel(subCategory)}`;

  function gmsProductPath(marketplace: "amazon" | "flipkart") {
    const base = `${routePrefix}/gms/product/${marketplace}`;
    return query ? `${base}?${query}` : base;
  }

  function gmsCategoryChartsPath() {
    const base = `${routePrefix}/gms/category/charts`;
    return query ? `${base}?${query}` : base;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="GMS Tracker"
            subtitle="Gross Merchandise Sales = BAU × sellout ÷ 1.18 — category roll-ups and product drill-down."
          />
        </div>
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      <SheetCategorySubCategoryFilters
        key={filterKey}
        catalogWorkspace={workspace}
        dataScope={dataScope}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          Viewing {scopeLabel}
        </span>
      </div>

      <Card className="text-sm font-medium text-zinc-700">
        Upload one <strong>BAU</strong> and one <strong>GMS plan</strong> sheet (both channels in the same
        file — BAU is shared per model). Sellout still comes from separate Amazon / Flipkart masters.
        Override BAU per listing in Product Master only when a SKU price differs.
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          to={gmsCategoryChartsPath()}
          onClick={() => setFilterKey((k) => k + 1)}
          className="rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-50 to-white p-6 shadow-sm transition hover:shadow-md"
        >
          <Layers className="h-8 w-8 text-violet-700" />
          <h2 className="mt-4 text-xl font-bold text-zinc-900">Category wise</h2>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            Combined Amazon + Flipkart GMS for <strong>{scopeLabel}</strong> — FY trend and MoM (current
            month = MTD ongoing).
          </p>
          <p className="mt-4 text-sm font-bold text-violet-700">Open GMS charts →</p>
        </Link>

        <div className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-white p-6 shadow-sm">
          <Package className="h-8 w-8 text-emerald-700" />
          <h2 className="mt-4 text-xl font-bold text-zinc-900">Product wise</h2>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            Per-channel tables for <strong>{scopeLabel}</strong> — search, gap vs plan, and SKU charts.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to={gmsProductPath("amazon")}
              className="rounded-full bg-orange-600 px-4 py-2 text-sm font-bold text-white shadow transition hover:bg-orange-700"
            >
              Amazon
            </Link>
            <Link
              to={gmsProductPath("flipkart")}
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow transition hover:bg-blue-700"
            >
              Flipkart
            </Link>
          </div>
        </div>
      </div>

      <Card className="flex items-start gap-3 border-amber-200 bg-amber-50/80 text-sm text-amber-950">
        <IndianRupee className="mt-0.5 h-5 w-5 shrink-0" />
        <p>
          Prior FY <strong>25–26</strong> and current FY both use submitted BAU from your BAU sheet unless a
          SKU has a Product Master BAU override.
        </p>
      </Card>
    </div>
  );
}
