import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useCatalogScope } from "./catalog-scope-context";
import { useDataScope } from "./use-data-scope";
import {
  analysisCategoryLabel,
  analysisSubCategoryLabel,
} from "./analysis-category-paths";
import type { Marketplace } from "./types";
import {
  SheetCategorySubCategoryFilters,
  sheetCategorySubCategoryQueryParams,
  useSheetCategorySubCategoryFilterState,
} from "./sheet-category-subcategory-filters";
import { Card, DataAsOnDualChannelBadge, PageTitle } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

const channels: Array<{
  marketplace: Marketplace;
  title: string;
  subtitle: string;
  border: string;
  gradient: string;
  accent: string;
}> = [
  {
    marketplace: "amazon",
    title: "Amazon",
    subtitle: "Search by ASIN or model — planned GMS, gap, and charts for Amazon only.",
    border: "border-orange-300",
    gradient: "from-orange-50 to-white",
    accent: "text-orange-700",
  },
  {
    marketplace: "flipkart",
    title: "Flipkart",
    subtitle: "Search by FSN or model — planned GMS, gap, and charts for Flipkart only.",
    border: "border-blue-300",
    gradient: "from-blue-50 to-white",
    accent: "text-blue-700",
  },
];

export function GmsProductHubPage() {
  const { routePrefix, workspace } = useCatalogScope();
  const dataScope = useDataScope();
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const { categoryRaw, subCategory } = useSheetCategorySubCategoryFilterState(
    workspace,
    dataScope,
  );
  const scopeLabel = `${analysisCategoryLabel(categoryRaw)} · ${analysisSubCategoryLabel(subCategory)}`;

  function gmsProductPath(marketplace: Marketplace) {
    const query = sheetCategorySubCategoryQueryParams(categoryRaw, subCategory);
    const base = `${routePrefix}/gms/product/${marketplace}`;
    return query ? `${base}?${query}` : base;
  }

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
          subtitle="Pick a channel. Each page shows only that marketplace’s listings and search."
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

      <div className="grid gap-4 md:grid-cols-2">
        {channels.map((ch) => (
          <Link
            key={ch.marketplace}
            to={gmsProductPath(ch.marketplace)}
            className={`rounded-2xl border-2 ${ch.border} bg-gradient-to-br ${ch.gradient} p-6 shadow-sm transition hover:shadow-md`}
          >
            <h2 className="text-xl font-bold text-zinc-900">{ch.title}</h2>
            <p className="mt-2 text-sm font-medium text-zinc-600">{ch.subtitle}</p>
            <p className={`mt-4 text-sm font-bold ${ch.accent}`}>
              Open {ch.title} · {scopeLabel} →
            </p>
          </Link>
        ))}
      </div>

      <Card className="text-sm text-zinc-600">
        BAU and GMS plan sheets are shared across channels; sellout and product tables here are{" "}
        <strong>per channel</strong>.
      </Card>
    </div>
  );
}
