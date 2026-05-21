import type { QcomSubCategoryOption } from "./data-qcom";
import { FieldLabel, Select } from "./ui";
import { cn } from "./utils";

export const QCOM_ENTIRE_CATEGORY_LABEL = "Entire category";
const SUB_CATEGORY_PLACEHOLDER = "Select sub category…";

export function QcomEntireCategoryScopeControl({
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
        {QCOM_ENTIRE_CATEGORY_LABEL}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        base,
        "border-zinc-200 bg-white text-zinc-800 hover:border-violet-300 hover:bg-violet-50",
        className,
      )}
    >
      {QCOM_ENTIRE_CATEGORY_LABEL}
    </button>
  );
}

export function QcomSubCategoryScopeSelect({
  options,
  activeSubCategory,
  isEntireCategory,
  onSelectSubCategory,
  disabled,
  className,
}: {
  options: QcomSubCategoryOption[];
  activeSubCategory: string;
  isEntireCategory: boolean;
  onSelectSubCategory: (subCategory: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-[220px]", className)}>
      <FieldLabel>Sub category</FieldLabel>
      <Select
        value={isEntireCategory ? "" : activeSubCategory}
        disabled={disabled || options.length === 0}
        onChange={(e) => {
          const next = e.target.value.trim();
          if (next) onSelectSubCategory(next);
        }}
        className="w-full font-semibold"
        aria-label="Sub category"
      >
        <option value="" disabled={isEntireCategory}>
          {SUB_CATEGORY_PLACEHOLDER}
        </option>
        {options.map((opt) => (
          <option key={opt.subCategory} value={opt.subCategory}>
            {opt.subCategory} ({opt.listingCount})
          </option>
        ))}
      </Select>
    </div>
  );
}
