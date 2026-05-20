import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listQcomCategories } from "./data-qcom";
import { qcomAnalysisCategoryPath } from "./qcom-paths";
import {
  Button,
  Card,
  DataAsOnQcomChannelsBadge,
  EmptyState,
  FieldLabel,
  InlineLoader,
  PageTitle,
  Select,
} from "./ui";
import { useLatestUploadSheetCoverageByQcom } from "./use-qcom-sheet-coverage";

export function QcomAnalysisCategoryPage() {
  const channelCoverage = useLatestUploadSheetCoverageByQcom();
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void listQcomCategories()
      .then((cats) => {
        setCategories(cats);
        if (cats[0]) setCategory(cats[0]);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Category analysis"
            subtitle="Roll-up sell-out by category — Zepto, Blinkit, Instamart and Big Basket combined."
          />
        </div>
        {channelCoverage ? <DataAsOnQcomChannelsBadge coverage={channelCoverage} /> : null}
      </div>

      {loading ? (
        <InlineLoader />
      ) : categories.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Upload the Quick Commerce master from Upload Center first."
        />
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px]">
            <FieldLabel>Category</FieldLabel>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <Link to={qcomAnalysisCategoryPath(category)}>
            <Button type="button" className="h-[42px]" disabled={!category}>
              Open {category || "category"} roll-up →
            </Button>
          </Link>
        </div>
      )}

      <Card className="text-sm font-medium text-zinc-600">
        Category totals roll up daily sellout by category across Zepto, Blinkit, Big Basket, and Instamart in one combined view.
      </Card>
    </div>
  );
}
