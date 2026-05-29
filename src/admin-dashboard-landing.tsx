import {
  ADMIN_MANAGER_OPTIONS,
  type AdminDashboardViewMode,
} from "./admin-realm";
import type { CatalogWorkspace } from "./catalog-workspace";
import { CategorySubCategoryFilterControls } from "./category-subcategory-filter-controls";
import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  analysisCategoryLabel,
  analysisSubCategoryLabel,
} from "./analysis-category-paths";
import { Button, Card, FieldLabel, Select } from "./ui";
import { cn } from "./utils";

export function AdminDashboardLanding({
  marketplaceLabel,
  viewMode,
  onViewModeChange,
  selectedWorkspace,
  onWorkspaceChange,
  onContinue,
  categorySegment,
  categories,
  categoryLabels,
  onCategorySegmentChange,
  sheetSubCategory,
  subCategoryOptions,
  onSheetSubCategoryChange,
  categoryFiltersLoading,
}: {
  marketplaceLabel: string;
  viewMode: AdminDashboardViewMode | null;
  onViewModeChange: (mode: AdminDashboardViewMode) => void;
  selectedWorkspace: CatalogWorkspace | "";
  onWorkspaceChange: (workspace: CatalogWorkspace) => void;
  onContinue: () => void;
  categorySegment: string;
  categories: string[];
  categoryLabels: Record<string, string>;
  onCategorySegmentChange: (segment: string) => void;
  sheetSubCategory: string;
  subCategoryOptions: string[];
  onSheetSubCategoryChange: (sub: string) => void;
  categoryFiltersLoading: boolean;
}) {
  const canContinueManager = viewMode === "manager" && selectedWorkspace !== "";
  const canContinueCategory = viewMode === "category";

  return (
    <Card className="space-y-5 border-violet-200 bg-violet-50/40 dark:border-violet-800 dark:bg-violet-950/30">
      <div>
        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
          {marketplaceLabel} dashboard — admin view
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Choose how to scope data. daWg and Quick Commerce channel data are not included here.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(
            "rounded-xl px-4 py-2 text-sm font-semibold transition",
            viewMode === "manager"
              ? "bg-violet-600 text-white shadow-sm"
              : "border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50",
          )}
          onClick={() => onViewModeChange("manager")}
        >
          View by Manager
        </button>
        <button
          type="button"
          className={cn(
            "rounded-xl px-4 py-2 text-sm font-semibold transition",
            viewMode === "category"
              ? "bg-violet-600 text-white shadow-sm"
              : "border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50",
          )}
          onClick={() => onViewModeChange("category")}
        >
          View by Category
        </button>
      </div>

      {viewMode === "manager" ? (
        <div className="max-w-md space-y-2">
          <FieldLabel>Manager</FieldLabel>
          <Select
            value={selectedWorkspace}
            onChange={(event) =>
              onWorkspaceChange(event.target.value as CatalogWorkspace)
            }
          >
            <option value="">Select a manager…</option>
            {ADMIN_MANAGER_OPTIONS.map((option) => (
              <option key={option.workspace} value={option.workspace}>
                {option.managerName} — {option.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-zinc-500">
            Dashboard KPIs and tables match the selected manager&apos;s workspace.
          </p>
        </div>
      ) : null}

      {viewMode === "category" ? (
        <div className="space-y-2">
          {categoryFiltersLoading ? (
            <p className="text-sm text-zinc-500">Loading categories…</p>
          ) : (
            <CategorySubCategoryFilterControls
              category={categorySegment}
              categories={categories}
              categoryLabels={categoryLabels}
              onCategoryChange={onCategorySegmentChange}
              subCategory={sheetSubCategory}
              subCategoryOptions={subCategoryOptions}
              onSubCategoryChange={onSheetSubCategoryChange}
              showSubCategory
            />
          )}
          <p className="text-xs text-zinc-500">
            Viewing {analysisCategoryLabel(categorySegment)} ·{" "}
            {analysisSubCategoryLabel(sheetSubCategory)} across all managers.
          </p>
        </div>
      ) : null}

      {viewMode ? (
        <Button
          type="button"
          disabled={!canContinueManager && !canContinueCategory}
          onClick={onContinue}
        >
          Open dashboard
        </Button>
      ) : null}
    </Card>
  );
}
