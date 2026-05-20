import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardRatingsPanel } from "./dashboard-ratings-panel";
import { getLatestRatingsUploadMeta } from "./data-ratings";
import {
  getDashboardRecords,
  productMatchesAnyCoreSelloutCategory,
  productMatchesCategoryRollup,
  sumSelloutOnMostRecentSheetDate,
  type LatestSheetColumnSelloutSummary,
} from "./data";
import {
  type DashboardRecord,
  type Marketplace,
  type SubCategoryFilter,
  SUB_CATEGORY_FILTER_LABELS,
} from "./types";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_LEGEND_STYLE } from "./chart-theme";
import {
  Card,
  ChartTooltip,
  DataAsOnRangeBadge,
  EmptyState,
  InlineLoader,
  PageTitle,
  SortableTableHeader,
  StatCard,
  SubCategoryFilterSelect,
} from "./ui";
import { useTableSort } from "./table-sort";
import { chartAxisModelLabel, displayModelName } from "./product-display";
import {
  cn,
  formatCoverageDataAsOf,
  formatDecimal,
  formatInteger,
  sheetCoverageMinMax,
} from "./utils";

function formatSheetColumnDateLabel(saleDate: string): string {
  if (/-\d{2}-01$/.test(saleDate)) {
    const d = new Date(`${saleDate}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
    }
  }
  return formatCoverageDataAsOf(saleDate);
}

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

type DashboardView = "po" | "ratings";

export function DashboardPage({ marketplace }: { marketplace: Marketplace }) {
  const [view, setView] = useState<DashboardView>("po");
  const [records, setRecords] = useState<DashboardRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subCategory, setSubCategory] = useState<SubCategoryFilter>("monitor");
  const [ratingsMeta, setRatingsMeta] = useState<{
    snapshotDate: string | null;
    fileName: string | null;
  }>({ snapshotDate: null, fileName: null });
  const [latestColumnSellout, setLatestColumnSellout] =
    useState<LatestSheetColumnSelloutSummary>({ saleDate: null, totalUnits: 0 });

  useEffect(() => {
    void getLatestRatingsUploadMeta().then(setRatingsMeta);
  }, []);

  useEffect(() => {
    if (view !== "po") return;
    setIsLoading(true);
    setError(null);

    getDashboardRecords(marketplace)
      .then((dashboardRows) => {
        setRecords(dashboardRows);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load dashboard.");
      })
      .finally(() => setIsLoading(false));
  }, [marketplace, view]);

  const filteredRecords = useMemo(
    () =>
      records.filter((record) => {
        if (subCategory === "all") {
          return productMatchesAnyCoreSelloutCategory({
            category: record.category,
            sub_category: record.sub_category,
            product_name: record.product_name,
          });
        }
        return productMatchesCategoryRollup(subCategory, {
          category: record.category,
          sub_category: record.sub_category,
          product_name: record.product_name,
        });
      }),
    [records, subCategory],
  );

  const kpis = useMemo(() => {
    const totalPo = filteredRecords.reduce(
      (acc, row) => acc + row.purchase_order_units,
      0,
    );
    return { totalPo };
  }, [filteredRecords]);

  useEffect(() => {
    if (view !== "po" || filteredRecords.length === 0) {
      setLatestColumnSellout({ saleDate: null, totalUnits: 0 });
      return;
    }
    void sumSelloutOnMostRecentSheetDate(
      marketplace,
      filteredRecords.map((row) => row.product_code),
    )
      .then(setLatestColumnSellout)
      .catch(() => setLatestColumnSellout({ saleDate: null, totalUnits: 0 }));
  }, [marketplace, filteredRecords, view]);

  const dashboardCoverage = useMemo(
    () => sheetCoverageMinMax(filteredRecords),
    [filteredRecords],
  );

  const codeLabel = getCodeLabel(marketplace);

  const dashboardSortAccessors = useMemo(
    () =>
      ({
        product_code: (row: DashboardRecord) => row.product_code,
        model: (row: DashboardRecord) => displayModelName(row.product_name, row.product_code),
        inventory_units: (row: DashboardRecord) => row.inventory_units,
        total_so_units: (row: DashboardRecord) => row.total_so_units,
        may_mtd_units: (row: DashboardRecord) => row.may_mtd_units,
        apr_so_units: (row: DashboardRecord) => row.apr_so_units,
        drr_units: (row: DashboardRecord) => row.drr_units,
        doc_days: (row: DashboardRecord) => row.doc_days,
        purchase_order_units: (row: DashboardRecord) => row.purchase_order_units,
      }) satisfies import("./table-sort").TableSortAccessors<DashboardRecord>,
    [],
  );

  const { sortedRows: sortedTableRows, sortKey, sortDirection, requestSort } = useTableSort(
    filteredRecords,
    dashboardSortAccessors,
    "purchase_order_units",
    "desc",
  );

  const topPo = filteredRecords
    .filter((row) => row.purchase_order_units > 0)
    .slice(0, 10)
    .map((row) => ({
      code: row.product_code,
      model: displayModelName(row.product_name, row.product_code),
      axisLabel: chartAxisModelLabel(row.product_name, row.product_code),
      po: row.purchase_order_units,
    }));

  const inventoryVsTarget = filteredRecords.slice(0, 10).map((row) => ({
    code: row.product_code,
    model: displayModelName(row.product_name, row.product_code),
    inventory: row.inventory_units,
    target: Number((row.drr_units * 45).toFixed(2)),
  }));

  const channelName = marketplace === "amazon" ? "Amazon" : "Flipkart";
  const poLoading = view === "po" && isLoading;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title={`${channelName} Dashboard`}
            subtitle={
              view === "po"
                ? `${SUB_CATEGORY_FILTER_LABELS[subCategory]}. Inventory, sellout and PO from the latest sellout upload.`
                : `${SUB_CATEGORY_FILTER_LABELS[subCategory]}. Ratings & BSR from the latest rankings upload.`
            }
          />
        </div>
        {view === "po" && dashboardCoverage.min && dashboardCoverage.max ? (
          <DataAsOnRangeBadge
            min={dashboardCoverage.min}
            max={dashboardCoverage.max}
            scopeLabel={SUB_CATEGORY_FILTER_LABELS[subCategory]}
          />
        ) : view === "ratings" && ratingsMeta.snapshotDate ? (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/90 px-4 py-2 text-sm font-medium text-indigo-950">
            <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-700">
              Ratings as on
            </p>
            <p>
              {new Date(`${ratingsMeta.snapshotDate}T12:00:00`).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <SubCategoryFilterSelect value={subCategory} onChange={setSubCategory} />
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setView("po")}
            className={cn(
              "rounded px-3 py-1.5 text-xs font-bold transition",
              view === "po"
                ? "bg-violet-600 text-white shadow-sm"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300",
            )}
          >
            PO metrics
          </button>
          <button
            type="button"
            onClick={() => setView("ratings")}
            className={cn(
              "rounded px-3 py-1.5 text-xs font-bold transition",
              view === "ratings"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300",
            )}
          >
            Ratings &amp; reviews
          </button>
        </div>
        {view === "po" ? (
          <span className="rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {filteredRecords.length} SKU
            {filteredRecords.length === 1 ? "" : "s"} in view
          </span>
        ) : null}
      </div>

      {view === "ratings" ? (
        <DashboardRatingsPanel marketplace={marketplace} subCategory={subCategory} />
      ) : poLoading ? (
        <InlineLoader text={`Loading ${marketplace} dashboard...`} />
      ) : error ? (
        <EmptyState title="Unable to load dashboard" description={error} />
      ) : (
        <>
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Total Purchase Order"
          value={formatInteger(kpis.totalPo)}
          variant="amber"
          hint="Suggested PO units"
        />
        <StatCard
          label="Sell out (latest date column)"
          value={formatInteger(latestColumnSellout.totalUnits)}
          variant="emerald"
          hint={
            latestColumnSellout.saleDate
              ? `Sum of the ${formatSheetColumnDateLabel(latestColumnSellout.saleDate)} column across SKUs in view. Re-upload the channel sheet if this shows 0.`
              : "No date sellout column stored for SKUs in this view — re-upload the sellout master."
          }
        />
      </div>

      {filteredRecords.length === 0 ? (
        <EmptyState
          title="No data yet"
          description={`No SKUs in this view. Upload a ${marketplace} sheet from Upload Center.`}
        />
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <div className="mb-4 flex items-center justify-between gap-2">
                <h3 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Top Purchase Orders
                </h3>
                <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                  Action Items
                </span>
              </div>
              <div
                className="w-full"
                style={{ height: Math.max(288, topPo.length * 36) }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={topPo}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={CHART_GRID_STROKE}
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tick={CHART_AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="axisLabel"
                      tick={CHART_AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      width={148}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(245,158,11,0.12)" }}
                      content={
                        <ChartTooltip
                          formatValue={(value) =>
                            `${formatInteger(Number(value ?? 0))} units`
                          }
                          labelPrefix="Model"
                          labelKey="model"
                        />
                      }
                    />
                    <Bar
                      dataKey="po"
                      name="Purchase Order"
                      radius={[0, 6, 6, 0]}
                      barSize={22}
                    >
                      {topPo.map((entry, index) => (
                        <Cell
                          key={entry.code}
                          fill={index === 0 ? "#d97706" : "#f59e0b"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <div className="mb-4 flex items-center justify-between gap-2">
                <h3 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Inventory vs Target Stock
                </h3>
                <span className="rounded-full bg-sky-100 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
                  DRR × 45 days
                </span>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={inventoryVsTarget}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={CHART_GRID_STROKE}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="code"
                      tick={CHART_AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      hide
                    />
                    <YAxis
                      tick={CHART_AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(14,165,233,0.12)" }}
                      content={
                        <ChartTooltip
                          formatValue={(value) =>
                            `${formatInteger(Number(value ?? 0))} units`
                          }
                          labelPrefix="Model"
                          labelKey="model"
                        />
                      }
                    />
                    <Legend iconType="circle" wrapperStyle={CHART_LEGEND_STYLE} />
                    <Bar
                      dataKey="inventory"
                      name="Current Inventory"
                      fill="#0ea5e9"
                      radius={[6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="target"
                      name="Target Stock"
                      fill="#10b981"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card className="overflow-auto">
            <h3 className="mb-4 text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              SKU Metrics
            </h3>
            <table className="min-w-full divide-y divide-zinc-200 text-sm font-medium text-zinc-800 dark:divide-zinc-800 dark:text-zinc-200">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                  <SortableTableHeader
                    label={codeLabel}
                    sortKey="product_code"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                  />
                  <SortableTableHeader
                    label="Model"
                    sortKey="model"
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
                {sortedTableRows.map((row) => (
                  <tr
                    key={row.product_code}
                    className="hover:bg-violet-50/60 dark:hover:bg-violet-950/20"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                      {row.product_code}
                    </td>
                    <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                      {displayModelName(row.product_name, row.product_code)}
                    </td>
                    <td className="px-3 py-2">{formatInteger(row.inventory_units)}</td>
                    <td className="px-3 py-2">{formatInteger(row.total_so_units)}</td>
                    <td className="px-3 py-2">{formatInteger(row.may_mtd_units)}</td>
                    <td className="px-3 py-2">{formatInteger(row.apr_so_units)}</td>
                    <td className="px-3 py-2">{formatDecimal(row.drr_units)}</td>
                    <td className="px-3 py-2">{formatDecimal(row.doc_days)}</td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ring-1",
                          row.purchase_order_units > 0
                            ? "bg-amber-500/15 text-amber-700 ring-amber-400/40 dark:text-amber-200 dark:ring-amber-500/40"
                            : "bg-zinc-100 text-zinc-600 ring-zinc-300/70 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
                        )}
                      >
                        {formatInteger(row.purchase_order_units)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
        </>
      )}
    </div>
  );
}
