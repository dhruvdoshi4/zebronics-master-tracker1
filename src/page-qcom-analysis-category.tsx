import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  QCOM_CATEGORY_ANALYSIS_ALL,
  QCOM_SUBCATEGORY_ANALYSIS_ALL,
  isQcomCategoryAnalysisAll,
  isQcomSubCategoryAnalysisAll,
  listQcomCategories,
  listQcomSubCategoriesForCategory,
  qcomCategoryAnalysisLabel,
  type QcomSubCategoryOption,
} from "./data-qcom";
import {
  QcomEntireCategoryScopeControl,
  QcomSubCategoryScopeSelect,
} from "./qcom-analysis-category-scope-filters";
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
  const [category, setCategory] = useState(QCOM_CATEGORY_ANALYSIS_ALL);
  const [subCategory, setSubCategory] = useState(QCOM_SUBCATEGORY_ANALYSIS_ALL);
  const [subCategoryOptions, setSubCategoryOptions] = useState<QcomSubCategoryOption[]>([]);
  const [loading, setLoading] = useState(true);

  const showSubScopes = !isQcomCategoryAnalysisAll(category);
  const isEntireCategory = isQcomSubCategoryAnalysisAll(subCategory);

  useEffect(() => {
    void listQcomCategories()
      .then((cats) => {
        setCategories(cats);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setSubCategory(QCOM_SUBCATEGORY_ANALYSIS_ALL);
  }, [category]);

  useEffect(() => {
    if (!showSubScopes) {
      setSubCategoryOptions([]);
      return;
    }
    void listQcomSubCategoriesForCategory(category)
      .then(setSubCategoryOptions)
      .catch(() => setSubCategoryOptions([]));
  }, [category, showSubScopes]);

  const rollUpPath = qcomAnalysisCategoryPath(
    category,
    isEntireCategory ? null : subCategory,
  );

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
              <option value={QCOM_CATEGORY_ANALYSIS_ALL}>
                {qcomCategoryAnalysisLabel(QCOM_CATEGORY_ANALYSIS_ALL)}
              </option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>

          {showSubScopes && subCategoryOptions.length > 0 ? (
            <>
              <div>
                <FieldLabel>Entire category</FieldLabel>
                <QcomEntireCategoryScopeControl
                  isActive={isEntireCategory}
                  onSelect={() => setSubCategory(QCOM_SUBCATEGORY_ANALYSIS_ALL)}
                />
              </div>
              <QcomSubCategoryScopeSelect
                options={subCategoryOptions}
                activeSubCategory={subCategory}
                isEntireCategory={isEntireCategory}
                onSelectSubCategory={setSubCategory}
              />
            </>
          ) : null}

          <Link to={rollUpPath}>
            <Button type="button" className="h-[42px]">
              Open {qcomCategoryAnalysisLabel(category)} roll-up →
            </Button>
          </Link>
        </div>
      )}

      <Card className="text-sm font-medium text-zinc-600">
        Category totals roll up daily sellout by category across Zepto, Blinkit, Big Basket, and Instamart in one combined view.
        Pick a category, use <strong>Entire category</strong> for the full roll-up, or choose a sub category before opening the charts.
      </Card>
    </div>
  );
}
