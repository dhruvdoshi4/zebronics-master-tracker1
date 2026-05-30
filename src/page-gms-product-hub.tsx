import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useCatalogScope } from "./catalog-scope-context";
import { ProductLookupPanel } from "./product-lookup-panel";
import { Card, DataAsOnDualChannelBadge, PageTitle } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function GmsProductHubPage() {
  const { routePrefix } = useCatalogScope();
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

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
          subtitle="Search by ASIN, FSN, product ID, or model — same unified lookup as Product Lookup. Opens combined Amazon + Flipkart GMS when linked."
        />
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      <Card className="space-y-4">
        <ProductLookupPanel
          destination={{ type: "gms" }}
          routePrefix={routePrefix}
          fieldLabel="ASIN, FSN, product ID, or model name"
          placeholder="e.g. v19, B09GG4FT99, 47709"
          searchButtonLabel="Open GMS charts"
          searchingButtonLabel="Opening…"
        />
      </Card>
    </div>
  );
}
