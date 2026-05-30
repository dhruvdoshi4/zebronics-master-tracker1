import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CategorySubCategoryFilterControls } from "./category-subcategory-filter-controls";
import {
  DimensionCycleTableHeader,
  useCategorySubCategoryCycle,
} from "./category-subcategory-cycle";
import {
  getQcomParallelDashboardRows,
  type QcomChannelMetricsSlice,
  type QcomParallelModelRow,
} from "./qcom-parallel-dashboard";
import {
  QCOM_CHANNEL_TABLE_THEME,
  QCOM_COMPARISON_CHANNEL_ORDER,
} from "./qcom-channel-theme";
import { qcomProductLandingPath } from "./qcom-paths";
import { QCOM_HO_STOCK_CATALOG_MARKETPLACE } from "./types";
import { getDashboardRecords } from "./data";
import {
  Card,
  DataAsOnRangeBadge,
  EmptyState,
  FieldLabel,
  InlineLoader,
  Input,
  PageTitle,
  SortableTableHeader,
} from "./ui";
import { useTableSort } from "./table-sort";
import type { QuickCommerceChannel } from "./tenants";
import { cn, formatInteger, sheetCoverageMinMax } from "./utils";
import type { DashboardRecord } from "./types";

const METRIC_LINES = [
  { key: "SO", field: "totalSo" as const, compareAcrossChannels: true },
  { key: "MTD", field: "mtd" as const, compareAcrossChannels: true },
  { key: "DRR", field: "drr" as const, compareAcrossChannels: true },
  { key: "DOC", field: "doc" as const, compareAcrossChannels: false },
] as const;

type ComparedMetricField = "totalSo" | "mtd" | "drr";

function channelLeadersForMetric(
  channels: QcomParallelModelRow["channels"],
  field: ComparedMetricField,
): Set<QuickCommerceChannel> {
  const leaders = new Set<QuickCommerceChannel>();
  let max = -Infinity;
  for (const ch of QCOM_COMPARISON_CHANNEL_ORDER) {
    const slice = channels[ch];
    if (!slice) continue;
    if (slice[field] > max) max = slice[field];
  }
  if (max <= 0) return leaders;
  for (const ch of QCOM_COMPARISON_CHANNEL_ORDER) {
    const slice = channels[ch];
    if (slice && slice[field] === max) leaders.add(ch);
  }
  return leaders;
}

function rowMetricLeaders(row: QcomParallelModelRow) {
  return {
    totalSo: channelLeadersForMetric(row.channels, "totalSo"),
    mtd: channelLeadersForMetric(row.channels, "mtd"),
    drr: channelLeadersForMetric(row.channels, "drr"),
  };
}

function ChannelMetricBlock({
  slice,
  channel,
  leaders,
}: {
  slice: QcomChannelMetricsSlice | null;
  channel: QuickCommerceChannel;
  leaders: ReturnType<typeof rowMetricLeaders>;
}) {
  const theme = QCOM_CHANNEL_TABLE_THEME[channel];
  if (!slice) {
    return (
      <td className={cn("border-l align-top px-2 py-2.5", theme.empty)}>
        <span className="text-sm font-medium text-zinc-400">Not listed</span>
      </td>
    );
  }
  return (
    <td className={cn("border-l align-top px-2 py-2", theme.cell)}>
      <dl className="space-y-1">
        {METRIC_LINES.map(({ key, field, compareAcrossChannels }) => {
          const isLeader =
            compareAcrossChannels &&
            leaders[field as ComparedMetricField].has(channel);
          return (
            <div
              key={key}
              className="flex items-baseline justify-between gap-1.5 text-sm leading-snug"
            >
              <dt className="shrink-0 text-xs font-bold uppercase tracking-wide text-zinc-500">
                {key}
              </dt>
              <dd
                className={cn(
                  "tabular-nums",
                  isLeader
                    ? "font-extrabold text-zinc-950"
                    : "font-medium text-zinc-700",
                )}
              >
                {formatInteger(slice[field])}
              </dd>
            </div>
          );
        })}
      </dl>
    </td>
  );
}

export function QcomConsolidatedComparisonPage() {
  const [rows, setRows] = useState<QcomParallelModelRow[]>([]);
  const [networkRecords, setNetworkRecords] = useState<DashboardRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");

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
    rows,
    getCategory: (r) => r.category,
    getSubCategory: (r) => r.subCategory,
  });

  const [sheetSubCategory, setSheetSubCategory] = useState("all");

  useEffect(() => {
    setSheetSubCategory("all");
  }, [category]);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void Promise.all([
      getQcomParallelDashboardRows(),
      getDashboardRecords(QCOM_HO_STOCK_CATALOG_MARKETPLACE),
    ])
      .then(([parallel, network]) => {
        setRows(parallel);
        setNetworkRecords(network);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load comparison."),
      )
      .finally(() => setIsLoading(false));
  }, []);

  const filteredRows = useMemo(() => {
    let list = cycleFilteredRows;
    if (sheetSubCategory !== "all") {
      list = list.filter((r) => (r.subCategory ?? "").trim() === sheetSubCategory);
    }
    const q = modelSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.modelName.toLowerCase().includes(q) ||
        r.canonicalCode.toLowerCase().includes(q),
    );
  }, [cycleFilteredRows, modelSearch, sheetSubCategory]);

  const coverage = useMemo(() => sheetCoverageMinMax(networkRecords), [networkRecords]);

  const sortAccessors = useMemo(
    () =>
      ({
        model: (r: QcomParallelModelRow) => r.modelName,
        category: (r: QcomParallelModelRow) =>
          r.category?.trim().toLocaleLowerCase("en-IN") ?? "",
        sub_category: (r: QcomParallelModelRow) =>
          r.subCategory?.trim().toLocaleLowerCase("en-IN") ?? "",
        mtd_sum: (r: QcomParallelModelRow) => r.totalMtdAcrossChannels,
        zepto_mtd: (r: QcomParallelModelRow) => r.channels.zepto?.mtd ?? -1,
        blinkit_mtd: (r: QcomParallelModelRow) => r.channels.blinkit?.mtd ?? -1,
        instamart_mtd: (r: QcomParallelModelRow) => r.channels.instamart?.mtd ?? -1,
        bigbasket_mtd: (r: QcomParallelModelRow) => r.channels.bigbasket?.mtd ?? -1,
      }) satisfies import("./table-sort").TableSortAccessors<QcomParallelModelRow>,
    [],
  );

  const tableScrollRef = useRef<HTMLDivElement>(null);

  const { sortedRows, sortKey, sortDirection, requestSort } = useTableSort(
    filteredRows,
    sortAccessors,
    "mtd_sum",
    "desc",
    {
      naturalTextSortKeys: ["model", "sub_category"],
      textSortKeys: ["category"],
      tieBreaker: (r) => r.modelName,
    },
  );

  useEffect(() => {
    tableScrollRef.current?.scrollTo({ top: 0 });
  }, [sortKey, sortDirection, category, categoryCycleIndex, subCategoryCycleIndex, sheetSubCategory]);

  const listedStats = useMemo(() => {
    const on4 = filteredRows.filter((r) => r.listedOnCount === 4).length;
    return { on4, total: filteredRows.length };
  }, [filteredRows]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <PageTitle
          title="Channel comparison"
          subtitle="Compare the same models across Zepto, Blinkit, Instamart, and Big Basket — Total SO, MTD, DRR, and DOC only."
        />
        {coverage.min && coverage.max ? (
          <DataAsOnRangeBadge
            min={coverage.min}
            max={coverage.max}
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
            placeholder="Filter by model or ASIN…"
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
          />
        </div>
        <span className="rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-bold text-zinc-700">
          {filteredRows.length} model{filteredRows.length === 1 ? "" : "s"}
          {activeCycleBadge ? ` · ${activeCycleBadge}` : ""}
          {listedStats.on4 > 0 ? ` · ${listedStats.on4} on all 4 channels` : ""}
        </span>
      </div>

      {isLoading ? (
        <InlineLoader text="Loading channel comparison…" />
      ) : error ? (
        <EmptyState title="Unable to load comparison" description={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No data yet"
          description="Upload the Quick Commerce master from Upload Center, then return here."
        />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          title="No matching models"
          description="Try a different model name or clear the category filter."
        />
      ) : (
        <Card className="overflow-hidden p-0">
            <div className="border-b border-zinc-200 bg-zinc-50/80 px-4 py-3">
              <h3 className="text-lg font-bold text-zinc-900">Model comparison</h3>
              <p className="mt-0.5 text-sm text-zinc-600">
                Model ↑↓ sorts A–Z with numbers in order. <strong>All categories</strong>: Category
                ↑↓ steps through categories. One category (e.g. Audio): Sub category ↑↓ steps
                through types (2.1 Speaker, BT Headphone, …).
              </p>
            </div>
            <div
              ref={tableScrollRef}
              className="max-h-[min(70vh,800px)] overflow-y-auto"
            >
              <table className="w-full border-collapse text-base">
                <thead className="sticky top-0 z-10 bg-white shadow-sm">
                  <tr className="border-b border-zinc-200 text-sm font-bold uppercase tracking-wide">
                    <SortableTableHeader
                      label="Model"
                      sortKey="model"
                      activeKey={sortKey}
                      activeDirection={sortDirection}
                      onSort={requestSort}
                      className="w-px whitespace-nowrap bg-zinc-50 px-3 py-2.5 text-left"
                    />
                    {category === "all" ? (
                      <DimensionCycleTableHeader
                        defaultLabel="Category"
                        valueList={categoryList}
                        cycleIndex={categoryCycleIndex}
                        lastDirection={categoryCycleDirection}
                        onCycle={handleCategoryCycle}
                        stepAriaLabel="Step through categories"
                        className="w-px whitespace-nowrap bg-zinc-50"
                      />
                    ) : (
                      <DimensionCycleTableHeader
                        defaultLabel="Sub category"
                        valueList={subCategoryList}
                        cycleIndex={subCategoryCycleIndex}
                        lastDirection={subCategoryCycleDirection}
                        onCycle={handleSubCategoryCycle}
                        stepAriaLabel={`Step through sub categories in ${category}`}
                        className="w-px whitespace-nowrap bg-zinc-50"
                      />
                    )}
                    {QCOM_COMPARISON_CHANNEL_ORDER.map((ch) => {
                      const theme = QCOM_CHANNEL_TABLE_THEME[ch];
                      const mtdSortKey = `${ch}_mtd` as keyof typeof sortAccessors;
                      return (
                        <SortableTableHeader
                          key={ch}
                          label={theme.label}
                          sortKey={mtdSortKey}
                          activeKey={sortKey}
                          activeDirection={sortDirection}
                          onSort={requestSort}
                          className={cn(
                            "w-[18%] border-l px-2 py-2.5 text-center",
                            theme.header,
                          )}
                        />
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => {
                    const leaders = rowMetricLeaders(row);
                    return (
                      <tr
                        key={row.canonicalCode}
                        className="border-t border-zinc-100 hover:bg-zinc-50/80"
                      >
                        <td className="w-px max-w-[min(32vw,360px)] whitespace-normal px-3 py-2 align-top">
                          <Link
                            to={qcomProductLandingPath(row.canonicalCode)}
                            className="text-[15px] font-semibold leading-snug text-violet-700 hover:underline"
                            title={row.modelName}
                          >
                            {row.modelName}
                          </Link>
                          {row.listedOnCount < 4 ? (
                            <span className="mt-0.5 block text-xs font-medium text-zinc-500">
                              {row.listedOnCount}/4
                            </span>
                          ) : null}
                        </td>
                        <td
                          className="w-px whitespace-nowrap px-2 py-2 align-top text-sm text-zinc-700"
                          title={getDimensionCellValue(row)}
                        >
                          {getDimensionCellValue(row)}
                        </td>
                        {QCOM_COMPARISON_CHANNEL_ORDER.map((ch) => (
                          <ChannelMetricBlock
                            key={ch}
                            channel={ch}
                            slice={row.channels[ch]}
                            leaders={leaders}
                          />
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
        </Card>
      )}
    </div>
  );
}
