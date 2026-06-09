import { useEffect, useMemo, useState } from "react";
import { searchHoStockProducts, type HoStockSearchRow } from "./data-ho-stock";
import { useTableSort } from "./table-sort";
import { Link, useNavigate } from "react-router-dom";
import { Search, Warehouse } from "lucide-react";
import { productIdHubPath } from "./product-channel";
import { useCatalogScope } from "./catalog-scope-context";
import { isDawgDataScope } from "./data-scope";
import { getAppTenant } from "./tenants";
import {
  Button,
  Card,
  EmptyState,
  FieldLabel,
  Input,
  PageTitle,
  Select,
  SortableTableHeader,
} from "./ui";
import { stockAgeingForProductId } from "./data-stock-ageing";
import {
  HoStockAgeingBucketCells,
  HoStockAgeingBucketHeaders,
  hoStockAgeingSortValue,
  formatHoStockCumulativeDrr,
  hoStockCumulativeDrrUnits,
} from "./ho-stock-ageing-ui";
import { STOCK_AGEING_BUCKET_COLUMNS } from "./stock-ageing";
import { useAuth } from "./use-auth";
import { useStockAgeingData } from "./use-stock-ageing";
import { useDataScope } from "./use-data-scope";
import { useHoStockUploadMeta } from "./use-ho-stock-upload";
import {
  adminHoStockSubCategoryLabel,
  useAdminGlobalHoStockCategoryTree,
  useAdminHoStockFilterOptions,
} from "./use-admin-global-ho-stock";
import { ANALYSIS_SUB_CATEGORY_ALL } from "./analysis-category-paths";
import { HoStockDocExplanation } from "./ho-stock-doc-note";
import { QcomNetworkDocExplanation } from "./qcom-network-doc-note";
import {
  listDawgHoStockCategories,
  listHoStockQcomCategories,
  type HoStockQcomCategoryOption,
} from "./data-ho-stock";
import {
  cn,
  formatHoStockChannelDrr,
  formatHoStockDocDays,
  formatHoStockQcomDrr,
  formatInteger,
  isHoStockLowDoc,
  isQcomNetworkDocLow,
} from "./utils";

function listingCodes(row: HoStockSearchRow): string {
  const parts: string[] = [];
  if (row.asin) parts.push(`ASIN ${row.asin}`);
  if (row.fsn) parts.push(`FSN ${row.fsn}`);
  return parts.join(" · ") || "—";
}

export function HoStockHubPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [ageingView, setAgeingView] = useState(false);
  const ageingData = useStockAgeingData(isAdmin && ageingView);
  const dataScope = useDataScope();
  const isDawgScope = isDawgDataScope(dataScope);
  const isQcomTenant = !isDawgScope && getAppTenant(user?.email) === "quickcommerce";
  const {
    filterOptions,
    filterLabels,
    routePrefix,
    workspace: catalogWorkspace,
  } = useCatalogScope();
  const showMarketplaceMetrics = !isQcomTenant;
  const showQcomMetrics = isQcomTenant;
  const showDocMetrics = showMarketplaceMetrics || showQcomMetrics;
  const isLowDoc = (docDays: number | null) =>
    isQcomTenant ? isQcomNetworkDocLow(docDays) : isHoStockLowDoc(docDays);
  const meta = useHoStockUploadMeta();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HoStockSearchRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const hasUpload = Boolean(meta.snapshotDate);
  const [qcomCategories, setQcomCategories] = useState<HoStockQcomCategoryOption[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedSubCategory, setSelectedSubCategory] = useState("all");
  const { useAdminGlobal, tree: adminCategoryTree } = useAdminGlobalHoStockCategoryTree();
  const adminFilterOptions = useAdminHoStockFilterOptions(adminCategoryTree, selectedCategory);

  useEffect(() => {
    if (!useAdminGlobal) return;
    setSelectedSubCategory(ANALYSIS_SUB_CATEGORY_ALL);
  }, [selectedCategory, useAdminGlobal]);

  useEffect(() => {
    if (!isQcomTenant && !isDawgScope) {
      setQcomCategories([]);
      setSelectedCategory("all");
      setSelectedSubCategory("all");
      return;
    }
    const loader = isDawgScope ? listDawgHoStockCategories : listHoStockQcomCategories;
    void loader()
      .then((rows) => {
        setQcomCategories(rows);
      })
      .catch(() => setQcomCategories([]));
  }, [isQcomTenant, isDawgScope]);

  const subCategoryOptions = useMemo(() => {
    if (useAdminGlobal) {
      return adminFilterOptions.subCategoryOptions.map((opt) => opt.value);
    }
    if (!isQcomTenant && !isDawgScope) {
      const base = filterOptions.filter((option) => option !== "all");
      if (selectedCategory === "all") return ["all", ...base];
      return ["all", ...base.filter((option) => option === selectedCategory)];
    }
    if (selectedCategory === "all") {
      const set = new Set<string>(["all"]);
      for (const item of qcomCategories) {
        for (const sub of item.subCategories) set.add(sub);
      }
      return [...set];
    }
    const row = qcomCategories.find(
      (item) => item.category.toLowerCase() === selectedCategory.toLowerCase(),
    );
    return ["all", ...(row?.subCategories ?? [])];
  }, [useAdminGlobal, adminFilterOptions.subCategoryOptions, isQcomTenant, isDawgScope, selectedCategory, qcomCategories, filterOptions]);

  useEffect(() => {
    if (!subCategoryOptions.some((item) => item === selectedSubCategory)) {
      setSelectedSubCategory("all");
    }
  }, [selectedSubCategory, subCategoryOptions]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || !hasUpload) {
      setResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      void searchHoStockProducts(trimmed, 25, {
        qcomNetworkDoc: isQcomTenant,
        adminGlobalNetworkDoc: useAdminGlobal,
        dataScope,
        catalogWorkspace,
      })
        .then(setResults)
        .catch((e: unknown) => {
          setResults([]);
          setSearchError(e instanceof Error ? e.message : "Search failed.");
        })
        .finally(() => setIsSearching(false));
    }, 220);

    return () => window.clearTimeout(timer);
  }, [query, hasUpload, isQcomTenant, useAdminGlobal, dataScope, catalogWorkspace]);

  const showResults = query.trim().length >= 2 && hasUpload;

  const hoStockSortAccessors = useMemo(
    () =>
      ({
        model_name: (row: HoStockSearchRow) => row.model_name,
        erp_product_id: (row: HoStockSearchRow) => row.erp_product_id,
        listing: (row: HoStockSearchRow) => listingCodes(row),
        ...(ageingView
          ? {
              ...Object.fromEntries(
                STOCK_AGEING_BUCKET_COLUMNS.map((col) => [
                  col.key,
                  (row: HoStockSearchRow) =>
                    hoStockAgeingSortValue(
                      stockAgeingForProductId(ageingData.byPrdcode, row.erp_product_id),
                      col.key,
                    ),
                ]),
              ),
              cumulative_drr_units: (row: HoStockSearchRow) => hoStockCumulativeDrrUnits(row),
            }
          : {
              ho_units: (row: HoStockSearchRow) => row.ho_units,
              gurgaon_units: (row: HoStockSearchRow) => row.gurgaon_units,
              total_units: (row: HoStockSearchRow) => row.total_units,
            }),
        ...(showMarketplaceMetrics
          ? {
              amazon_drr_units: (row: HoStockSearchRow) => row.amazon_drr_units,
              flipkart_drr_units: (row: HoStockSearchRow) => row.flipkart_drr_units,
              doc_days: (row: HoStockSearchRow) => row.doc_days,
            }
          : {}),
        ...(showQcomMetrics
          ? {
              amazon_drr_units: (row: HoStockSearchRow) => row.amazon_drr_units,
              flipkart_drr_units: (row: HoStockSearchRow) => row.flipkart_drr_units,
              qcom_drr_units: (row: HoStockSearchRow) => row.qcom_drr_units,
              doc_days: (row: HoStockSearchRow) => row.doc_days,
            }
          : {}),
      }) satisfies import("./table-sort").TableSortAccessors<HoStockSearchRow>,
    [showMarketplaceMetrics, showQcomMetrics, ageingView, ageingData.byPrdcode],
  );

  const { sortedRows, sortKey, sortDirection, requestSort } = useTableSort(
    results,
    hoStockSortAccessors,
    "total_units",
    "desc",
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <PageTitle
          title="HO Stock"
          subtitle={
            isQcomTenant
              ? "Head-office inventory by qcom category — network DOC includes Amazon, Flipkart, and all QCom platforms when the listing has ASIN/FSN."
              : "Consolidated head-office inventory — matched to your Amazon ASINs and Flipkart FSNs by category."
          }
        />
        {meta.snapshotDate ? (
          <div className="rounded-xl border border-sky-200 bg-sky-50/90 px-4 py-2 text-sm font-medium text-sky-950">
            <p className="text-[10px] font-bold uppercase tracking-wide text-sky-700">Stock as on</p>
            <p>{meta.label}</p>
            {meta.fileName ? (
              <p className="mt-0.5 truncate text-xs font-normal text-sky-800/80">{meta.fileName}</p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-2 text-sm text-amber-950">
            No HO stock report uploaded yet. Upload from{" "}
            <Link to={`${routePrefix}/upload`} className="font-semibold underline">
              Upload Center
            </Link>
            .
          </div>
        )}
      </div>

      {showMarketplaceMetrics && hasUpload ? <HoStockDocExplanation /> : null}
      {showQcomMetrics && hasUpload ? <QcomNetworkDocExplanation /> : null}

      <Card className="flex items-start gap-3 text-sm text-zinc-700">
        <Warehouse className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
        <p>
          Use the consolidated workbook sheet <strong>Consolidated HO Stock Report</strong> (ASIN, FSN,
          ERP model name, HO, Gurgaon, Total). Only rows whose ASIN or FSN exist in Product Master for
          the selected category are shown.
        </p>
      </Card>

      <Card className="space-y-4">
        <div className="grid gap-3 border-b border-zinc-100 pb-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <FieldLabel>Category</FieldLabel>
            <Select
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
            >
              <option value="all">All categories</option>
              {(useAdminGlobal
                ? adminFilterOptions.categoryOptions.filter((opt) => opt.value !== "all")
                : isQcomTenant || isDawgScope
                  ? qcomCategories.map((item) => item.category)
                  : filterOptions.filter((option) => option !== "all")
              ).map((option) => {
                const value = typeof option === "string" ? option : option.value;
                const label =
                  typeof option === "string"
                    ? (filterLabels[option] ?? option)
                    : option.label;
                return (
                  <option key={value} value={value}>
                    {label}
                  </option>
                );
              })}
            </Select>
          </div>
          <div>
            <FieldLabel>Sub-category</FieldLabel>
            <Select
              value={selectedSubCategory}
              onChange={(event) => setSelectedSubCategory(event.target.value)}
            >
              {subCategoryOptions.map((option) => (
                <option key={option} value={option}>
                  {useAdminGlobal
                    ? adminHoStockSubCategoryLabel(option)
                    : option === "all"
                      ? "All"
                      : (filterLabels[option] ?? option)}
                </option>
              ))}
            </Select>
          </div>
          {isAdmin ? (
            <div className="self-end">
              <FieldLabel>Admin view</FieldLabel>
              <Button
                type="button"
                className={cn(
                  ageingView
                    ? "bg-amber-700 hover:bg-amber-800"
                    : "bg-zinc-700 hover:bg-zinc-800",
                )}
                onClick={() => setAgeingView((value) => !value)}
              >
                Ageing
              </Button>
            </div>
          ) : null}
          <div className="self-end">
            <button
              type="button"
              onClick={() => {
                if (useAdminGlobal) {
                  const categoryPath = encodeURIComponent(selectedCategory || "all");
                  const base = `${routePrefix}/ho-stock/category/${categoryPath}`;
                  if (selectedSubCategory !== ANALYSIS_SUB_CATEGORY_ALL) {
                    void navigate(
                      `${base}?sub=${encodeURIComponent(selectedSubCategory)}`,
                    );
                    return;
                  }
                  void navigate(base);
                  return;
                }
                const effectiveCategory =
                  selectedSubCategory !== "all" ? selectedSubCategory : selectedCategory;
                const categoryPath = encodeURIComponent(effectiveCategory || "all");
                const base = `${routePrefix}/ho-stock/category/${categoryPath}`;
                if (selectedSubCategory !== "all" && (isQcomTenant || isDawgScope)) {
                  void navigate(`${base}?sub=${encodeURIComponent(selectedSubCategory)}`);
                  return;
                }
                void navigate(base);
              }}
              className="inline-flex h-10 items-center rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700"
            >
              Open category view
            </button>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Search className="mt-1 h-5 w-5 shrink-0 text-sky-600" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <FieldLabel>Search product</FieldLabel>
              <Input
                type="search"
                placeholder={
                  hasUpload
                    ? "Model name, ASIN, FSN, or Product ID…"
                    : "Upload HO stock report to enable search"
                }
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={!hasUpload}
              />
              <p className="mt-1.5 text-xs font-medium text-zinc-500">
                Search the full stock report — not limited to a single category.
              </p>
              {ageingView ? (
                <p className="mt-1 text-xs text-amber-800">
                  {ageingData.isLoading
                    ? "Loading stock ageing…"
                    : ageingData.hasAgeing
                      ? `Ageing as on ${ageingData.label ?? "—"} — matched by Product ID (Prdcode).`
                      : "No stock ageing report uploaded yet (Upload Center → Stock ageing)."}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {showResults ? (
          <div className="space-y-3 border-t border-zinc-100 pt-4">
            <p className="text-sm font-semibold text-zinc-800">
              {isSearching
                ? "Searching…"
                : searchError
                  ? "Search error"
                  : `${results.length} result${results.length === 1 ? "" : "s"}`}
            </p>
            {searchError ? (
              <EmptyState title="Search failed" description={searchError} />
            ) : !isSearching && results.length === 0 ? (
              <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500">
                No products match &ldquo;{query.trim()}&rdquo; in the latest HO stock report.
              </p>
            ) : results.length > 0 ? (
              <div className="overflow-auto rounded-xl border border-zinc-200">
                <table className="min-w-full divide-y divide-zinc-200 text-sm">
                  <thead className="bg-zinc-50 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    <tr>
                      <SortableTableHeader
                        label="Model"
                        sortKey="model_name"
                        activeKey={sortKey}
                        activeDirection={sortDirection}
                        onSort={requestSort}
                        className="py-2.5"
                      />
                      <SortableTableHeader
                        label="Product ID"
                        sortKey="erp_product_id"
                        activeKey={sortKey}
                        activeDirection={sortDirection}
                        onSort={requestSort}
                        className="py-2.5"
                      />
                      <SortableTableHeader
                        label="Listing"
                        sortKey="listing"
                        activeKey={sortKey}
                        activeDirection={sortDirection}
                        onSort={requestSort}
                        className="py-2.5"
                      />
                      {ageingView ? (
                        <>
                          <HoStockAgeingBucketHeaders
                            sortKey={sortKey}
                            sortDirection={sortDirection}
                            onSort={requestSort}
                          />
                          <SortableTableHeader
                            label="Cumulative DRR"
                            sortKey="cumulative_drr_units"
                            activeKey={sortKey}
                            activeDirection={sortDirection}
                            onSort={requestSort}
                            align="right"
                            className="py-2.5"
                          />
                        </>
                      ) : (
                        <>
                          <SortableTableHeader
                            label="HO"
                            sortKey="ho_units"
                            activeKey={sortKey}
                            activeDirection={sortDirection}
                            onSort={requestSort}
                            align="right"
                            className="py-2.5"
                          />
                          <SortableTableHeader
                            label="Gurgaon"
                            sortKey="gurgaon_units"
                            activeKey={sortKey}
                            activeDirection={sortDirection}
                            onSort={requestSort}
                            align="right"
                            className="py-2.5"
                          />
                          <SortableTableHeader
                            label="Total"
                            sortKey="total_units"
                            activeKey={sortKey}
                            activeDirection={sortDirection}
                            onSort={requestSort}
                            align="right"
                            className="py-2.5"
                          />
                        </>
                      )}
                      {!ageingView && showMarketplaceMetrics ? (
                        <>
                          <SortableTableHeader
                            label="Amazon DRR"
                            sortKey="amazon_drr_units"
                            activeKey={sortKey}
                            activeDirection={sortDirection}
                            onSort={requestSort}
                            align="right"
                            className="py-2.5"
                          />
                          <SortableTableHeader
                            label="Flipkart DRR"
                            sortKey="flipkart_drr_units"
                            activeKey={sortKey}
                            activeDirection={sortDirection}
                            onSort={requestSort}
                            align="right"
                            className="py-2.5"
                          />
                          <SortableTableHeader
                            label="DOC"
                            sortKey="doc_days"
                            activeKey={sortKey}
                            activeDirection={sortDirection}
                            onSort={requestSort}
                            align="right"
                            className="py-2.5"
                          />
                        </>
                      ) : null}
                      {!ageingView && showQcomMetrics ? (
                        <>
                          <SortableTableHeader
                            label="Amazon DRR"
                            sortKey="amazon_drr_units"
                            activeKey={sortKey}
                            activeDirection={sortDirection}
                            onSort={requestSort}
                            align="right"
                            className="py-2.5"
                          />
                          <SortableTableHeader
                            label="Flipkart DRR"
                            sortKey="flipkart_drr_units"
                            activeKey={sortKey}
                            activeDirection={sortDirection}
                            onSort={requestSort}
                            align="right"
                            className="py-2.5"
                          />
                          <SortableTableHeader
                            label="QCom DRR"
                            sortKey="qcom_drr_units"
                            activeKey={sortKey}
                            activeDirection={sortDirection}
                            onSort={requestSort}
                            align="right"
                            className="py-2.5"
                          />
                          <SortableTableHeader
                            label="Network DOC"
                            sortKey="doc_days"
                            activeKey={sortKey}
                            activeDirection={sortDirection}
                            onSort={requestSort}
                            align="right"
                            className="py-2.5"
                          />
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {sortedRows.map((row) => {
                      const rowKey = row.row_key;
                      const modelCell =
                        row.erp_product_id ? (
                          <Link
                            to={productIdHubPath(row.erp_product_id)}
                            className="font-medium text-violet-700 hover:underline"
                          >
                            {row.model_name}
                          </Link>
                        ) : (
                          <span className="font-medium text-zinc-900">{row.model_name}</span>
                        );
                      return (
                        <tr
                          key={rowKey}
                          className={cn(
                            showDocMetrics && isLowDoc(row.doc_days)
                              ? "bg-rose-50 hover:bg-rose-100/90"
                              : "hover:bg-sky-50/40",
                          )}
                        >
                          <td className="max-w-xs px-3 py-2.5">{modelCell}</td>
                          <td className="px-3 py-2.5 font-mono text-xs text-zinc-600">
                            {row.erp_product_id || "—"}
                          </td>
                          <td className="max-w-[10rem] px-3 py-2.5 text-xs font-medium text-zinc-600">
                            {listingCodes(row)}
                          </td>
                          {ageingView ? (
                            <>
                              <HoStockAgeingBucketCells
                                ageing={stockAgeingForProductId(
                                  ageingData.byPrdcode,
                                  row.erp_product_id,
                                )}
                              />
                              <td className="px-3 py-2.5 text-right tabular-nums">
                                {formatHoStockCumulativeDrr(row)}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-2.5 text-right tabular-nums">
                                {formatInteger(row.ho_units)}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums">
                                {formatInteger(row.gurgaon_units)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-zinc-900">
                                {formatInteger(row.total_units)}
                              </td>
                            </>
                          )}
                          {!ageingView && showMarketplaceMetrics ? (
                            <>
                              <td className="px-3 py-2.5 text-right tabular-nums">
                                {formatHoStockChannelDrr(row.amazon_drr_units, Boolean(row.asin))}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums">
                                {formatHoStockChannelDrr(row.flipkart_drr_units, Boolean(row.fsn))}
                              </td>
                              <td
                                className={cn(
                                  "px-3 py-2.5 text-right tabular-nums font-semibold",
                                  isLowDoc(row.doc_days) && "text-rose-800",
                                )}
                              >
                                {formatHoStockDocDays(row.doc_days)}
                              </td>
                            </>
                          ) : null}
                          {!ageingView && showQcomMetrics ? (
                            <>
                              <td className="px-3 py-2.5 text-right tabular-nums">
                                {formatHoStockChannelDrr(row.amazon_drr_units, Boolean(row.asin))}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums">
                                {formatHoStockChannelDrr(row.flipkart_drr_units, Boolean(row.fsn))}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums">
                                {formatHoStockQcomDrr(row.qcom_drr_units, row.qcom_channel_linked)}
                              </td>
                              <td
                                className={cn(
                                  "px-3 py-2.5 text-right tabular-nums font-semibold",
                                  isLowDoc(row.doc_days) && "text-rose-800",
                                )}
                              >
                                {formatHoStockDocDays(row.doc_days)}
                              </td>
                            </>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

    </div>
  );
}
