import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { SUB_CATEGORY_LABELS, TRACKED_SUB_CATEGORIES, type SubCategory } from "./types";
import { DataAsOnDualChannelBadge, PageTitle } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function GmsCategoryPage() {
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

  return (
    <div className="space-y-6">
      <Link
        to="/app/gms"
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to GMS Tracker
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TRACKED_SUB_CATEGORIES.map((key: SubCategory) => (
          <Link
            key={key}
            to={`/app/gms/category/${encodeURIComponent(key)}`}
            className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-violet-300 hover:shadow-md"
          >
            <p className="text-lg font-bold text-zinc-900">{SUB_CATEGORY_LABELS[key]}</p>
            <p className="mt-3 text-sm font-semibold text-violet-700">Open GMS charts →</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
