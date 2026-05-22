import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  ImageIcon,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { format } from "date-fns";
import { getProductSelloutHistory } from "./data";
import { displayModelName } from "./product-display";
import {
  type ComputedMetric,
  type Marketplace,
  type ProductMaster,
  getSubCategoryLabel,
} from "./types";
import {
  Card,
  EmptyState,
  InlineLoader,
  Logo,
  SortableTableHeader,
  StatCard,
} from "./ui";
import { useTableSort } from "./table-sort";
import { formatDecimal, formatInteger } from "./utils";

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

function formatAsOfLabel(value: string): string {
  try {
    return format(new Date(`${value}T00:00:00`), "dd MMM");
  } catch {
    return value;
  }
}

export function SelloutReportPage() {
  const params = useParams<{ marketplace: string; code: string }>();
  const marketplace = (params.marketplace as Marketplace) ?? "amazon";
  const productCode = (params.code ?? "").toUpperCase();

  const [product, setProduct] = useState<ProductMaster | null>(null);
  const [history, setHistory] = useState<ComputedMetric[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void getProductSelloutHistory(marketplace, productCode)
      .then((data) => {
        setProduct(data.product);
        setHistory(data.history);
      })
      .catch((e: unknown) =>
        setError(
          e instanceof Error
            ? e.message
            : "Failed to load sellout history.",
        ),
      )
      .finally(() => setIsLoading(false));
  }, [marketplace, productCode]);

  const codeLabel = getCodeLabel(marketplace);
  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => a.as_of_date.localeCompare(b.as_of_date)),
    [history],
  );

  const selloutSortAccessors = useMemo(
    () =>
      ({
        as_of_date: (row: ComputedMetric) => row.as_of_date,
        inventory_units: (row: ComputedMetric) => row.inventory_units,
        total_so_units: (row: ComputedMetric) => row.total_so_units,
        may_mtd_units: (row: ComputedMetric) => row.may_mtd_units,
        apr_so_units: (row: ComputedMetric) => row.apr_so_units,
        drr_units: (row: ComputedMetric) => row.drr_units,
        doc_days: (row: ComputedMetric) => row.doc_days,
        purchase_order_units: (row: ComputedMetric) => row.purchase_order_units,
      }) satisfies import("./table-sort").TableSortAccessors<ComputedMetric>,
    [],
  );

  const { sortedRows: sortedHistoryRows, sortKey, sortDirection, requestSort } =
    useTableSort(sortedHistory, selloutSortAccessors, "as_of_date", "desc");

  const summary = useMemo(() => {
    if (sortedHistory.length === 0) return null;
    const latest = sortedHistory[sortedHistory.length - 1];
    const earliest = sortedHistory[0];
    const totalSoDelta = latest.total_so_units - earliest.total_so_units;
    return {
      latest,
      earliest,
      snapshotCount: sortedHistory.length,
      totalSoDelta,
    };
  }, [sortedHistory]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to="/app/asin"
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Lookup
        </Link>
      </div>

      <Card className="border-2 border-violet-200 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 dark:border-violet-900/60 dark:from-violet-950/40 dark:via-zinc-900 dark:to-fuchsia-950/30">
        <div className="flex items-start gap-4">
          <Logo size={56} className="ring-1 ring-violet-200 dark:ring-violet-900/60" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TrendingUp className="h-4 w-4 text-violet-600 dark:text-violet-300" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
                Historical Sellout Report
              </p>
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {displayModelName(product?.product_name, productCode)}
            </h1>
            <p className="mt-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Upload snapshots for this {codeLabel} on {marketplace === "amazon" ? "Amazon" : "Flipkart"}.
            </p>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <InlineLoader text="Loading sellout history..." />
      ) : error ? (
        <EmptyState title="Could not load report" description={error} />
      ) : sortedHistory.length === 0 ? (
        <EmptyState
          title="No history found"
          description={`No snapshots for ${productCode}. Confirm it appears in a recent upload.`}
        />
      ) : (
        <>
          <Card className="grid gap-5 md:grid-cols-[180px_1fr]">
            <div className="flex h-44 w-44 items-center justify-center overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-50 to-zinc-100 text-zinc-400 dark:border-zinc-700 dark:from-zinc-900 dark:to-zinc-950">
              {product?.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.product_name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-1 text-xs">
                  <ImageIcon className="h-6 w-6" />
                  No Image
                </div>
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                  {codeLabel}
                </span>
                <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
                  {productCode}
                </span>
                {product?.sub_category ? (
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                    {getSubCategoryLabel(product.sub_category)}
                  </span>
                ) : null}
              </div>
              <h2 className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                {displayModelName(product?.product_name, productCode)}
              </h2>

              {summary ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <StatCard
                    label="Latest Total SO"
                    value={formatInteger(summary.latest.total_so_units)}
                    variant="emerald"
                    hint={`As of ${formatAsOfLabel(summary.latest.as_of_date)}`}
                  />
                  <StatCard
                    label="Sell-out Since First Upload"
                    value={`+ ${formatInteger(summary.totalSoDelta)}`}
                    variant="violet"
                    hint={`From ${formatAsOfLabel(summary.earliest.as_of_date)} \u2192 ${formatAsOfLabel(summary.latest.as_of_date)}`}
                  />
                  <StatCard
                    label="Latest PO"
                    value={formatInteger(summary.latest.purchase_order_units)}
                    variant="amber"
                    hint={`DRR ${formatDecimal(summary.latest.drr_units)} / day`}
                  />
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="relative overflow-hidden border-2 border-dashed border-violet-200 bg-gradient-to-br from-violet-50/80 via-white to-fuchsia-50/60 dark:border-violet-900/60 dark:from-violet-950/30 dark:via-zinc-900 dark:to-fuchsia-950/20">
            <div className="absolute right-4 top-4 hidden text-violet-200 md:block dark:text-violet-900/60">
              <Sparkles className="h-20 w-20" />
            </div>
            <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
                  <Clock className="h-5 w-5" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                      Daily &amp; Monthly Sellout Trends
                    </h3>
                    <span className="rounded-full bg-violet-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
                      Coming Soon
                    </span>
                  </div>
                  <p className="mt-1 max-w-xl text-sm font-medium text-zinc-500 dark:text-zinc-400">
                    Daily and monthly charts coming soon. Snapshot timeline below.
                  </p>
                </div>
              </div>
            </div>
          </Card>

          <Card className="overflow-auto">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <CalendarDays className="h-5 w-5 text-zinc-500" />
              <h3 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                Snapshot History
              </h3>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {sortedHistory.length} snapshots
              </span>
            </div>
            <table className="min-w-full divide-y divide-zinc-200 text-sm font-medium text-zinc-800 dark:divide-zinc-800 dark:text-zinc-200">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                  <SortableTableHeader
                    label="As of"
                    sortKey="as_of_date"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                  />
                  <SortableTableHeader
                    label="Inventory"
                    sortKey="inventory_units"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                  />
                  <SortableTableHeader
                    label="Total SO"
                    sortKey="total_so_units"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                  />
                  <SortableTableHeader
                    label="May MTD"
                    sortKey="may_mtd_units"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                  />
                  <SortableTableHeader
                    label="Apr SO"
                    sortKey="apr_so_units"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                  />
                  <SortableTableHeader
                    label="DRR"
                    sortKey="drr_units"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                  />
                  <SortableTableHeader
                    label="DOC"
                    sortKey="doc_days"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                  />
                  <SortableTableHeader
                    label="PO"
                    sortKey="purchase_order_units"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {sortedHistoryRows.map((row) => (
                  <tr
                    key={row.as_of_date}
                    className="hover:bg-violet-50/60 dark:hover:bg-violet-950/20"
                  >
                    <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                      {format(
                        new Date(`${row.as_of_date}T00:00:00`),
                        "dd MMM yyyy",
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {formatInteger(row.inventory_units)}
                    </td>
                    <td className="px-3 py-2">
                      {formatInteger(row.total_so_units)}
                    </td>
                    <td className="px-3 py-2">
                      {formatInteger(row.may_mtd_units)}
                    </td>
                    <td className="px-3 py-2">
                      {formatInteger(row.apr_so_units)}
                    </td>
                    <td className="px-3 py-2">
                      {formatDecimal(row.drr_units)}
                    </td>
                    <td className="px-3 py-2">
                      {formatDecimal(row.doc_days)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.purchase_order_units > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-400/40 dark:text-amber-200 dark:ring-amber-500/40">
                          {formatInteger(row.purchase_order_units)}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400 dark:text-zinc-600">
                          &mdash;
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
