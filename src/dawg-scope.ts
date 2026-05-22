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

/** Analysis / category roll-up filter keys (URL segment under /app/analysis/category/). */
export type DawgAnalysisFilterKey =
  | "all"
  | "gaming-dawg"
  | "personal-audio"
  | "gaming-mouse"
  | "gaming-keyboard"
  | "gaming-headphone"
  | "gaming-chassis"
  | "gaming-mousepad"
  | "aio-cooler";

export function parseDawgAnalysisFilterParam(raw: string | undefined): string | null {
  if (!raw) return null;
  const key = decodeURIComponent(raw).trim().toLowerCase();
  return DAWG_ANALYSIS_FILTER_OPTIONS.some((o) => o.key === key) ? key : null;
}

export function dawgAnalysisFilterLabel(filterKey: string): string {
  return (
    DAWG_ANALYSIS_FILTER_OPTIONS.find((o) => o.key === filterKey)?.label ?? filterKey
  );
}

export const DAWG_ANALYSIS_FILTER_OPTIONS: ReadonlyArray<{
  key: DawgAnalysisFilterKey;
  label: string;
}> = [
  { key: "all", label: "All daWg" },
  { key: "gaming-dawg", label: "Gaming - daWg (all subs)" },
  { key: "personal-audio", label: "Personal Audio" },
  { key: "gaming-mouse", label: "Gaming Mouse" },
  { key: "gaming-keyboard", label: "Gaming Keyboard" },
  { key: "gaming-headphone", label: "Gaming Headphone" },
  { key: "gaming-chassis", label: "Gaming Chassis" },
  { key: "gaming-mousepad", label: "Gaming Mousepad" },
  { key: "aio-cooler", label: "AIO Cooler" },
];

const DAWG_SUB_BY_FILTER: Partial<Record<DawgAnalysisFilterKey, string>> = {
  "gaming-mouse": "Gaming Mouse",
  "gaming-keyboard": "Gaming Keyboard",
  "gaming-headphone": "Gaming Headphone",
  "gaming-chassis": "Gaming Chassis",
  "gaming-mousepad": "Gaming Mousepad",
  "aio-cooler": "AIO Cooler",
};

export function productMatchesDawgAnalysisFilter(
  filterKey: string,
  row: { category?: string | null; sub_category?: string | null },
): boolean {
  if (!productMatchesDawgScope(row)) return false;
  const key = normalizeKey(filterKey);
  if (key === "all") return true;
  if (key === "gaming-dawg") {
    return normalizeKey(row.category ?? "") === normalizeKey("Gaming - daWg");
  }
  if (key === "personal-audio") {
    return normalizeKey(row.category ?? "") === normalizeKey("Personal Audio");
  }
  const sub = DAWG_SUB_BY_FILTER[filterKey as DawgAnalysisFilterKey];
  if (sub) {
    return normalizeKey(row.sub_category ?? "") === normalizeKey(sub);
  }
  return false;
}
