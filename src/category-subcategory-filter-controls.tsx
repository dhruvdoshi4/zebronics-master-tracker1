import { FieldLabel, Select } from "./ui";
import { cn } from "./utils";

export const ENTIRE_CATEGORY_LABEL = "Entire category";

export function EntireCategoryScopeControl({
  isActive,
  onSelect,
  className,
}: {
  isActive: boolean;
  onSelect: () => void;
  className?: string;
}) {
  const base =
    "inline-flex h-[42px] min-w-[10.5rem] items-center justify-center rounded-xl border px-4 text-sm font-semibold transition";

  if (isActive) {
    return (
      <span
        className={cn(
          base,
          "cursor-default border-violet-600 bg-violet-600 text-white shadow-sm shadow-violet-500/20",
          className,
        )}
        aria-current="page"
      >
        {ENTIRE_CATEGORY_LABEL}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        base,
        "border-zinc-200 bg-white text-zinc-800 hover:border-violet-300 hover:bg-violet-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-violet-500 dark:hover:bg-violet-950/40",
        className,
      )}
    >
      {ENTIRE_CATEGORY_LABEL}
    </button>
  );
}

/** Category → Entire category → Sub category (sheet labels from master / ratings). */
export function CategorySubCategoryFilterControls({
  category,
  categories,
  onCategoryChange,
  subCategory,
  subCategoryOptions,
  onSubCategoryChange,
  showSubCategory,
  showEntireCategory,
  isEntireCategory,
  onSelectEntireCategory,
  categoryLabel = "Category",
  subCategoryLabel = "Sub category",
}: {
  category: string;
  categories: string[];
  onCategoryChange: (value: string) => void;
  subCategory: string;
  subCategoryOptions: string[];
  onSubCategoryChange: (value: string) => void;
  showSubCategory: boolean;
  showEntireCategory?: boolean;
  isEntireCategory?: boolean;
  onSelectEntireCategory?: () => void;
  categoryLabel?: string;
  subCategoryLabel?: string;
}) {
  return (
    <>
      <div className="min-w-[180px]">
        <FieldLabel>{categoryLabel}</FieldLabel>
        <Select value={category} onChange={(e) => onCategoryChange(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === "all" ? "All categories" : c}
            </option>
          ))}
        </Select>
      </div>
      {showEntireCategory && onSelectEntireCategory ? (
        <div>
          <FieldLabel>{ENTIRE_CATEGORY_LABEL}</FieldLabel>
          <EntireCategoryScopeControl
            isActive={!!isEntireCategory}
            onSelect={onSelectEntireCategory}
          />
        </div>
      ) : null}
      {showSubCategory ? (
        <div className="min-w-[200px]">
          <FieldLabel>{subCategoryLabel}</FieldLabel>
          <Select
            value={isEntireCategory ? "all" : subCategory}
            disabled={subCategoryOptions.length === 0}
            onChange={(e) => onSubCategoryChange(e.target.value)}
            aria-label={subCategoryLabel}
          >
            <option value="all">All sub categories</option>
            {subCategoryOptions.map((sub) => (
              <option key={sub} value={sub}>
                {sub}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
    </>
  );
}
