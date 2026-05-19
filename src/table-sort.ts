import { useCallback, useMemo, useRef, useState } from "react";

export type SortDirection = "asc" | "desc";

function isMissingSortValue(value: string | number | null | undefined): boolean {
  return value === null || value === undefined || value === "";
}

function toComparableNumber(value: string | number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function compareSortValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  direction: SortDirection,
): number {
  const aMissing = isMissingSortValue(a);
  const bMissing = isMissingSortValue(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  const aNum = toComparableNumber(a as string | number);
  const bNum = toComparableNumber(b as string | number);

  let cmp = 0;
  if (aNum !== null && bNum !== null) {
    cmp = aNum - bNum;
  } else {
    cmp = String(a).localeCompare(String(b), "en-IN", {
      numeric: true,
      sensitivity: "base",
    });
  }
  return direction === "asc" ? cmp : -cmp;
}

export type TableSortAccessors<T> = Record<
  string,
  (row: T) => string | number | null | undefined
>;

export function useTableSort<T>(
  rows: T[],
  accessors: TableSortAccessors<T>,
  defaultKey?: string,
  defaultDirection: SortDirection = "desc",
) {
  const [sortKey, setSortKey] = useState<string | null>(defaultKey ?? null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultDirection);
  const accessorsRef = useRef(accessors);
  accessorsRef.current = accessors;

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    if (!sortKey) return copy;
    const getValue = accessorsRef.current[sortKey];
    if (!getValue) return copy;
    return copy.sort((a, b) =>
      compareSortValues(getValue(a), getValue(b), sortDirection),
    );
  }, [rows, sortKey, sortDirection]);

  const requestSort = useCallback((key: string, direction: SortDirection) => {
    setSortKey(key);
    setSortDirection(direction);
  }, []);

  return { sortedRows, sortKey, sortDirection, requestSort };
}
