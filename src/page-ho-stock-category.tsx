import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { SUB_CATEGORY_LABELS, TRACKED_SUB_CATEGORIES, type SubCategory } from "./types";
import { PageTitle } from "./ui";
import { useHoStockUploadMeta } from "./use-ho-stock-upload";

export function HoStockCategoryPage() {
  const meta = useHoStockUploadMeta();

  return (
    <div className="space-y-6">
      <Link
        to="/app/ho-stock"
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to HO Stock
      </Link>

      <PageTitle
        title="HO Stock — Category wise"
        subtitle={
          meta.label
            ? `Stock as on ${meta.label} — listings matched from Product Master.`
            : "Upload a consolidated HO stock report first."
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TRACKED_SUB_CATEGORIES.map((key: SubCategory) => (
          <Link
            key={key}
            to={`/app/ho-stock/category/${encodeURIComponent(key)}`}
            className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-sky-300 hover:shadow-md"
          >
            <p className="text-lg font-bold text-zinc-900">{SUB_CATEGORY_LABELS[key]}</p>
            <p className="mt-3 text-sm font-semibold text-sky-700">View HO stock table →</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
