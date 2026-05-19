import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { loadHoStockCategoryReport, type HoStockCategorySummary } from "./data-ho-stock";
import {
  SUB_CATEGORY_LABELS,
  TRACKED_SUB_CATEGORIES,
  type SubCategory,
} from "./types";
import {
  Card,
  EmptyState,
  FieldLabel,
  InlineLoader,
  Select,
  StatCard,
} from "./ui";
import { useHoStockUploadMeta } from "./use-ho-stock-upload";
import { formatCoverageDataAsOf, formatInteger } from "./utils";

export function HoStockCategoryDetailPage() {
  const navigate = useNavigate();
  const params = useParams<{ subCategory: string }>();
  const decodedSub =
    params.subCategory != null ? decodeURIComponent(params.subCategory) : "";
  const subCategory = TRACKED_SUB_CATEGORIES.includes(decodedSub as SubCategory)
    ? (decodedSub as SubCategory)
    : null;

  const uploadMeta = useHoStockUploadMeta();
  const [report, setReport] = useState<HoStockCategorySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!subCategory) return;
    setIsLoading(true);
    setError(null);
    setReport(null);
    void loadHoStockCategoryReport(subCategory)
      .then(setReport)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load HO stock."),
      )
      .finally(() => setIsLoading(false));
  }, [subCategory]);

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!report || !q) return report?.rows ?? [];
    return report.rows.filter((row) => row.model_name.toLowerCase().includes(q));
  }, [report, filter]);

  if (!subCategory) {
    return (
      <EmptyState
        title="Unknown category"
        description="Pick a category from the HO Stock hub."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/app/ho-stock/category"
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to categories
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-600">HO Stock</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-950">
            {SUB_CATEGORY_LABELS[subCategory]}
          </h1>
          <p className="text-sm text-zinc-600">
            {uploadMeta.label
              ? `As on ${uploadMeta.label}`
              : "No stock report uploaded"}
            {report ? ` · ${report.rowCount} matched listing${report.rowCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="w-full max-w-xs">
          <FieldLabel>Category</FieldLabel>
          <Select
            value={subCategory}
            onChange={(event) => {
              const next = event.target.value as SubCategory;
              void navigate(`/app/ho-stock/category/${encodeURIComponent(next)}`);
            }}
          >
            {TRACKED_SUB_CATEGORIES.map((key) => (
              <option key={key} value={key}>
                {SUB_CATEGORY_LABELS[key]}
              </option>
            ))}
          </Select>
        </div>
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
                {filteredRows.length} of {report.rowCount} listings
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
                    <th className="px-3 py-2.5">Model</th>
                    <th className="px-3 py-2.5 text-right">HO Stock</th>
                    <th className="px-3 py-2.5 text-right">Gurgaon</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-zinc-500">
                        No listings match this filter.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <tr key={`${row.asin}:${row.fsn}:${row.model_name}`} className="hover:bg-sky-50/40">
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
