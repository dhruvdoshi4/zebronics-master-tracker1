import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  getRatingsEmptyDiagnostics,
  loadRatingsDashboardRows,
  ratingsRowsMissingCounts,
  type ProductRatingsRow,
  type RatingsEmptyDiagnostics,
} from "./data-ratings";
import type { RatingsCellLabels } from "./parsers-ratings";
import type { Marketplace, SubCategoryFilter } from "./types";
import { SUB_CATEGORY_FILTER_LABELS } from "./types";
import { Card, EmptyState, InlineLoader } from "./ui";
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
  subCategory,
}: {
  marketplace: Marketplace;
  subCategory: SubCategoryFilter;
}) {
  const [rows, setRows] = useState<ProductRatingsRow[]>([]);
  const [emptyDiag, setEmptyDiag] = useState<RatingsEmptyDiagnostics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const codeLabel = getCodeLabel(marketplace);
  const isAmazon = marketplace === "amazon";

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void loadRatingsDashboardRows(marketplace, subCategory)
      .then(async (loaded) => {
        setRows(loaded);
        if (loaded.length === 0) {
          setEmptyDiag(await getRatingsEmptyDiagnostics(marketplace, subCategory));
        } else {
          setEmptyDiag(null);
        }
      })
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

  if (rows.length === 0) {
    const channelLabel = isAmazon ? "Amazon" : "Flipkart";
    let description = `No ${SUB_CATEGORY_FILTER_LABELS[subCategory]} rows to show for ${channelLabel}.`;

    if (emptyDiag?.hasUpload) {
      const parts = [
        `Latest file: ${emptyDiag.fileName ?? "unknown"} (${emptyDiag.snapshotDate ?? "no date"}).`,
        `In database: ${emptyDiag.amazonRowsInDb} Amazon · ${emptyDiag.flipkartRowsInDb} Flipkart SKU rows.`,
        `${channelLabel} in file: ${emptyDiag.channelRowsInDb} → ${emptyDiag.channelActiveAfterRemarks} active (EOL/RFO removed) → ${emptyDiag.channelMatchingSubCategory} match ${SUB_CATEGORY_FILTER_LABELS[subCategory]}.`,
      ];
      if (isAmazon && emptyDiag.amazonRowsInDb === 0 && emptyDiag.flipkartRowsInDb > 0) {
        parts.push(
          "Amazon tab was not saved — your last upload likely failed partway or only ingested Flipkart. Re-upload the full workbook from Upload Center and confirm success (no red error).",
        );
      } else if (emptyDiag.channelMatchingSubCategory === 0 && emptyDiag.channelActiveAfterRemarks > 0) {
        parts.push(
          `Active ${channelLabel} rows exist but none match this sub-category filter — try All or another category.`,
        );
      } else if (emptyDiag.channelRowsInDb === 0) {
        parts.push(
          `No ${channelLabel} rows in the saved upload — re-upload the workbook and check the ${channelLabel} tab parses (see Upload Center message).`,
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
          The Flipkart tab in your master file has <strong>0</strong> in <strong>Rating</strong> and{" "}
          <strong>RATING_COUNT</strong> for these SKUs (not filled in Excel yet). Other categories
          in the same file may still have ratings — monitors/projectors here will show{" "}
          <strong>—</strong> until the sheet is updated.
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
          <p className="mt-1 text-lg font-bold text-indigo-950">{rows.length} active SKUs</p>
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
          Rows follow <strong>Category / Sub Category</strong> from the ratings sheet. Flipkart{" "}
          <strong>Y</strong> is from the previous upload; <strong>T</strong> from this file.
        </p>
      ) : (
        <p className="text-sm text-zinc-600">
          Rows follow <strong>Category / Sub Category</strong> from the ratings sheet (e.g. Projector
          &amp; Acc. → Projectors). <strong>Y</strong> / <strong>T</strong> columns match the
          workbook.
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
