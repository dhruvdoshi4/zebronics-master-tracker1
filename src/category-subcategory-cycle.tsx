import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { SortDirection } from "./table-sort";
import { cn } from "./utils";

export function sortLabelsAlphabetically(labels: string[]): string[] {
  return [...labels].sort((a, b) =>
    a.localeCompare(b, "en-IN", { numeric: true, sensitivity: "base" }),
  );
}

export function cycleListIndex(
  prev: number | null,
  direction: SortDirection,
  length: number,
): number | null {
  if (length === 0) return null;
  if (prev === null) {
    return direction === "asc" ? 0 : length - 1;
  }
  if (direction === "asc") {
    return (prev + 1) % length;
  }
  return (prev - 1 + length) % length;
}

export function DimensionCycleTableHeader({
  defaultLabel,
  valueList,
  cycleIndex,
  lastDirection,
  onCycle,
  stepAriaLabel,
  className,
}: {
  defaultLabel: string;
  valueList: string[];
  cycleIndex: number | null;
  lastDirection: SortDirection | null;
  onCycle: (direction: SortDirection) => void;
  stepAriaLabel: string;
  className?: string;
}) {
  const isCycling = cycleIndex !== null;
  const activeLabel =
    isCycling && valueList[cycleIndex] ? valueList[cycleIndex] : defaultLabel;

  const btnClass = (dir: SortDirection) =>
    cn(
      "rounded p-0.5 transition",
      isCycling && lastDirection === dir
        ? "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200"
        : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
    );

  return (
    <th className={cn("px-2 py-2.5 align-middle text-left", className)}>
      <div className="inline-flex items-center gap-1">
        <span
          className="max-w-[7rem] truncate text-sm font-bold uppercase tracking-wide"
          title={activeLabel}
        >
          {activeLabel}
        </span>
        {isCycling && valueList.length > 0 ? (
          <span className="text-[10px] font-semibold text-violet-700 dark:text-violet-300">
            {cycleIndex! + 1}/{valueList.length}
          </span>
        ) : null}
        <span className="inline-flex flex-col" role="group" aria-label={stepAriaLabel}>
          <button
            type="button"
            className={btnClass("asc")}
            aria-label={`Next ${defaultLabel} A to Z`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCycle("asc");
            }}
          >
            <ChevronUp className="h-3 w-3" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            className={btnClass("desc")}
            aria-label={`Previous ${defaultLabel} Z to A`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCycle("desc");
            }}
          >
            <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
          </button>
        </span>
      </div>
    </th>
  );
}

export type CategorySubCategoryCycleOptions<T> = {
  rows: T[];
  getCategory: (row: T) => string | null | undefined;
  getSubCategory: (row: T) => string | null | undefined;
  /** Extra filter before category logic (e.g. monitor / projector scope). */
  preFilter?: (row: T) => boolean;
};

export function useCategorySubCategoryCycle<T>({
  rows,
  getCategory,
  getSubCategory,
  preFilter,
}: CategorySubCategoryCycleOptions<T>) {
  const [category, setCategoryState] = useState("all");
  const [categoryCycleIndex, setCategoryCycleIndex] = useState<number | null>(null);
  const [categoryCycleDirection, setCategoryCycleDirection] =
    useState<SortDirection | null>(null);
  const [subCategoryCycleIndex, setSubCategoryCycleIndex] = useState<number | null>(null);
  const [subCategoryCycleDirection, setSubCategoryCycleDirection] =
    useState<SortDirection | null>(null);

  const scopedRows = useMemo(() => {
    if (!preFilter) return rows;
    return rows.filter(preFilter);
  }, [rows, preFilter]);

  const categoryList = useMemo(() => {
    const set = new Set<string>();
    for (const row of scopedRows) {
      const c = getCategory(row)?.trim();
      if (c) set.add(c);
    }
    return sortLabelsAlphabetically([...set]);
  }, [scopedRows, getCategory]);

  const categories = useMemo(() => ["all", ...categoryList], [categoryList]);

  const rowsInSelectedCategory = useMemo(() => {
    if (category === "all") return [];
    return scopedRows.filter((r) => getCategory(r)?.trim() === category);
  }, [scopedRows, category, getCategory]);

  const subCategoryList = useMemo(() => {
    const set = new Set<string>();
    for (const row of rowsInSelectedCategory) {
      const sub = getSubCategory(row)?.trim();
      if (sub) set.add(sub);
    }
    return sortLabelsAlphabetically([...set]);
  }, [rowsInSelectedCategory, getSubCategory]);

  const setCategory = useCallback((value: string) => {
    setCategoryState(value);
    setCategoryCycleIndex(null);
    setCategoryCycleDirection(null);
    setSubCategoryCycleIndex(null);
    setSubCategoryCycleDirection(null);
  }, []);

  useEffect(() => {
    setCategoryCycleIndex(null);
    setCategoryCycleDirection(null);
    setSubCategoryCycleIndex(null);
    setSubCategoryCycleDirection(null);
  }, [category]);

  const activeTableCategory = useMemo(() => {
    if (category !== "all") return category;
    if (categoryCycleIndex === null) return "all";
    return categoryList[categoryCycleIndex] ?? "all";
  }, [category, categoryCycleIndex, categoryList]);

  const filteredRows = useMemo(() => {
    let list = scopedRows;
    if (category === "all") {
      if (activeTableCategory !== "all") {
        list = list.filter((r) => getCategory(r)?.trim() === activeTableCategory);
      }
    } else {
      list = list.filter((r) => getCategory(r)?.trim() === category);
      if (subCategoryCycleIndex !== null) {
        const sub = subCategoryList[subCategoryCycleIndex];
        if (sub) list = list.filter((r) => getSubCategory(r)?.trim() === sub);
      }
    }
    return list;
  }, [
    scopedRows,
    category,
    activeTableCategory,
    subCategoryCycleIndex,
    subCategoryList,
    getCategory,
    getSubCategory,
  ]);

  const handleCategoryCycle = useCallback(
    (direction: SortDirection) => {
      if (category !== "all" || categoryList.length === 0) return;
      setCategoryCycleDirection(direction);
      setCategoryCycleIndex((prev) =>
        cycleListIndex(prev, direction, categoryList.length),
      );
    },
    [category, categoryList],
  );

  const handleSubCategoryCycle = useCallback(
    (direction: SortDirection) => {
      if (category === "all" || subCategoryList.length === 0) return;
      setSubCategoryCycleDirection(direction);
      setSubCategoryCycleIndex((prev) =>
        cycleListIndex(prev, direction, subCategoryList.length),
      );
    },
    [category, subCategoryList],
  );

  const scopeLabel = useMemo(() => {
    if (category === "all" && categoryCycleIndex !== null && categoryList[categoryCycleIndex]) {
      return categoryList[categoryCycleIndex];
    }
    if (category === "all") return "All";
    if (subCategoryCycleIndex !== null && subCategoryList[subCategoryCycleIndex]) {
      return `${category} · ${subCategoryList[subCategoryCycleIndex]}`;
    }
    return category;
  }, [
    category,
    categoryCycleIndex,
    categoryList,
    subCategoryCycleIndex,
    subCategoryList,
  ]);

  const activeCycleBadge = useMemo(() => {
    if (category === "all" && categoryCycleIndex !== null && categoryList[categoryCycleIndex]) {
      return categoryList[categoryCycleIndex];
    }
    if (
      category !== "all" &&
      subCategoryCycleIndex !== null &&
      subCategoryList[subCategoryCycleIndex]
    ) {
      return subCategoryList[subCategoryCycleIndex];
    }
    return null;
  }, [category, categoryCycleIndex, categoryList, subCategoryCycleIndex, subCategoryList]);

  const showSubCategoryColumn = category !== "all";

  const getDimensionCellValue = useCallback(
    (row: T) => {
      if (showSubCategoryColumn) {
        return getSubCategory(row)?.trim() || "—";
      }
      return getCategory(row)?.trim() || "—";
    },
    [showSubCategoryColumn, getCategory, getSubCategory],
  );

  return {
    category,
    setCategory,
    categories,
    categoryList,
    subCategoryList,
    filteredRows,
    activeTableCategory,
    categoryCycleIndex,
    categoryCycleDirection,
    subCategoryCycleIndex,
    subCategoryCycleDirection,
    handleCategoryCycle,
    handleSubCategoryCycle,
    scopeLabel,
    activeCycleBadge,
    showSubCategoryColumn,
    getDimensionCellValue,
  };
}
