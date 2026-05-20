import { Link } from "react-router-dom";
import { Layers, LineChart } from "lucide-react";
import { Card, DataAsOnDualChannelBadge, PageTitle } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function AnalysisHubPage() {
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Data analysis"
            subtitle="Category roll-ups and direct sellout lookup — Amazon + Flipkart."
          />
        </div>
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          to="/app/analysis/category"
          className="rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-50 to-white p-6 shadow-sm transition hover:shadow-md"
        >
          <Layers className="h-8 w-8 text-violet-700" />
          <h2 className="mt-4 text-xl font-bold tracking-tight text-zinc-900">Category analysis</h2>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            Combined Amazon + Flipkart sell-out by product group — FY, YTD and MoM.
          </p>
          <p className="mt-4 text-sm font-bold text-violet-700">Open category →</p>
        </Link>

        <Link
          to="/app/analysis/sellout-lookup"
          className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-white p-6 shadow-sm transition hover:shadow-md"
        >
          <LineChart className="h-8 w-8 text-emerald-700" />
          <h2 className="mt-4 text-xl font-bold tracking-tight text-zinc-900">
            Sellout &amp; growth analysis
          </h2>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            Jump straight to a model’s sellout charts on either channel.
          </p>
          <p className="mt-4 text-sm font-bold text-emerald-700">Search model →</p>
        </Link>
      </div>

      <Card className="text-sm font-medium text-zinc-600">
        Category totals roll up stored daily sales across both channels for every model in the group.
      </Card>
    </div>
  );
}
