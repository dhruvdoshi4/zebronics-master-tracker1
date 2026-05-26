import { useCatalogScope } from "./catalog-scope-context";
import { ProductLookupPanel } from "./product-lookup-panel";
import { Card, DataAsOnDualChannelBadge, PageTitle } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function AsinLookupPage() {
  const { routePrefix } = useCatalogScope();
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Product Lookup"
            subtitle="Search once by ASIN, FSN, product ID, or model — each product appears once, synced by Product ID."
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
        <ProductLookupPanel destination={{ type: "hub" }} routePrefix={routePrefix} />
      </Card>
    </div>
  );
}
