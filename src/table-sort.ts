import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export function compareSortValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  direction: SortDirection,
): number {
  const aMissing = a === null || a === undefined || a === "";
  const bMissing = b === null || b === undefined || b === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  let cmp = 0;
  if (typeof a === "number" && typeof b === "number") {
    cmp = a - b;
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

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const getValue = accessors[sortKey];
    if (!getValue) return rows;
    return [...rows].sort((a, b) =>
      compareSortValues(getValue(a), getValue(b), sortDirection),
    );
  }, [rows, sortKey, sortDirection, accessors]);

  const requestSort = (key: string, direction: SortDirection) => {
    setSortKey(key);
    setSortDirection(direction);
  };

  return { sortedRows, sortKey, sortDirection, requestSort };
}
