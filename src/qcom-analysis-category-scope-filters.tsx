import type { QcomSubCategoryOption } from "./data-qcom";
import {
  ENTIRE_CATEGORY_LABEL,
  EntireCategoryScopeControl,
} from "./category-subcategory-filter-controls";
import { FieldLabel, Select } from "./ui";
import { cn } from "./utils";

export const QCOM_ENTIRE_CATEGORY_LABEL = ENTIRE_CATEGORY_LABEL;
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
  return (
    <EntireCategoryScopeControl
      isActive={isActive}
      onSelect={onSelect}
      className={className}
    />
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
