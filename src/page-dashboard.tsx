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
import { getDashboardRecords } from "./data";
import {
  type DashboardRecord,
  type Marketplace,
  type SubCategory,
  SUB_CATEGORY_LABELS,
  TRACKED_SUB_CATEGORIES,
} from "./types";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_LEGEND_STYLE } from "./chart-theme";
import {
  Card,
  ChartTooltip,
  DataAsOnRangeBadge,
  EmptyState,
  FieldLabel,
  InlineLoader,
  PageTitle,
  Select,
  StatCard,
} from "./ui";
import { displayModelName } from "./product-display";
import { cn, formatDecimal, formatInteger, normalizeKey, sheetCoverageMinMax } from "./utils";

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

function matchesSubCategory(
  record: DashboardRecord,
  subCategory: SubCategory,
): boolean {
  // normalizeKey collapses underscores (projector_screen → "projector screen"); normalize both sides.
  return (
    normalizeKey(record.sub_category ?? "") === normalizeKey(subCategory)
  );
}

export function DashboardPage({ marketplace }: { marketplace: Marketplace }) {
  const [records, setRecords] = useState<DashboardRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subCategory, setSubCategory] = useState<SubCategory>("monitor");

  useEffect(() => {
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
  }, [marketplace]);

  const filteredRecords = useMemo(
    () => records.filter((record) => matchesSubCategory(record, subCategory)),
    [records, subCategory],
  );

  const kpis = useMemo(() => {
    const totalPo = filteredRecords.reduce(
      (acc, row) => acc + row.purchase_order_units,
      0,
    );
    const totalSo = filteredRecords.reduce(
      (acc, row) => acc + row.total_so_units,
      0,
    );

    return { totalPo, totalSo };
  }, [filteredRecords]);

  const dashboardCoverage = useMemo(
    () => sheetCoverageMinMax(filteredRecords),
    [filteredRecords],
  );

  const codeLabel = getCodeLabel(marketplace);

  const topPo = filteredRecords
    .filter((row) => row.purchase_order_units > 0)
    .slice(0, 10)
    .map((row) => ({
      code: row.product_code,
      model: displayModelName(row.product_name, row.product_code),
      po: row.purchase_order_units,
    }));

  const inventoryVsTarget = filteredRecords.slice(0, 10).map((row) => ({
    code: row.product_code,
    model: displayModelName(row.product_name, row.product_code),
    inventory: row.inventory_units,
    target: Number((row.drr_units * 45).toFixed(2)),
  }));

  if (isLoading) {
    return <InlineLoader text={`Loading ${marketplace} dashboard...`} />;
  }

  if (error) {
    return <EmptyState title="Unable to load dashboard" description={error} />;
  }

  const channelName = marketplace === "amazon" ? "Amazon" : "Flipkart";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <PageTitle
            title={`${channelName} Dashboard`}
            subtitle={`${SUB_CATEGORY_LABELS[subCategory]}. Live inventory, sellout and PO insights from the latest uploaded report.`}
          />
        </div>
        {dashboardCoverage.min && dashboardCoverage.max ? (
          <DataAsOnRangeBadge
            min={dashboardCoverage.min}
            max={dashboardCoverage.max}
            scopeLabel={SUB_CATEGORY_LABELS[subCategory]}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <FieldLabel>Sub-category</FieldLabel>
          <Select
            value={subCategory}
            onChange={(event) =>
              setSubCategory(event.target.value as SubCategory)
            }
            className="min-w-[220px] w-auto font-bold"
            aria-label="Sub-category"
          >
            {TRACKED_SUB_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {SUB_CATEGORY_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        <span className="rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {filteredRecords.length} SKU
          {filteredRecords.length === 1 ? "" : "s"} in view
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Total Purchase Order"
          value={formatInteger(kpis.totalPo)}
          variant="amber"
          hint="Suggested PO units"
        />
        <StatCard
          label="Total Sell Out (sheet)"
          value={formatInteger(kpis.totalSo)}
          variant="emerald"
          hint="Total SO column — same as summing that column in your upload."
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
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topPo}>
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
                    <Bar dataKey="po" name="Purchase Order" radius={[6, 6, 0, 0]}>
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
                  <th className="px-3 py-2">{codeLabel}</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Inventory</th>
                  <th className="px-3 py-2">Total SO</th>
                  <th className="px-3 py-2">May MTD</th>
                  <th className="px-3 py-2">Apr SO</th>
                  <th className="px-3 py-2">DRR</th>
                  <th className="px-3 py-2">DOC</th>
                  <th className="px-3 py-2 text-right">PO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {filteredRecords.map((row) => (
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
    </div>
  );
}
