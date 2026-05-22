import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { listHoStockQcomCategories, type HoStockQcomCategoryOption } from "./data-ho-stock";
import { getAppTenant } from "./tenants";
import { useAuth } from "./use-auth";
import {
  SUB_CATEGORY_FILTER_LABELS,
  SUB_CATEGORY_LABELS,
  TRACKED_SUB_CATEGORIES,
  type SubCategory,
} from "./types";
import { EmptyState, InlineLoader, PageTitle } from "./ui";
import { useHoStockUploadMeta } from "./use-ho-stock-upload";

export function HoStockCategoryPage() {
  const { user } = useAuth();
  const isQcomTenant = getAppTenant(user?.email) === "quickcommerce";
  const meta = useHoStockUploadMeta();
  const [qcomCategories, setQcomCategories] = useState<HoStockQcomCategoryOption[]>([]);
  const [isLoadingQcom, setIsLoadingQcom] = useState(false);
  const [qcomError, setQcomError] = useState<string | null>(null);

  useEffect(() => {
    if (!isQcomTenant) return;
    setIsLoadingQcom(true);
    setQcomError(null);
    void listHoStockQcomCategories()
      .then(setQcomCategories)
      .catch((e: unknown) => setQcomError(e instanceof Error ? e.message : "Failed to load categories."))
      .finally(() => setIsLoadingQcom(false));
  }, [isQcomTenant]);

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
            ? isQcomTenant
              ? `Stock as on ${meta.label} — categories and listings from the Consolidated tab of your qcom master workbook (ASIN / FSN match).`
              : `Stock as on ${meta.label} — categories mapped from latest uploaded sheets and synced to HO stock ASIN/FSN rows.`
            : "Upload a consolidated HO stock report first."
        }
      />

      {isQcomTenant ? (
        isLoadingQcom ? (
          <InlineLoader text="Loading categories…" />
        ) : qcomError ? (
          <EmptyState title="Unable to load categories" description={qcomError} />
        ) : qcomCategories.length === 0 ? (
          <EmptyState
            title="No qcom categories found"
            description="Upload the qcom master workbook with a Consolidated tab (category, ASIN/FSN, model) from Upload Center."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              to="/app/ho-stock/category/all"
              className="rounded-2xl border-2 border-sky-300 bg-gradient-to-br from-sky-50 to-white p-5 shadow-sm transition hover:border-sky-400 hover:shadow-md"
            >
              <p className="text-lg font-bold text-zinc-900">All categories</p>
              <p className="mt-1 text-sm text-zinc-600">
                Full HO stock matched to every Consolidated-tab listing (ASIN / FSN).
              </p>
              <p className="mt-3 text-sm font-semibold text-sky-700">View HO stock table →</p>
            </Link>
            {qcomCategories.map((item) => (
              <Link
                key={item.category}
                to={`/app/ho-stock/category/${encodeURIComponent(item.category)}`}
                className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-sky-300 hover:shadow-md"
              >
                <p className="text-lg font-bold text-zinc-900">{item.category}</p>
                <p className="mt-1 text-sm text-zinc-600">
                  {item.subCategories.length > 0
                    ? `${item.subCategories.length} sub-categories`
                    : "No sub-category split"}
                </p>
                <p className="mt-3 text-sm font-semibold text-sky-700">View HO stock table →</p>
              </Link>
            ))}
          </div>
        )
      ) : (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/app/ho-stock/category/all"
          className="rounded-2xl border-2 border-sky-300 bg-gradient-to-br from-sky-50 to-white p-5 shadow-sm transition hover:border-sky-400 hover:shadow-md"
        >
          <p className="text-lg font-bold text-zinc-900">{SUB_CATEGORY_FILTER_LABELS.all}</p>
          <p className="mt-1 text-sm text-zinc-600">
            Full HO stock report — only FSNs marked EOL on Flipkart are hidden.
          </p>
          <p className="mt-3 text-sm font-semibold text-sky-700">View HO stock table →</p>
        </Link>
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
      )}
    </div>
  );
}
