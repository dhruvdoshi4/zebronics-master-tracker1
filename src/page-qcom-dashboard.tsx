import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getDashboardRecords,
  sumSelloutOnMostRecentSheetDate,
  type LatestSheetColumnSelloutSummary,
} from "./data";
import { marketplaceLabel, productCodeLabel } from "./marketplace-labels";
import { qcomProductHubPath } from "./qcom-paths";
import { QCOM_CHANNEL_LABELS, type QuickCommerceChannel } from "./tenants";
import type { DashboardRecord } from "./types";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_LEGEND_STYLE } from "./chart-theme";
import {
  Card,
  ChartTooltip,
  DataAsOnRangeBadge,
  EmptyState,
  FieldLabel,
  InlineLoader,
  Input,
  PageTitle,
  Select,
  SortableTableHeader,
  StatCard,
} from "./ui";
import { useTableSort } from "./table-sort";
import { chartAxisModelLabel, displayModelName } from "./product-display";
import {
  cn,
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

function qcomListingIdForRow(row: DashboardRecord): string {
  const listing = String(row.listing_code ?? "").trim();
  if (listing) return listing;
  const code = String(row.product_code ?? "").trim();
  if (code && !/^B0[A-Z0-9]{8,}$/i.test(code)) return code;
  return "";
}

export function QcomDashboardPage({ channel }: { channel: QuickCommerceChannel }) {
  const [records, setRecords] = useState<DashboardRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("all");
  const [modelSearch, setModelSearch] = useState("");
  const [latestColumnSellout, setLatestColumnSellout] =
    useState<LatestSheetColumnSelloutSummary>({ saleDate: null, totalUnits: 0 });

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void getDashboardRecords(channel)
      .then(setRecords)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load dashboard."))
      .finally(() => setIsLoading(false));
  }, [channel]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const row of records) {
      const c = row.category?.trim();
      if (c) set.add(c);
    }
    return ["all", ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [records]);

  const filteredRecords = useMemo(() => {
    let rows =
      category === "all"
        ? records
        : records.filter((r) => (r.category ?? "").trim() === category);
    const q = modelSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const model = displayModelName(r.product_name, r.product_code).toLowerCase();
      const rawName = String(r.product_name ?? "").trim().toLowerCase();
      return model.includes(q) || rawName.includes(q);
    });
  }, [records, category, modelSearch]);

  const kpis = useMemo(() => {
    const totalPo = filteredRecords.reduce((acc, row) => acc + row.purchase_order_units, 0);
    return { totalPo };
  }, [filteredRecords]);

  useEffect(() => {
    if (filteredRecords.length === 0) {
      setLatestColumnSellout({ saleDate: null, totalUnits: 0 });
      return;
    }
    const qcomChannelTotal = category === "all" && !modelSearch.trim();
    void sumSelloutOnMostRecentSheetDate(channel, filteredRecords, { qcomChannelTotal })
      .then(setLatestColumnSellout)
      .catch((err) => {
        console.error("[qcom-dashboard] latest column sellout", err);
        setLatestColumnSellout({ saleDate: null, totalUnits: 0 });
      });
  }, [channel, filteredRecords, category, modelSearch]);

  const dashboardCoverage = useMemo(
    () => sheetCoverageMinMax(filteredRecords),
    [filteredRecords],
  );

  const codeLabel = productCodeLabel(channel);
  const channelName = QCOM_CHANNEL_LABELS[channel];

  const dashboardSortAccessors = useMemo(
    () =>
      ({
        listing_id: (row: DashboardRecord) => qcomListingIdForRow(row),
        model: (row: DashboardRecord) => displayModelName(row.product_name, row.product_code),
        category: (row: DashboardRecord) => row.category ?? "",
        inventory_units: (row: DashboardRecord) => row.inventory_units,
        total_so_units: (row: DashboardRecord) => row.total_so_units,
        may_mtd_units: (row: DashboardRecord) => row.may_mtd_units,
        drr_units: (row: DashboardRecord) => row.drr_units,
        doc_days: (row: DashboardRecord) => row.doc_days,
        purchase_order_units: (row: DashboardRecord) => row.purchase_order_units,
      }) satisfies import("./table-sort").TableSortAccessors<DashboardRecord>,
    [],
  );

  const { sortedRows, sortKey, sortDirection, requestSort } = useTableSort(
    filteredRecords,
    dashboardSortAccessors,
    "purchase_order_units",
    "desc",
  );

  const topPo = filteredRecords
    .filter((row) => row.purchase_order_units > 0)
    .slice(0, 10)
    .map((row) => ({
      model: displayModelName(row.product_name, row.product_code),
      axisLabel: chartAxisModelLabel(row.product_name, row.product_code),
      po: row.purchase_order_units,
    }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <PageTitle
          title={`${channelName} Dashboard`}
          subtitle={`${category === "all" ? "All categories" : category}. Inventory, sellout and PO from the latest Quick Commerce upload.`}
        />
        {dashboardCoverage.min && dashboardCoverage.max ? (
          <DataAsOnRangeBadge
            min={dashboardCoverage.min}
            max={dashboardCoverage.max}
            scopeLabel={category === "all" ? "All" : category}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <FieldLabel>Category</FieldLabel>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? "All categories" : c}
              </option>
            ))}
          </Select>
        </div>
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
          {modelSearch.trim() && records.length !== filteredRecords.length
            ? ` · ${records.length} total`
            : ""}
        </span>
      </div>

      {isLoading ? (
        <InlineLoader text={`Loading ${marketplaceLabel(channel)} dashboard…`} />
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
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Total Purchase Order" value={formatInteger(kpis.totalPo)} variant="amber" />
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
                    ? category === "all" && !modelSearch.trim()
                      ? `Channel total for the ${formatSheetColumnDateLabel(latestColumnSellout.saleDate)} column (same as the total row on the Zepto tab).`
                      : `Sum of the ${formatSheetColumnDateLabel(latestColumnSellout.saleDate)} column for SKUs in this view.`
                    : `No ${formatSheetColumnDateLabel(latestColumnSellout.saleDate)} sellout stored yet — re-upload the Quick Commerce master with coverage date ${formatSheetColumnDateLabel(latestColumnSellout.saleDate)} (Upload Center).`
                  : "Re-upload the Quick Commerce master workbook with the sheet coverage date set to the latest day column (e.g. 18 May)."
              }
            />
          </div>

          {topPo.length > 0 ? (
            <Card>
              <h3 className="mb-4 text-lg font-bold">Top Purchase Orders</h3>
              <div style={{ height: Math.max(240, topPo.length * 36) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topPo} layout="vertical" margin={{ left: 4, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} horizontal={false} />
                    <XAxis type="number" tick={CHART_AXIS_TICK} allowDecimals={false} />
                    <YAxis type="category" dataKey="axisLabel" tick={CHART_AXIS_TICK} width={140} />
                    <Tooltip
                      content={
                        <ChartTooltip
                          formatValue={(v) => `${formatInteger(Number(v ?? 0))} units`}
                          labelPrefix="Model"
                          labelKey="model"
                        />
                      }
                    />
                    <Legend iconType="circle" wrapperStyle={CHART_LEGEND_STYLE} />
                    <Bar dataKey="po" name="PO units" fill="#f59e0b" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}

          <Card className="overflow-auto">
            <h3 className="mb-4 text-lg font-bold">SKU Metrics</h3>
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase text-zinc-500">
                  <SortableTableHeader label={codeLabel} sortKey="listing_id" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} />
                  <SortableTableHeader label="Model" sortKey="model" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} />
                  <SortableTableHeader label="Category" sortKey="category" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} />
                  <SortableTableHeader label="Inv" sortKey="inventory_units" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} />
                  <SortableTableHeader label="Total SO" sortKey="total_so_units" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} />
                  <SortableTableHeader label="MTD" sortKey="may_mtd_units" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} />
                  <SortableTableHeader label="DRR" sortKey="drr_units" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} />
                  <SortableTableHeader label="DOC" sortKey="doc_days" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} />
                  <SortableTableHeader label="PO" sortKey="purchase_order_units" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.product_code} className="border-t border-zinc-100 hover:bg-violet-50/50">
                    <td className="px-2 py-2 font-mono text-xs">
                      {(() => {
                        const listingId = qcomListingIdForRow(row);
                        return listingId ? (
                          <Link
                            className="text-violet-700 hover:underline"
                            to={qcomProductHubPath(row.product_code)}
                          >
                            {listingId}
                          </Link>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-2">{displayModelName(row.product_name, row.product_code)}</td>
                    <td className="px-2 py-2">{row.category ?? "—"}</td>
                    <td className="px-2 py-2">{formatInteger(row.inventory_units)}</td>
                    <td className="px-2 py-2">{formatInteger(row.total_so_units)}</td>
                    <td className="px-2 py-2">{formatInteger(row.may_mtd_units)}</td>
                    <td className="px-2 py-2">{formatInteger(row.drr_units)}</td>
                    <td className="px-2 py-2">{formatInteger(row.doc_days)}</td>
                    <td className={cn("px-2 py-2 text-right font-semibold", row.purchase_order_units > 0 && "text-amber-700")}>
                      {formatInteger(row.purchase_order_units)}
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
