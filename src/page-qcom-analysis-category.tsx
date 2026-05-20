import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
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
import { loadQcomCategoryMonthlyTotals, listQcomCategories } from "./data-qcom";
import { marketplaceLabel } from "./marketplace-labels";
import { qcomAnalysisCategoryPath } from "./qcom-paths";
import { QCOM_MARKETPLACES } from "./types";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_LEGEND_STYLE } from "./chart-theme";
import { Card, EmptyState, FieldLabel, InlineLoader, PageTitle, Select } from "./ui";
import { formatInteger } from "./utils";

export function QcomAnalysisCategoryPage() {
  const params = useParams<{ category?: string }>();
  const initial = params.category ? decodeURIComponent(params.category) : "";
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState(initial || "Audio");
  const [monthMap, setMonthMap] = useState<Map<string, import("./data-qcom").QcomCategoryChannelTotals>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listQcomCategories().then((cats) => {
      setCategories(cats);
      if (!initial && cats[0]) setCategory(cats[0]);
    });
  }, [initial]);

  useEffect(() => {
    if (!category) return;
    setLoading(true);
    setError(null);
    void loadQcomCategoryMonthlyTotals(category)
      .then(setMonthMap)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [category]);

  const chartData = useMemo(() => {
    return [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-18)
      .map(([monthYm, totals]) => ({
        month: monthYm,
        zepto: totals.zepto,
        blinkit: totals.blinkit,
        instamart: totals.instamart,
        bigbasket: totals.bigbasket,
        total: totals.zepto + totals.blinkit + totals.instamart + totals.bigbasket,
      }));
  }, [monthMap]);

  const fyTotal = chartData.reduce((acc, row) => acc + row.total, 0);

  return (
    <div className="space-y-6">
      <Link
        to="/app/qcom/analysis"
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </Link>

      <PageTitle
        title="Category analysis"
        subtitle="Monthly sell-out summed from daily columns — all quick commerce channels combined."
      />

      <div className="max-w-xs">
        <FieldLabel>Category</FieldLabel>
        <Select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            window.history.replaceState(null, "", qcomAnalysisCategoryPath(e.target.value));
          }}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <InlineLoader />
      ) : error ? (
        <EmptyState title="Unable to load" description={error} />
      ) : chartData.length === 0 ? (
        <EmptyState
          title="No sellout history"
          description="Re-upload the Quick Commerce master from Upload Center so daily columns (6/Feb, 5/Feb, …) are ingested. Older uploads may have skipped those columns."
        />
      ) : (
        <>
          <Card className="text-sm font-medium text-zinc-700">
            {category} · recent months total {formatInteger(fyTotal)} units (all channels)
          </Card>
          <Card>
            <h3 className="mb-4 text-lg font-bold">Monthly sell-out by channel</h3>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="month" tick={CHART_AXIS_TICK} />
                  <YAxis tick={CHART_AXIS_TICK} allowDecimals={false} />
                  <Tooltip formatter={(v) => formatInteger(Number(v ?? 0))} />
                  <Legend wrapperStyle={CHART_LEGEND_STYLE} />
                  {QCOM_MARKETPLACES.map((m, i) => (
                    <Bar
                      key={m}
                      dataKey={m}
                      name={marketplaceLabel(m)}
                      stackId="a"
                      fill={["#7c3aed", "#f59e0b", "#10b981", "#0ea5e9"][i]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
