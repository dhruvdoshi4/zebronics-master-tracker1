import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Layers, LineChart } from "lucide-react";
import { listQcomCategories } from "./data-qcom";
import { qcomAnalysisCategoryPath, qcomLookupPath } from "./qcom-paths";
import { Card, EmptyState, InlineLoader, PageTitle } from "./ui";

export function QcomAnalysisHubPage() {
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void listQcomCategories()
      .then(setCategories)
      .finally(() => setLoading(false));
  }, []);

  const preview = useMemo(() => categories.slice(0, 8), [categories]);

  return (
    <div className="space-y-6">
      <PageTitle
        title="Data analysis"
        subtitle="Category roll-ups across Zepto, Blinkit, Instamart and Big Basket — no sub-category split."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          to="/app/qcom/analysis/category"
          className="rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-50 to-white p-6 shadow-sm transition hover:shadow-md"
        >
          <Layers className="h-8 w-8 text-violet-700" />
          <h2 className="mt-4 text-xl font-bold">Category analysis</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Combined sell-out by category (Audio, PC, Gaming, …) across all quick commerce channels.
          </p>
        </Link>

        <Link
          to={qcomLookupPath()}
          className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-white p-6 shadow-sm transition hover:shadow-md"
        >
          <LineChart className="h-8 w-8 text-emerald-700" />
          <h2 className="mt-4 text-xl font-bold">Sellout &amp; growth analysis</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Search a model and open sellout charts on any quick commerce channel.
          </p>
        </Link>
      </div>

      <Card className="space-y-3">
        <h3 className="font-semibold text-zinc-900">Categories in master</h3>
        {loading ? (
          <InlineLoader />
        ) : categories.length === 0 ? (
          <EmptyState title="No categories yet" description="Upload the Quick Commerce master first." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {preview.map((cat) => (
              <Link
                key={cat}
                to={qcomAnalysisCategoryPath(cat)}
                className="rounded-full bg-violet-100 px-3 py-1 text-sm font-semibold text-violet-800 hover:bg-violet-200"
              >
                {cat}
              </Link>
            ))}
            {categories.length > preview.length ? (
              <span className="text-sm text-zinc-500">+{categories.length - preview.length} more</span>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
