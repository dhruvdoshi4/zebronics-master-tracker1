import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useCatalogScope } from "./catalog-scope-context";
import { ProductLookupPanel } from "./product-lookup-panel";
import {
  Card,
  DataAsOnDualChannelBadge,
  PageTitle,
} from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function AnalysisSelloutLookupPage() {
  const { routePrefix } = useCatalogScope();
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

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
            title="Sellout & growth analysis"
            subtitle="Search by ASIN, FSN, product ID, or model — opens sellout charts on the best-matched channel."
          />
        </div>
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      <Card className="space-y-4">
        <ProductLookupPanel
          destination={{ type: "workspace", suffix: "sellout-growth", from: "analysis" }}
          routePrefix={routePrefix}
          searchButtonLabel="Open sellout"
          searchingButtonLabel="Opening…"
        />
      </Card>
    </div>
  );
}
