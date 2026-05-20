import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  loadHoStockCategoryReport,
  type HoStockCategoryRow,
  type HoStockCategorySummary,
} from "./data-ho-stock";
import { parseSubCategoryFilterParam, SUB_CATEGORY_FILTER_LABELS } from "./types";
import { useTableSort } from "./table-sort";
import {
  Card,
  EmptyState,
  InlineLoader,
  SortableTableHeader,
  StatCard,
  SubCategoryFilterSelect,
} from "./ui";
import { useHoStockUploadMeta } from "./use-ho-stock-upload";
import {
  cn,
  formatCoverageDataAsOf,
  formatHoStockChannelDrr,
  formatHoStockDocDays,
  formatInteger,
  isHoStockLowDoc,
} from "./utils";

export function HoStockCategoryDetailPage() {
  const navigate = useNavigate();
  const params = useParams<{ subCategory: string }>();
  const decodedSub =
    params.subCategory != null ? decodeURIComponent(params.subCategory) : "";
  const categoryFilter = parseSubCategoryFilterParam(decodedSub);

  const uploadMeta = useHoStockUploadMeta();
  const [report, setReport] = useState<HoStockCategorySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!categoryFilter) return;
    setIsLoading(true);
    setError(null);
    setReport(null);
    setFilter("");
    void loadHoStockCategoryReport(categoryFilter)
      .then(setReport)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load HO stock."),
      )
      .finally(() => setIsLoading(false));
  }, [categoryFilter]);

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const source = report?.rows ?? [];
    if (!q) return [...source];
    return source.filter((row) => row.model_name.toLowerCase().includes(q));
  }, [report, filter]);

  const hoStockSortAccessors = useMemo(
    () =>
      ({
        model_name: (row: HoStockCategoryRow) => row.model_name,
        ho_units: (row: HoStockCategoryRow) => row.ho_units,
        gurgaon_units: (row: HoStockCategoryRow) => row.gurgaon_units,
        total_units: (row: HoStockCategoryRow) => row.total_units,
        amazon_drr_units: (row: HoStockCategoryRow) => row.amazon_drr_units,
        flipkart_drr_units: (row: HoStockCategoryRow) => row.flipkart_drr_units,
        doc_days: (row: HoStockCategoryRow) => row.doc_days,
      }) satisfies import("./table-sort").TableSortAccessors<HoStockCategoryRow>,
    [],
  );

  const { sortedRows, sortKey, sortDirection, requestSort } = useTableSort(
    filteredRows,
    hoStockSortAccessors,
    "doc_days",
    "desc",
  );

  if (!categoryFilter) {
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
        to="/app/ho-stock"
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to HO Stock
      </Link>

      <SubCategoryFilterSelect
        value={categoryFilter}
        label="Category"
        onChange={(value) => {
          void navigate(`/app/ho-stock/category/${encodeURIComponent(value)}`);
        }}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-600">HO Stock</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-950 sm:text-4xl">
            {SUB_CATEGORY_FILTER_LABELS[categoryFilter]}
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {sortedRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-zinc-500">
                        No listings match this filter.
                      </td>
                    </tr>
                  ) : (
                    sortedRows.map((row) => (
                      <tr
                        key={row.row_key}
                        className={cn(
                          isHoStockLowDoc(row.doc_days)
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
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatHoStockChannelDrr(row.amazon_drr_units, Boolean(row.asin))}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatHoStockChannelDrr(row.flipkart_drr_units, Boolean(row.fsn))}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right tabular-nums font-semibold",
                            isHoStockLowDoc(row.doc_days) && "text-rose-800",
                          )}
                        >
                          {formatHoStockDocDays(row.doc_days)}
                        </td>
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
