import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  listDawgHoStockCategories,
  listHoStockQcomCategories,
  type HoStockQcomCategoryOption,
} from "./data-ho-stock";
import { useCatalogScope } from "./catalog-scope-context";
import { isDawgDataScope } from "./data-scope";
import { getAppTenant } from "./tenants";
import { useAuth } from "./use-auth";
import { useDataScope } from "./use-data-scope";
import { SUB_CATEGORY_FILTER_LABELS } from "./types";
import { EmptyState, InlineLoader, PageTitle } from "./ui";
import { useHoStockUploadMeta } from "./use-ho-stock-upload";
import {
  adminHoStockTopCategoryOptions,
  useAdminGlobalHoStockCategoryTree,
} from "./use-admin-global-ho-stock";
import { useManagerHoStockCategoryTree } from "./use-pravin-ho-stock";

export function HoStockCategoryPage() {
  const { user } = useAuth();
  const dataScope = useDataScope();
  const isDawgScope = isDawgDataScope(dataScope);
  const isQcomTenant = !isDawgScope && getAppTenant(user?.email) === "quickcommerce";
  const {
    isManagerWorkspace,
    filterLabels,
    filterOptions,
    routePrefix,
    tenantLabel,
    trackedSubCategories,
  } = useCatalogScope();
  const meta = useHoStockUploadMeta();
  const [qcomCategories, setQcomCategories] = useState<HoStockQcomCategoryOption[]>([]);
  const [isLoadingQcom, setIsLoadingQcom] = useState(false);
  const [qcomError, setQcomError] = useState<string | null>(null);
  const { useAdminGlobal, tree: adminCategoryTree, loading: adminTreeLoading } =
    useAdminGlobalHoStockCategoryTree();
  const { useTree: useManagerTree, tree: managerCategoryTree, loading: managerTreeLoading } =
    useManagerHoStockCategoryTree();
  const usesCategoryTree = useAdminGlobal || useManagerTree;
  const activeCategoryTree = useManagerTree ? managerCategoryTree : adminCategoryTree;

  const marketplaceCategoryKeys = useMemo(
    () => {
      if (usesCategoryTree) {
        return adminHoStockTopCategoryOptions(activeCategoryTree);
      }
      return isManagerWorkspace
        ? [...trackedSubCategories]
        : filterOptions.filter((key) => key !== "all");
    },
    [usesCategoryTree, activeCategoryTree, isManagerWorkspace, trackedSubCategories, filterOptions],
  );

  const allLabel = isManagerWorkspace
    ? filterLabels.all
    : SUB_CATEGORY_FILTER_LABELS.all;

  useEffect(() => {
    if (!isQcomTenant && !isDawgScope) return;
    setIsLoadingQcom(true);
    setQcomError(null);
    const loader = isDawgScope ? listDawgHoStockCategories : listHoStockQcomCategories;
    void loader()
      .then(setQcomCategories)
      .catch((e: unknown) => setQcomError(e instanceof Error ? e.message : "Failed to load categories."))
      .finally(() => setIsLoadingQcom(false));
  }, [isQcomTenant, isDawgScope]);

  return (
    <div className="space-y-6">
      <Link
        to={`${routePrefix}/ho-stock`}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to HO Stock
      </Link>

      <PageTitle
        title="HO Stock — Category wise"
        subtitle={
          meta.label
            ? isDawgScope
              ? `Stock as on ${meta.label} — Gaming - daWg and Personal Audio from your uploaded sellout masters.`
              : isQcomTenant
                ? `Stock as on ${meta.label} — categories and listings from the Consolidated tab of your qcom master workbook (ASIN / FSN match).`
                : isManagerWorkspace
                  ? `Stock as on ${meta.label} — ${tenantLabel} categories matched to your latest sellout uploads and HO stock ASIN/FSN rows.`
                  : useAdminGlobal
                    ? `Stock as on ${meta.label} — all manager categories (Cartridge, Monitor & Acc., Personal Audio, …) matched to HO stock ASIN/FSN rows.`
                    : `Stock as on ${meta.label} — categories mapped from latest uploaded sheets and synced to HO stock ASIN/FSN rows.`
            : "Upload a consolidated HO stock report first."
        }
      />

      {isQcomTenant || isDawgScope ? (
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
              to={`${routePrefix}/ho-stock/category/all`}
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
                to={`${routePrefix}/ho-stock/category/${encodeURIComponent(item.category)}`}
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
      ) : usesCategoryTree && (adminTreeLoading || managerTreeLoading) ? (
        <InlineLoader text="Loading categories…" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            to={`${routePrefix}/ho-stock/category/all`}
            className="rounded-2xl border-2 border-sky-300 bg-gradient-to-br from-sky-50 to-white p-5 shadow-sm transition hover:border-sky-400 hover:shadow-md"
          >
            <p className="text-lg font-bold text-zinc-900">{allLabel}</p>
            <p className="mt-1 text-sm text-zinc-600">
              {useAdminGlobal
                ? "Full HO stock across all manager categories — only Flipkart EOL FSNs hidden."
                : isManagerWorkspace
                  ? "Full HO stock for your workspace — listings from your Amazon / Flipkart sellout uploads."
                  : "Full HO stock report — only FSNs marked EOL on Flipkart are hidden."}
            </p>
            <p className="mt-3 text-sm font-semibold text-sky-700">View HO stock table →</p>
          </Link>
          {marketplaceCategoryKeys.map((key) => (
            <Link
              key={key}
              to={`${routePrefix}/ho-stock/category/${encodeURIComponent(key)}`}
              className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-sky-300 hover:shadow-md"
            >
              <p className="text-lg font-bold text-zinc-900">
                {usesCategoryTree ? key : (filterLabels[key] ?? key)}
              </p>
              {usesCategoryTree ? (
                <p className="mt-1 text-sm text-zinc-600">
                  {(activeCategoryTree.subCategoriesByCategory[key] ?? []).length > 0
                    ? `${activeCategoryTree.subCategoriesByCategory[key]!.length} sub-categories`
                    : "View listings"}
                </p>
              ) : null}
              <p className="mt-3 text-sm font-semibold text-sky-700">View HO stock table →</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
