import { normalizeKey } from "./utils";

export const DAWG_SHEET_CATEGORIES = ["Gaming - daWg", "Personal Audio"] as const;

export type DawgSheetCategory = (typeof DAWG_SHEET_CATEGORIES)[number];

export function normalizeDawgCategoryLabel(category: string | null | undefined): string {
  return String(category ?? "").trim();
}

export function isDawgSheetCategory(category: string | null | undefined): boolean {
  const c = normalizeDawgCategoryLabel(category);
  if (!c) return false;
  return DAWG_SHEET_CATEGORIES.some(
    (allowed) => normalizeKey(allowed) === normalizeKey(c),
  );
}

export function productMatchesDawgScope(
  row: { category?: string | null; sub_category?: string | null },
): boolean {
  return isDawgSheetCategory(row.category);
}
