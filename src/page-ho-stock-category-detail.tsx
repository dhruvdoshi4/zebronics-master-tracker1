import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  listHoStockQcomCategories,
  loadHoStockCategoryReport,
  loadHoStockQcomCategoryReport,
  type HoStockCategoryRow,
  type HoStockCategorySummary,
} from "./data-ho-stock";
import { useCatalogScope } from "./catalog-scope-context";
import { getAppTenant } from "./tenants";
import { SUB_CATEGORY_FILTER_LABELS, type SubCategoryFilter } from "./types";
import { useTableSort } from "./table-sort";
import {
  Card,
  EmptyState,
  FieldLabel,
  InlineLoader,
  Select,
  SortableTableHeader,
  StatCard,
  SubCategoryFilterSelect,
} from "./ui";
import { useAuth } from "./use-auth";
import { useHoStockUploadMeta } from "./use-ho-stock-upload";
import { HoStockDocExplanation } from "./ho-stock-doc-note";
import { QcomNetworkDocExplanation } from "./qcom-network-doc-note";
import {
  cn,
  formatCoverageDataAsOf,
  formatHoStockChannelDrr,
  formatHoStockDocDays,
  formatHoStockQcomDrr,
  formatInteger,
  isHoStockLowDoc,
  isQcomNetworkDocLow,
} from "./utils";

export function HoStockCategoryDetailPage() {
  const { user } = useAuth();
  const isQcomTenant = getAppTenant(user?.email) === "quickcommerce";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useParams<{ subCategory: string }>();
  const decodedSub =
    params.subCategory != null ? decodeURIComponent(params.subCategory) : "";
  const {
    workspace,
    isManagerWorkspace,
    filterLabels,
    filterOptions,
    parseSubCategoryFilter,
    routePrefix,
  } = useCatalogScope();
  const categoryFilter = isQcomTenant ? null : parseSubCategoryFilter(decodedSub);
  const categoryLabels: Record<string, string> = isManagerWorkspace
    ? filterLabels
    : SUB_CATEGORY_FILTER_LABELS;
  const qcomCategory = isQcomTenant ? decodedSub.trim() : "";
  const selectedQcomSub = (searchParams.get("sub") ?? "all").trim() || "all";
  const [qcomCategories, setQcomCategories] = useState<
    Awaited<ReturnType<typeof listHoStockQcomCategories>>
  >([]);
  const [qcomSubOptions, setQcomSubOptions] = useState<string[]>([]);
  const isQcomAllCategories =
    isQcomTenant && qcomCategory.toLowerCase() === "all";

  const uploadMeta = useHoStockUploadMeta();
  const [report, setReport] = useState<HoStockCategorySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!isQcomTenant) return;
    void listHoStockQcomCategories().then(setQcomCategories).catch(() => setQcomCategories([]));
  }, [isQcomTenant]);

  useEffect(() => {
    if (!isQcomTenant || !qcomCategory) return;
    let options: string[];
    if (isQcomAllCategories) {
      const subs = new Set<string>();
      for (const item of qcomCategories) {
        for (const sub of item.subCategories) subs.add(sub);
      }
      options = ["all", ...[...subs].sort((a, b) => a.localeCompare(b))];
    } else {
      const entry = qcomCategories.find(
        (it) => it.category.toLowerCase() === qcomCategory.toLowerCase(),
      );
      options = ["all", ...(entry?.subCategories ?? [])];
    }
    setQcomSubOptions(options);
    if (!options.some((v) => v.toLowerCase() === selectedQcomSub.toLowerCase())) {
      setSearchParams({ sub: "all" }, { replace: true });
    }
  }, [
    isQcomTenant,
    qcomCategory,
    isQcomAllCategories,
    qcomCategories,
    selectedQcomSub,
    setSearchParams,
  ]);

  useEffect(() => {
    if (isQcomTenant) {
      if (!qcomCategory) return;
      setIsLoading(true);
      setError(null);
      setReport(null);
      setFilter("");
      void loadHoStockQcomCategoryReport(qcomCategory, selectedQcomSub)
        .then(setReport)
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : "Failed to load HO stock."),
        )
        .finally(() => setIsLoading(false));
      return;
    }
    if (!categoryFilter) return;
    setIsLoading(true);
    setError(null);
    setReport(null);
    setFilter("");
    void loadHoStockCategoryReport(categoryFilter, workspace)
      .then(setReport)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load HO stock."),
      )
      .finally(() => setIsLoading(false));
  }, [categoryFilter, isQcomTenant, qcomCategory, selectedQcomSub, workspace]);

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const source = report?.rows ?? [];
    if (!q) return [...source];
    return source.filter((row) => row.model_name.toLowerCase().includes(q));
  }, [report, filter]);

  const showMarketplaceMetrics = !isQcomTenant;
  const showQcomMetrics = isQcomTenant;
  const showDocMetrics = showMarketplaceMetrics || showQcomMetrics;
  const isLowDoc = (docDays: number | null) =>
    isQcomTenant ? isQcomNetworkDocLow(docDays) : isHoStockLowDoc(docDays);

  const hoStockSortAccessors = useMemo(
    () =>
      ({
        model_name: (row: HoStockCategoryRow) => row.model_name,
        ho_units: (row: HoStockCategoryRow) => row.ho_units,
        gurgaon_units: (row: HoStockCategoryRow) => row.gurgaon_units,
        total_units: (row: HoStockCategoryRow) => row.total_units,
        ...(showMarketplaceMetrics
          ? {
              amazon_drr_units: (row: HoStockCategoryRow) => row.amazon_drr_units,
              flipkart_drr_units: (row: HoStockCategoryRow) => row.flipkart_drr_units,
              doc_days: (row: HoStockCategoryRow) => row.doc_days,
            }
          : {}),
        ...(showQcomMetrics
          ? {
              amazon_drr_units: (row: HoStockCategoryRow) => row.amazon_drr_units,
              flipkart_drr_units: (row: HoStockCategoryRow) => row.flipkart_drr_units,
              qcom_drr_units: (row: HoStockCategoryRow) => row.qcom_drr_units,
              doc_days: (row: HoStockCategoryRow) => row.doc_days,
            }
          : {}),
      }) satisfies import("./table-sort").TableSortAccessors<HoStockCategoryRow>,
    [showMarketplaceMetrics, showQcomMetrics],
  );

  const { sortedRows, sortKey, sortDirection, requestSort } = useTableSort(
    filteredRows,
    hoStockSortAccessors,
    "total_units",
    "desc",
  );

  if (isQcomTenant && !qcomCategory) {
    return (
      <EmptyState
        title="Unknown category"
        description="Choose a qcom category from HO Stock → Category wise."
      />
    );
  }

  if (!isQcomTenant && !categoryFilter) {
    return (
      <EmptyState
        title="Unknown category"
        description="Choose a category from the dropdown or HO Stock hub."
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-1 pb-8 sm:px-2">
      <Link
        to={isQcomTenant ? "/app/qcom/ho-stock" : `${routePrefix}/ho-stock`}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to HO Stock
      </Link>

      <SubCategoryFilterSelect
        value={(categoryFilter ?? "all") as SubCategoryFilter}
        options={isManagerWorkspace ? filterOptions : undefined}
        labels={isManagerWorkspace ? filterLabels : undefined}
        label={isQcomTenant ? "Category" : "Category"}
        onChange={(value) => {
          if (isQcomTenant) return;
          void navigate(`${routePrefix}/ho-stock/category/${encodeURIComponent(value)}`);
        }}
        className={isQcomTenant ? "hidden" : undefined}
      />
      {isQcomTenant ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel>Category</FieldLabel>
            <Select
              value={qcomCategory}
              onChange={(e) => {
                const next = e.target.value;
                void navigate(
                  `${routePrefix}/ho-stock/category/${encodeURIComponent(next)}?sub=all`,
                );
              }}
            >
              <option value="all">All categories</option>
              {qcomCategory &&
              qcomCategory.toLowerCase() !== "all" &&
              !qcomCategories.some(
                (c) => c.category.toLowerCase() === qcomCategory.toLowerCase(),
              ) ? (
                <option value={qcomCategory}>{qcomCategory}</option>
              ) : null}
              {qcomCategories.map((item) => (
                <option key={item.category} value={item.category}>
                  {item.category}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel>Sub-category</FieldLabel>
            <Select
              value={selectedQcomSub}
              onChange={(e) => {
                setSearchParams({ sub: e.target.value }, { replace: true });
              }}
            >
              {qcomSubOptions.map((sub) => (
                <option key={sub} value={sub}>
                  {sub === "all" ? "All" : sub}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-600">HO Stock</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-950 sm:text-4xl">
            {isQcomTenant
              ? isQcomAllCategories
                ? "All categories"
                : qcomCategory
              : categoryLabels[categoryFilter!]}
          </h1>
          <p className="text-sm font-medium text-zinc-600">
            {uploadMeta.label
              ? `As on ${uploadMeta.label}`
              : "No stock report uploaded"}
            {report
              ? ` · ${report.rowCount} listing${report.rowCount === 1 ? "" : "s"}`
              : ""}
            {report && report.eolExcludedCount > 0
              ? ` · ${report.eolExcludedCount} Flipkart EOL hidden`
              : ""}
          </p>
        </div>
        {uploadMeta.snapshotDate ? (
          <div className="shrink-0 rounded-xl border border-sky-200 bg-sky-50/90 px-4 py-2 text-sm font-medium text-sky-950">
            <p className="text-[10px] font-bold uppercase tracking-wide text-sky-700">Stock as on</p>
            <p>{uploadMeta.label}</p>
          </div>
        ) : null}
      </div>

      {showMarketplaceMetrics ? <HoStockDocExplanation /> : null}
      {showQcomMetrics ? <QcomNetworkDocExplanation /> : null}

      {isLoading ? (
        <InlineLoader text="Loading HO stock…" />
      ) : error ? (
        <EmptyState title="Could not load HO stock" description={error} />
      ) : !report?.uploadId ? (
        <EmptyState
          title="No HO stock report"
          description="Upload the consolidated Stock Report from Upload Center (HO stock type)."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="HO Stock (units)" value={formatInteger(report.hoTotal)} />
            <StatCard label="Gurgaon (units)" value={formatInteger(report.gurgaonTotal)} />
            <StatCard label="Total (units)" value={formatInteger(report.stockTotal)} />
          </div>

          <Card className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-zinc-800">
                {sortedRows.length} of {report.rowCount} listings
                {report.snapshotDate
                  ? ` · ${formatCoverageDataAsOf(report.snapshotDate)}`
                  : ""}
              </p>
              <input
                type="search"
                placeholder="Filter by model name…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full max-w-sm rounded-lg border border-zinc-200 px-3 py-2 text-sm sm:w-72"
              />
            </div>
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
                      label="HO Stock"
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
                    {showMarketplaceMetrics ? (
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
                    {showQcomMetrics ? (
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
                  {sortedRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={showMarketplaceMetrics ? 7 : showQcomMetrics ? 8 : 4}
                        className="px-3 py-8 text-center text-zinc-500"
                      >
                        No listings match this filter.
                      </td>
                    </tr>
                  ) : (
                    sortedRows.map((row) => (
                      <tr
                        key={row.row_key}
                        className={cn(
                          showDocMetrics && isLowDoc(row.doc_days)
                            ? "bg-rose-50 hover:bg-rose-100/90"
                            : "hover:bg-sky-50/40",
                        )}
                      >
                        <td className="max-w-md px-3 py-2.5 font-medium text-zinc-900">
                          {row.model_name}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatInteger(row.ho_units)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatInteger(row.gurgaon_units)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-zinc-900">
                          {formatInteger(row.total_units)}
                        </td>
                        {showMarketplaceMetrics ? (
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
                        {showQcomMetrics ? (
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
