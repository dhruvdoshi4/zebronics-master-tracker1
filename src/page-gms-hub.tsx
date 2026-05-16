import { Link } from "react-router-dom";
import { IndianRupee, Layers, Package } from "lucide-react";
import { Card, DataAsOnDualChannelBadge, PageTitle } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function GmsHubPage() {
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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

      <Card className="text-sm font-medium text-zinc-700">
        Upload one <strong>BAU</strong> and one <strong>GMS plan</strong> sheet (both channels in the same
        file — BAU is shared per model). Sellout still comes from separate Amazon / Flipkart masters.
        Override BAU per listing in Product Master only when a SKU price differs.
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          to="/app/gms/category"
          className="rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-50 to-white p-6 shadow-sm transition hover:shadow-md"
        >
          <Layers className="h-8 w-8 text-violet-700" />
          <h2 className="mt-4 text-xl font-bold text-zinc-900">Category wise</h2>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            Combined Amazon + Flipkart GMS by category — FY trend and MoM (current month = MTD ongoing).
          </p>
          <p className="mt-4 text-sm font-bold text-violet-700">Open categories →</p>
        </Link>

        <Link
          to="/app/gms/product"
          className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-white p-6 shadow-sm transition hover:shadow-md"
        >
          <Package className="h-8 w-8 text-emerald-700" />
          <h2 className="mt-4 text-xl font-bold text-zinc-900">Product wise</h2>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            Separate Amazon and Flipkart pages — search, table, and charts per channel only.
          </p>
          <p className="mt-4 text-sm font-bold text-emerald-700">Choose Amazon or Flipkart →</p>
        </Link>
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
