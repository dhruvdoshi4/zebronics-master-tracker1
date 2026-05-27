import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useCatalogScope } from "./catalog-scope-context";
import { dashboardListingModelPath } from "./product-channel";
import { format } from "date-fns";
import {
  getRatingsEmptyDiagnostics,
  ratingsRowsMissingCounts,
  type ProductRatingsRow,
  type RatingsEmptyDiagnostics,
  type RatingsSheetFilter,
} from "./data-ratings";
import type { RatingsCellLabels } from "./parsers-ratings";
import type { Marketplace } from "./types";
import { Card, EmptyState } from "./ui";
import { displayModelName } from "./product-display";
import { formatDecimal, formatInteger } from "./utils";

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

function formatRatingsCell(
  value: number | null,
  labelKey: keyof RatingsCellLabels,
  labels: RatingsCellLabels,
  format: (n: number) => string,
): string {
  const text = labels[labelKey];
  if (text) return text;
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return format(n);
}

export function DashboardRatingsPanel({
  marketplace,
  rows,
  isLoading,
  error,
  sheetFilter,
  scopeLabel,
}: {
  marketplace: Marketplace;
  rows: ProductRatingsRow[];
  isLoading: boolean;
  error: string | null;
  sheetFilter: RatingsSheetFilter;
  scopeLabel?: string;
}) {
  const { routePrefix } = useCatalogScope();
  const [emptyDiag, setEmptyDiag] = useState<RatingsEmptyDiagnostics | null>(null);
  const codeLabel = getCodeLabel(marketplace);
  const isAmazon = marketplace === "amazon";

  useEffect(() => {
    if (rows.length > 0) {
      setEmptyDiag(null);
      return;
    }
    if (isLoading || error) return;
    void getRatingsEmptyDiagnostics(marketplace, sheetFilter).then(setEmptyDiag);
  }, [marketplace, sheetFilter, rows.length, isLoading, error]);

  if (error) {
    return <EmptyState title="Unable to load ratings" description={error} />;
  }

  const snapshotLabel = rows[0]?.snapshot_date
    ? format(new Date(`${rows[0].snapshot_date}T12:00:00`), "d MMM yyyy")
    : null;

  const ratedForAvg = rows.filter(
    (r) => r.review_t != null && (r.review_count_t ?? 0) > 0 || (r.review_t ?? 0) > 0,
  );
  const avgReviewT =
    ratedForAvg.length > 0
      ? ratedForAvg.reduce((s, r) => s + (r.review_t ?? 0), 0) / ratedForAvg.length
      : null;

  const flipkartSheetZeros =
    !isAmazon &&
    rows.length > 0 &&
    rows.every((r) => r.review_t == null && r.review_count_t == null);

  const needsReupload = ratingsRowsMissingCounts(rows);

  if (!isLoading && rows.length === 0) {
    const channelLabel = isAmazon ? "Amazon" : "Flipkart";
    const scopeHint =
      sheetFilter.category !== "all"
        ? sheetFilter.sheetSubCategory !== "all"
          ? `${sheetFilter.category} → ${sheetFilter.sheetSubCategory}`
          : sheetFilter.category
        : "Monitor & Acc., Projector & Acc., Cartridge";

    let description = `No ratings rows for ${scopeHint} on ${channelLabel}.`;

    if (emptyDiag?.hasUpload) {
      const parts = [
        `Latest file: ${emptyDiag.fileName ?? "unknown"} (${emptyDiag.snapshotDate ?? "no date"}).`,
        `In database: ${emptyDiag.amazonRowsInDb} Amazon · ${emptyDiag.flipkartRowsInDb} Flipkart SKU rows.`,
        `${channelLabel} in file: ${emptyDiag.channelRowsInDb} → ${emptyDiag.channelActiveAfterRemarks} active (EOL/RFO removed) → ${emptyDiag.channelMatchingSubCategory} match current category filters.`,
      ];
      if (isAmazon && emptyDiag.amazonRowsInDb === 0 && emptyDiag.flipkartRowsInDb > 0) {
        parts.push(
          "Amazon tab was not saved — your last upload likely failed partway or only ingested Flipkart. Re-upload the full workbook from Upload Center and confirm success (no red error).",
        );
      } else if (emptyDiag.channelMatchingSubCategory === 0 && emptyDiag.channelActiveAfterRemarks > 0) {
        parts.push(
          `Active ${channelLabel} rows exist but none match this category / sub category — try Entire category or another sub category.`,
        );
      } else if (emptyDiag.channelRowsInDb === 0) {
        parts.push(
          `No ${channelLabel} rows in the saved upload — re-upload the workbook and check the ${channelLabel} tab parses (see Upload Center message).`,
        );
      } else if (emptyDiag.channelMatchingSubCategory > 0) {
        parts.push(
          `${emptyDiag.channelMatchingSubCategory} rows match in the database but the table did not load — refresh the page.`,
        );
      }
      description = parts.join(" ");
    } else {
      description +=
        " Upload the combined ratings workbook from Upload Center (upload must complete without error).";
    }

    return <EmptyState title="No ratings data" description={description} />;
  }

  return (
    <div className="space-y-4">
      {needsReupload ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Review counts look empty in the database. Go to <strong>Upload Center</strong> and upload
          the ratings workbook again so <strong>Review_Count (Y)</strong> and{" "}
          <strong>Rev. Count (T)</strong> are read from the sheet.
        </div>
      ) : null}
      {flipkartSheetZeros ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          <strong>PC · Monitor / Projector</strong> rows in the Flipkart tab have{" "}
          <strong>Rating = 0</strong> and <strong>RATING_COUNT = 0</strong> (often{" "}
          <strong>F Assured Tag = Not Identified</strong>). Update those cells in{" "}
          <strong>FSN_Ranking&amp;Rating</strong>, then re-upload. Home Audio / IT Accessories in
          the same file do have ratings. <strong>Review Y</strong> stays blank until a second
          upload after <strong>Review T</strong> has real values.
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-indigo-200 bg-indigo-50/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">
            Report date (T)
          </p>
          <p className="mt-1 text-lg font-bold text-indigo-950">{snapshotLabel ?? "—"}</p>
        </Card>
        <Card className="border-indigo-200 bg-indigo-50/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Listings</p>
          <p className="mt-1 text-lg font-bold text-indigo-950">
            {rows.length} active SKU{rows.length === 1 ? "" : "s"}
            {scopeLabel ? ` · ${scopeLabel}` : ""}
          </p>
        </Card>
        <Card className="border-indigo-200 bg-indigo-50/50 p-4 sm:col-span-2 lg:col-span-1">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">
            Avg rating (T)
          </p>
          <p className="mt-1 text-lg font-bold text-indigo-950">
            {avgReviewT != null && Number.isFinite(avgReviewT)
              ? formatDecimal(avgReviewT)
              : "—"}
          </p>
        </Card>
      </div>

      {!isAmazon ? (
        <p className="text-sm text-zinc-600">
          Rows follow <strong>Category</strong> and <strong>Sub category</strong> from the ratings
          sheet (same filters as PO metrics). Flipkart <strong>Y</strong> is from the previous
          upload; <strong>T</strong> from this file.
        </p>
      ) : (
        <p className="text-sm text-zinc-600">
          Rows follow <strong>Category</strong> and <strong>Sub category</strong> from the ratings
          sheet — use <strong>Entire category</strong> for the full roll-up or pick a sub category.
          <strong> Y</strong> / <strong>T</strong> columns match the workbook.
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
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Sub category</th>
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
                <td className="px-3 py-2 font-mono text-xs">
                  <Link
                    to={dashboardListingModelPath(
                      marketplace,
                      row.product_code,
                      routePrefix,
                    )}
                    className="text-violet-700 underline-offset-2 hover:text-violet-900 hover:underline"
                    title="Open model in Product Lookup"
                  >
                    {row.product_code}
                  </Link>
                </td>
                <td className="max-w-xs px-3 py-2 font-medium">
                  {displayModelName(row.model_name, row.product_code)}
                </td>
                <td className="px-3 py-2">{row.category || "—"}</td>
                <td className="px-3 py-2">{row.sub_category || "—"}</td>
                <td className="px-3 py-2 tabular-nums">
                  {formatRatingsCell(
                    row.review_y,
                    "review_y",
                    row.cell_labels,
                    formatDecimal,
                  )}
                </td>
                {isAmazon ? (
                  <td className="px-3 py-2 tabular-nums">
                    {formatRatingsCell(row.rank_y, "rank_y", row.cell_labels, formatInteger)}
                  </td>
                ) : null}
                <td className="px-3 py-2 tabular-nums">
                  {formatRatingsCell(
                    row.review_count_y,
                    "review_count_y",
                    row.cell_labels,
                    formatInteger,
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatRatingsCell(
                    row.review_t,
                    "review_t",
                    row.cell_labels,
                    formatDecimal,
                  )}
                </td>
                {isAmazon ? (
                  <td className="px-3 py-2 tabular-nums">
                    {formatRatingsCell(row.rank_t, "rank_t", row.cell_labels, formatInteger)}
                  </td>
                ) : null}
                <td className="px-3 py-2 tabular-nums">
                  {formatRatingsCell(
                    row.review_count_t,
                    "review_count_t",
                    row.cell_labels,
                    formatInteger,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
