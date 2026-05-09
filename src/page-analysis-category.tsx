import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { SUB_CATEGORY_LABELS, TRACKED_SUB_CATEGORIES, type SubCategory } from "./types";
import { DataAsOnDualChannelBadge, PageTitle } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function AnalysisCategoryPage() {
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

  return (
    <div className="space-y-6">
      <Link
        to="/app/analysis"
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Data analysis
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Category analysis"
            subtitle="Roll-up sell-out by category — Amazon and Flipkart combined."
          />
        </div>
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      <div>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-zinc-600">
          Sub-categories
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TRACKED_SUB_CATEGORIES.map((key: SubCategory) => (
            <Link
              key={key}
              to={`/app/analysis/category/${encodeURIComponent(key)}`}
              className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-violet-300 hover:shadow-md"
            >
              <p className="text-lg font-bold text-zinc-900">{SUB_CATEGORY_LABELS[key]}</p>
              <p className="mt-1 font-mono text-xs font-semibold text-zinc-500">{key}</p>
              <p className="mt-3 text-sm font-semibold text-violet-700">Open roll-up →</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
