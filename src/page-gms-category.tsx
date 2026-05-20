import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  SUB_CATEGORY_FILTER_LABELS,
  type SubCategoryFilter,
} from "./types";
import { Button, DataAsOnDualChannelBadge, PageTitle, SubCategoryFilterSelect } from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

export function GmsCategoryPage() {
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const [subCategory, setSubCategory] = useState<SubCategoryFilter>("all");

  return (
    <div className="space-y-6">
      <Link
        to="/app/gms"
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to GMS Tracker
      </Link>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
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

      <div className="flex flex-wrap items-end gap-3">
        <SubCategoryFilterSelect value={subCategory} onChange={setSubCategory} />
        <Link to={`/app/gms/category/${encodeURIComponent(subCategory)}`}>
          <Button type="button" className="h-[42px]">
            Open {SUB_CATEGORY_FILTER_LABELS[subCategory]} GMS charts →
          </Button>
        </Link>
      </div>
    </div>
  );
}
