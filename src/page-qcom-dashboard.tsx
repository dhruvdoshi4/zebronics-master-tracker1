import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CategorySubCategoryFilterControls } from "./category-subcategory-filter-controls";
import {
  DimensionCycleTableHeader,
  useCategorySubCategoryCycle,
} from "./category-subcategory-cycle";
import {
  getDashboardRecords,
  sumSelloutOnMostRecentSheetDate,
  type LatestSheetColumnSelloutSummary,
} from "./data";
import { marketplaceLabel, productCodeLabel } from "./marketplace-labels";
import { qcomProductLandingPath } from "./qcom-paths";
import {
  QCOM_CHANNEL_LABELS,
  qcomWorkspaceMarketplace,
  type QcomWorkspaceKey,
  type QuickCommerceChannel,
} from "./tenants";
import type { DashboardRecord } from "./types";
import {
  Card,
  DataAsOnRangeBadge,
  EmptyState,
  FieldLabel,
  InlineLoader,
  Input,
  PageTitle,
  SortableTableHeader,
  StatCard,
} from "./ui";
import { useTableSort } from "./table-sort";
import { displayModelName } from "./product-display";
import {
  formatCoverageDataAsOf,
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

function qcomListingIdForRow(row: DashboardRecord, workspace: QcomWorkspaceKey): string {
  if (workspace === "consolidated") {
    return String(row.product_code ?? "").trim();
  }
  const listing = String(row.listing_code ?? "").trim();
  if (listing) return listing;
  const code = String(row.product_code ?? "").trim();
  if (code && !/^B0[A-Z0-9]{8,}$/i.test(code)) return code;
  return "";
}

export function QcomDashboardPage({ workspace }: { workspace: QcomWorkspaceKey }) {
  const marketplace = qcomWorkspaceMarketplace(workspace);
  const [records, setRecords] = useState<DashboardRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [latestColumnSellout, setLatestColumnSellout] =
    useState<LatestSheetColumnSelloutSummary>({ saleDate: null, totalUnits: 0 });

  const {
    category,
    setCategory,
    categories,
    categoryList,
    subCategoryList,
    filteredRows: cycleFilteredRows,
    categoryCycleIndex,
    categoryCycleDirection,
    subCategoryCycleIndex,
    subCategoryCycleDirection,
    handleCategoryCycle,
    handleSubCategoryCycle,
    scopeLabel,
    activeCycleBadge,
    getDimensionCellValue,
  } = useCategorySubCategoryCycle({
    rows: records,
    getCategory: (r) => r.category,
    getSubCategory: (r) => r.sub_category,
  });

  const [sheetSubCategory, setSheetSubCategory] = useState("all");

  useEffect(() => {
    setSheetSubCategory("all");
  }, [category]);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void getDashboardRecords(marketplace)
      .then(setRecords)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load dashboard."))
      .finally(() => setIsLoading(false));
  }, [marketplace]);

  const filteredRecords = useMemo(() => {
    let list = cycleFilteredRows;
    if (sheetSubCategory !== "all") {
      list = list.filter((r) => (r.sub_category ?? "").trim() === sheetSubCategory);
    }
    const q = modelSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const model = displayModelName(r.product_name, r.product_code).toLowerCase();
      const rawName = String(r.product_name ?? "").trim().toLowerCase();
      return model.includes(q) || rawName.includes(q);
    });
  }, [cycleFilteredRows, modelSearch, sheetSubCategory]);

  useEffect(() => {
    if (filteredRecords.length === 0) {
      setLatestColumnSellout({ saleDate: null, totalUnits: 0 });
      return;
    }
    const qcomChannelTotal = category === "all" && !modelSearch.trim() && categoryCycleIndex === null;
    void sumSelloutOnMostRecentSheetDate(marketplace, filteredRecords, { qcomChannelTotal })
      .then(setLatestColumnSellout)
      .catch((err) => {
        console.error("[qcom-dashboard] latest column sellout", err);
        setLatestColumnSellout({ saleDate: null, totalUnits: 0 });
      });
  }, [marketplace, filteredRecords, category, modelSearch, categoryCycleIndex]);

  const dashboardCoverage = useMemo(
    () => sheetCoverageMinMax(filteredRecords),
    [filteredRecords],
  );

  const codeLabel = productCodeLabel(marketplace);
  const channelName =
    QCOM_CHANNEL_LABELS[marketplace as QuickCommerceChannel] ?? marketplaceLabel(marketplace);

  const dashboardSortAccessors = useMemo(
    () =>
      ({
        listing_id: (row: DashboardRecord) => qcomListingIdForRow(row, workspace),
        model: (row: DashboardRecord) => displayModelName(row.product_name, row.product_code),
        category: (row: DashboardRecord) => row.category ?? "",
        sub_category: (row: DashboardRecord) => row.sub_category ?? "",
        total_so_units: (row: DashboardRecord) => row.total_so_units,
        may_mtd_units: (row: DashboardRecord) => row.may_mtd_units,
        drr_units: (row: DashboardRecord) => row.drr_units,
        doc_days: (row: DashboardRecord) => row.doc_days,
      }) satisfies import("./table-sort").TableSortAccessors<DashboardRecord>,
    [workspace],
  );

  const tableScrollRef = useRef<HTMLDivElement>(null);

  const { sortedRows, sortKey, sortDirection, requestSort } = useTableSort(
    filteredRecords,
    dashboardSortAccessors,
    "may_mtd_units",
    "desc",
    {
      naturalTextSortKeys: ["model", "sub_category"],
      textSortKeys: ["category"],
      tieBreaker: (row) => displayModelName(row.product_name, row.product_code),
    },
  );

  useEffect(() => {
    tableScrollRef.current?.scrollTo({ top: 0 });
  }, [sortKey, sortDirection, category, categoryCycleIndex, subCategoryCycleIndex]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <PageTitle
          title={`${channelName} Dashboard`}
          subtitle={`${category === "all" ? "All categories" : category}. Sellout metrics from the latest ${channelName} upload — use Channel comparison for all platforms.`}
        />
        {dashboardCoverage.min && dashboardCoverage.max ? (
          <DataAsOnRangeBadge
            min={dashboardCoverage.min}
            max={dashboardCoverage.max}
            scopeLabel={scopeLabel}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <CategorySubCategoryFilterControls
          category={category}
          categories={categories}
          onCategoryChange={setCategory}
          subCategory={sheetSubCategory}
          subCategoryOptions={subCategoryList}
          onSubCategoryChange={setSheetSubCategory}
          showSubCategory
        />
        <div className="min-w-[220px] flex-1 sm:max-w-sm">
          <FieldLabel>Search model</FieldLabel>
          <Input
            type="search"
            placeholder="Filter by model name…"
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
          />
        </div>
        <span className="rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-bold text-zinc-700">
          {filteredRecords.length} SKU{filteredRecords.length === 1 ? "" : "s"}
          {activeCycleBadge ? ` · ${activeCycleBadge}` : ""}
          {modelSearch.trim() && records.length !== filteredRecords.length
            ? ` · ${records.length} total`
            : ""}
        </span>
      </div>

      {isLoading ? (
        <InlineLoader text={`Loading ${marketplaceLabel(marketplace)} dashboard…`} />
      ) : error ? (
        <EmptyState title="Unable to load dashboard" description={error} />
      ) : records.length === 0 ? (
        <EmptyState
          title="No data yet"
          description={`Upload the Quick Commerce master from Upload Center, then return to this ${channelName} dashboard.`}
        />
      ) : filteredRecords.length === 0 ? (
        <EmptyState
          title="No matching models"
          description="Try a different model name or clear the category filter."
        />
      ) : (
        <>
          <StatCard
            label={
              latestColumnSellout.saleDate
                ? `Sell out (${formatSheetColumnDateLabel(latestColumnSellout.saleDate)})`
                : "Sell out (latest date column)"
            }
            value={formatInteger(latestColumnSellout.totalUnits)}
            variant="emerald"
            hint={
              latestColumnSellout.saleDate
                ? latestColumnSellout.totalUnits > 0
                  ? category === "all" && !modelSearch.trim() && categoryCycleIndex === null
                    ? `Channel total for the ${formatSheetColumnDateLabel(latestColumnSellout.saleDate)} column on the ${channelName} tab.`
                    : `Sum of the ${formatSheetColumnDateLabel(latestColumnSellout.saleDate)} column for SKUs in this view.`
                  : `No ${formatSheetColumnDateLabel(latestColumnSellout.saleDate)} sellout stored yet — re-upload the master with coverage date ${formatSheetColumnDateLabel(latestColumnSellout.saleDate)}.`
                : "Re-upload the Quick Commerce master with the sheet coverage date set to the latest day column."
            }
          />

          <Card className="overflow-hidden p-0">
            <div className="border-b border-zinc-200 bg-zinc-50/80 px-4 py-3">
              <h3 className="text-lg font-bold text-zinc-900">SKU metrics</h3>
              <p className="mt-0.5 text-sm text-zinc-600">
                Model ↑↓ sorts A–Z with numbers in order. <strong>All categories</strong>: Category
                ↑↓ steps through categories. One category (e.g. Audio): Sub category ↑↓ steps
                through types.
              </p>
            </div>
            <div
              ref={tableScrollRef}
              className="max-h-[min(70vh,800px)] overflow-auto"
            >
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead className="sticky top-0 z-10 bg-white shadow-sm">
                  <tr className="text-left text-xs font-bold uppercase tracking-wide text-zinc-500">
                    <SortableTableHeader
                      label={codeLabel}
                      sortKey="listing_id"
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
                    {category === "all" ? (
                      <DimensionCycleTableHeader
                        defaultLabel="Category"
                        valueList={categoryList}
                        cycleIndex={categoryCycleIndex}
                        lastDirection={categoryCycleDirection}
                        onCycle={handleCategoryCycle}
                        stepAriaLabel="Step through categories"
                      />
                    ) : (
                      <DimensionCycleTableHeader
                        defaultLabel="Sub category"
                        valueList={subCategoryList}
                        cycleIndex={subCategoryCycleIndex}
                        lastDirection={subCategoryCycleDirection}
                        onCycle={handleSubCategoryCycle}
                        stepAriaLabel={`Step through sub categories in ${category}`}
                      />
                    )}
                    <SortableTableHeader
                      label="Total SO"
                      sortKey="total_so_units"
                      activeKey={sortKey}
                      activeDirection={sortDirection}
                      onSort={requestSort}
                      align="right"
                    />
                    <SortableTableHeader
                      label="MTD"
                      sortKey="may_mtd_units"
                      activeKey={sortKey}
                      activeDirection={sortDirection}
                      onSort={requestSort}
                      align="right"
                    />
                    <SortableTableHeader
                      label="DRR"
                      sortKey="drr_units"
                      activeKey={sortKey}
                      activeDirection={sortDirection}
                      onSort={requestSort}
                      align="right"
                    />
                    <SortableTableHeader
                      label="DOC"
                      sortKey="doc_days"
                      activeKey={sortKey}
                      activeDirection={sortDirection}
                      onSort={requestSort}
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr
                      key={row.product_code}
                      className="border-t border-zinc-100 hover:bg-violet-50/50"
                    >
                      <td className="px-2 py-2 font-mono text-xs">
                        {(() => {
                          const listingId = qcomListingIdForRow(row, workspace);
                          return listingId ? (
                            <Link
                              className="text-violet-700 hover:underline"
                              to={qcomProductLandingPath(row.product_code)}
                            >
                              {listingId}
                            </Link>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-2">
                        {displayModelName(row.product_name, row.product_code)}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {getDimensionCellValue(row)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatInteger(row.total_so_units)}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">
                        {formatInteger(row.may_mtd_units)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatInteger(row.drr_units)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatInteger(row.doc_days)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
