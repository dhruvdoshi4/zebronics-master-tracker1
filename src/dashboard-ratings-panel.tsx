import { useEffect, useState } from "react";
import { format } from "date-fns";
import { loadRatingsDashboardRows, type ProductRatingsRow } from "./data-ratings";
import type { Marketplace, SubCategoryFilter } from "./types";
import { SUB_CATEGORY_FILTER_LABELS } from "./types";
import { Card, EmptyState, InlineLoader } from "./ui";
import { displayModelName } from "./product-display";
import { formatDecimal, formatInteger } from "./utils";

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

function formatRating(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return formatDecimal(value);
}

function formatCount(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return formatInteger(value);
}

function formatRank(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return formatInteger(value);
}

export function DashboardRatingsPanel({
  marketplace,
  subCategory,
}: {
  marketplace: Marketplace;
  subCategory: SubCategoryFilter;
}) {
  const [rows, setRows] = useState<ProductRatingsRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const codeLabel = getCodeLabel(marketplace);
  const isAmazon = marketplace === "amazon";

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void loadRatingsDashboardRows(marketplace, subCategory)
      .then(setRows)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load ratings."),
      )
      .finally(() => setIsLoading(false));
  }, [marketplace, subCategory]);

  if (isLoading) {
    return <InlineLoader text="Loading ratings & reviews…" />;
  }

  if (error) {
    return <EmptyState title="Unable to load ratings" description={error} />;
  }

  const snapshotLabel = rows[0]?.snapshot_date
    ? format(new Date(`${rows[0].snapshot_date}T12:00:00`), "d MMM yyyy")
    : null;

  const avgReviewT =
    rows.length > 0
      ? rows.reduce((s, r) => s + (r.review_t ?? 0), 0) /
        rows.filter((r) => r.review_t != null).length
      : null;

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No ratings data"
        description={`Upload a Ratings & ranking workbook from Upload Center (Amazon + Flipkart tabs). ${SUB_CATEGORY_FILTER_LABELS[subCategory]} has no active listings in the latest file.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-indigo-200 bg-indigo-50/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">
            Report date (T)
          </p>
          <p className="mt-1 text-lg font-bold text-indigo-950">{snapshotLabel ?? "—"}</p>
        </Card>
        <Card className="border-indigo-200 bg-indigo-50/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Listings</p>
          <p className="mt-1 text-lg font-bold text-indigo-950">{rows.length} active SKUs</p>
        </Card>
        <Card className="border-indigo-200 bg-indigo-50/50 p-4 sm:col-span-2 lg:col-span-1">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">
            Avg rating (T)
          </p>
          <p className="mt-1 text-lg font-bold text-indigo-950">
            {avgReviewT != null && Number.isFinite(avgReviewT) ? formatRating(avgReviewT) : "—"}
          </p>
        </Card>
      </div>

      {!isAmazon ? (
        <p className="text-sm text-zinc-600">
          Flipkart <strong>Y</strong> columns are from the previous ratings upload;{" "}
          <strong>T</strong> is from this file. Rank is Amazon-only in the master sheet.
        </p>
      ) : (
        <p className="text-sm text-zinc-600">
          <strong>Y</strong> = prior snapshot from sheet · <strong>T</strong> = today (report date in
          file name).
        </p>
      )}

      <Card className="overflow-auto">
        <h3 className="mb-4 text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Ratings &amp; reviews
        </h3>
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead>
            <tr className="text-left text-xs font-bold uppercase tracking-wide text-zinc-600">
              <th className="px-3 py-2">{codeLabel}</th>
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2">Review Y</th>
              {isAmazon ? <th className="px-3 py-2">Rank Y</th> : null}
              <th className="px-3 py-2">Review count Y</th>
              <th className="px-3 py-2">Review T</th>
              {isAmazon ? <th className="px-3 py-2">Rank T</th> : null}
              <th className="px-3 py-2">Review count T</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {rows.map((row) => (
              <tr key={row.product_code} className="hover:bg-indigo-50/50">
                <td className="px-3 py-2 font-mono text-xs">{row.product_code}</td>
                <td className="max-w-xs px-3 py-2 font-medium">
                  {displayModelName(row.model_name, row.product_code)}
                </td>
                <td className="px-3 py-2 tabular-nums">{formatRating(row.review_y)}</td>
                {isAmazon ? (
                  <td className="px-3 py-2 tabular-nums">{formatRank(row.rank_y)}</td>
                ) : null}
                <td className="px-3 py-2 tabular-nums">{formatCount(row.review_count_y)}</td>
                <td className="px-3 py-2 tabular-nums">{formatRating(row.review_t)}</td>
                {isAmazon ? (
                  <td className="px-3 py-2 tabular-nums">{formatRank(row.rank_t)}</td>
                ) : null}
                <td className="px-3 py-2 tabular-nums">{formatCount(row.review_count_t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
