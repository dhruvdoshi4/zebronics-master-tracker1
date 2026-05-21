import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  QCOM_CATEGORY_ANALYSIS_ALL,
  QCOM_SUBCATEGORY_ANALYSIS_ALL,
  isQcomCategoryAnalysisAll,
  isQcomSubCategoryAnalysisAll,
  listQcomCategories,
  listQcomSubCategoriesForCategory,
  qcomCategoryAnalysisLabel,
  type QcomCategoryAnalysisScope,
  type QcomSubCategoryOption,
} from "./data-qcom";
import {
  QcomEntireCategoryScopeControl,
  QcomSubCategoryScopeSelect,
} from "./qcom-analysis-category-scope-filters";
import {
  qcomAnalysisCategoryPath,
  qcomChannelAnalysisCategoryPath,
} from "./qcom-paths";
import { QCOM_CHANNEL_LABELS, type QuickCommerceChannel } from "./tenants";
import type { QcomMarketplace } from "./types";
import {
  Button,
  Card,
  DataAsOnBadge,
  DataAsOnQcomChannelsBadge,
  EmptyState,
  FieldLabel,
  InlineLoader,
  PageTitle,
  Select,
} from "./ui";
import { useLatestUploadSheetCoverageByQcom } from "./use-qcom-sheet-coverage";

export function QcomAnalysisCategoryPage({
  marketplace,
}: {
  /** When set, analysis is scoped to this Quick Commerce tab only. */
  marketplace?: QcomMarketplace;
}) {
  const channelCoverage = useLatestUploadSheetCoverageByQcom();
  const scope: QcomCategoryAnalysisScope | undefined = useMemo(
    () => (marketplace ? { marketplace } : undefined),
    [marketplace],
  );
  const channelLabel = marketplace ? QCOM_CHANNEL_LABELS[marketplace as QuickCommerceChannel] : null;

  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState(QCOM_CATEGORY_ANALYSIS_ALL);
  const [subCategory, setSubCategory] = useState(QCOM_SUBCATEGORY_ANALYSIS_ALL);
  const [subCategoryOptions, setSubCategoryOptions] = useState<QcomSubCategoryOption[]>([]);
  const [loading, setLoading] = useState(true);

  const showSubScopes = !isQcomCategoryAnalysisAll(category);
  const isEntireCategory = isQcomSubCategoryAnalysisAll(subCategory);

  useEffect(() => {
    void listQcomCategories(scope)
      .then((cats) => {
        setCategories(cats);
      })
      .finally(() => setLoading(false));
  }, [scope]);

  useEffect(() => {
    setSubCategory(QCOM_SUBCATEGORY_ANALYSIS_ALL);
  }, [category]);

  useEffect(() => {
    if (!showSubScopes) {
      setSubCategoryOptions([]);
      return;
    }
    void listQcomSubCategoriesForCategory(category, scope)
      .then(setSubCategoryOptions)
      .catch(() => setSubCategoryOptions([]));
  }, [category, showSubScopes, scope]);

  const rollUpPath = marketplace
    ? qcomChannelAnalysisCategoryPath(
        marketplace as QuickCommerceChannel,
        category,
        isEntireCategory ? null : subCategory,
      )
    : qcomAnalysisCategoryPath(category, isEntireCategory ? null : subCategory);

  const singleChannelAsOn =
    marketplace && channelCoverage ? channelCoverage[marketplace] : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title={channelLabel ? `${channelLabel} analysis` : "Category analysis"}
            subtitle={
              channelLabel
                ? `Roll-up sell-out by category on ${channelLabel} — same charts as cross-channel Category analysis.`
                : "Roll-up sell-out by category — Zepto, Blinkit, Instamart and Big Basket combined."
            }
          />
        </div>
        {marketplace && singleChannelAsOn ? (
          <DataAsOnBadge isoDate={singleChannelAsOn} />
        ) : channelCoverage ? (
          <DataAsOnQcomChannelsBadge coverage={channelCoverage} />
        ) : null}
      </div>

      {loading ? (
        <InlineLoader />
      ) : categories.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description={
            channelLabel
              ? `Upload the Quick Commerce master with a ${channelLabel} tab from Upload Center first.`
              : "Upload the Quick Commerce master from Upload Center first."
          }
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
        {channelLabel ? (
          <>
            Category totals roll up daily sellout from the latest <strong>{channelLabel}</strong> master
            upload. Use <strong>Entire category</strong> for the full roll-up, or pick a sub category before
            opening the charts.
          </>
        ) : (
          <>
            Category totals roll up daily sellout by category across Zepto, Blinkit, Big Basket, and
            Instamart in one combined view. Pick a category, use <strong>Entire category</strong> for the
            full roll-up, or choose a sub category before opening the charts.
          </>
        )}
      </Card>
    </div>
  );
}
