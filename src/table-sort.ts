import { useCallback, useMemo, useRef, useState } from "react";

export type SortDirection = "asc" | "desc";

function isMissingSortValue(value: string | number | null | undefined): boolean {
  return value === null || value === undefined || value === "";
}

function toComparableNumber(value: string | number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/,/g, "");
    if (trimmed === "" || !/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export type SortCompareMode = "auto" | "text";

export function compareSortValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  direction: SortDirection,
  mode: SortCompareMode = "auto",
  options?: { numericText?: boolean },
): number {
  const aMissing = isMissingSortValue(a);
  const bMissing = isMissingSortValue(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  let cmp = 0;
  if (mode === "text") {
    cmp = String(a).localeCompare(String(b), "en-IN", {
      numeric: options?.numericText ?? false,
      sensitivity: "base",
    });
  } else {
    const aNum = toComparableNumber(a as string | number);
    const bNum = toComparableNumber(b as string | number);
    if (aNum !== null && bNum !== null) {
      cmp = aNum - bNum;
    } else {
      cmp = String(a).localeCompare(String(b), "en-IN", {
        numeric: true,
        sensitivity: "base",
      });
    }
  }
  return direction === "asc" ? cmp : -cmp;
}

export type TableSortAccessors<T> = Record<
  string,
  (row: T) => string | number | null | undefined
>;

export type UseTableSortOptions<T> = {
  /** Always alphabetical (never numeric) for these sort keys — e.g. category labels. */
  textSortKeys?: string[];
  /** Text sort with numeric chunks ordered naturally (A–Z, 1, 2, 10) — e.g. model names. */
  naturalTextSortKeys?: string[];
  /** Secondary ascending sort when primary values tie. */
  tieBreaker?: (row: T) => string | number | null | undefined;
};

export function useTableSort<T>(
  rows: T[],
  accessors: TableSortAccessors<T>,
  defaultKey?: string,
  defaultDirection: SortDirection = "desc",
  options?: UseTableSortOptions<T>,
) {
  const [sortKey, setSortKey] = useState<string | null>(defaultKey ?? null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultDirection);
  const accessorsRef = useRef(accessors);
  accessorsRef.current = accessors;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    if (!sortKey) return copy;
    const getValue = accessorsRef.current[sortKey];
    if (!getValue) return copy;
    const textKeys = optionsRef.current?.textSortKeys ?? [];
    const naturalKeys = optionsRef.current?.naturalTextSortKeys ?? [];
    const mode: SortCompareMode =
      textKeys.includes(sortKey) || naturalKeys.includes(sortKey) ? "text" : "auto";
    const numericText = naturalKeys.includes(sortKey);
    const tieBreaker = optionsRef.current?.tieBreaker;
    return copy.sort((a, b) => {
      const primary = compareSortValues(
        getValue(a),
        getValue(b),
        sortDirection,
        mode,
        { numericText },
      );
      if (primary !== 0) return primary;
      if (!tieBreaker) return 0;
      return compareSortValues(tieBreaker(a), tieBreaker(b), "asc", "text", {
        numericText: true,
      });
    });
  }, [rows, sortKey, sortDirection]);

  const requestSort = useCallback((key: string, direction: SortDirection) => {
    setSortKey(key);
    setSortDirection(direction);
  }, []);

  return { sortedRows, sortKey, sortDirection, requestSort };
}
