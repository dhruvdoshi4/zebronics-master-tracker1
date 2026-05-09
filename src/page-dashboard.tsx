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
  getSubCategoryLabel,
} from "./types";
import {
  Card,
  ChartTooltip,
  EmptyState,
  InlineLoader,
  PageTitle,
  StatCard,
} from "./ui";
import { cn, formatDecimal, formatInteger, normalizeKey } from "./utils";

const AXIS_TICK = { fill: "#71717a", fontSize: 11 } as const;
const GRID_STROKE = "rgba(113,113,122,0.25)";

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

  const codeLabel = getCodeLabel(marketplace);

  const topPo = filteredRecords
    .filter((row) => row.purchase_order_units > 0)
    .slice(0, 10)
    .map((row) => ({
      code: row.product_code,
      model: row.product_name,
      po: row.purchase_order_units,
    }));

  const inventoryVsTarget = filteredRecords.slice(0, 10).map((row) => ({
    code: row.product_code,
    model: row.product_name,
    inventory: row.inventory_units,
    target: Number((row.drr_units * 45).toFixed(2)),
  }));

  if (isLoading) {
    return <InlineLoader text={`Loading ${marketplace} dashboard...`} />;
  }

  if (error) {
    return <EmptyState title="Unable to load dashboard" description={error} />;
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title={`${marketplace === "amazon" ? "Amazon" : "Flipkart"} Dashboard`}
        subtitle={`${SUB_CATEGORY_LABELS[subCategory]} — live metrics from your latest upload.`}
      />

      <div className="flex flex-wrap gap-2">
        {TRACKED_SUB_CATEGORIES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSubCategory(value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition sm:text-sm",
              subCategory === value
                ? "bg-violet-600 text-white shadow"
                : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
            )}
          >
            {SUB_CATEGORY_LABELS[value]}
          </button>
        ))}
        <span className="self-center rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {filteredRecords.length} SKU
          {filteredRecords.length === 1 ? "" : "s"} in view
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Total Purchase Order"
          value={formatInteger(kpis.totalPo)}
          variant="amber"
          hint="Recommended units to procure"
        />
        <StatCard
          label="Total Sell Out"
          value={formatInteger(kpis.totalSo)}
          variant="emerald"
        />
      </div>

      {filteredRecords.length === 0 ? (
        <EmptyState
          title="No data yet"
          description={`No ${getSubCategoryLabel(subCategory)} SKUs found. Upload a ${marketplace} sheet from Upload Center.`}
        />
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Top Purchase Orders
                </h3>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                  Action Items
                </span>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topPo}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={GRID_STROKE}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="code"
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      hide
                    />
                    <YAxis
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      width={40}
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
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Inventory vs Target Stock
                </h3>
                <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">
                  DRR x 45 days
                </span>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={inventoryVsTarget}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={GRID_STROKE}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="code"
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      hide
                    />
                    <YAxis
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      width={40}
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
                    <Legend
                      iconType="circle"
                      wrapperStyle={{ fontSize: 12, color: "#71717a" }}
                    />
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
            <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              SKU Metrics
            </h3>
            <table className="min-w-full divide-y divide-zinc-200 text-sm text-zinc-700 dark:divide-zinc-800 dark:text-zinc-200">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
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
                      {row.product_name}
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
