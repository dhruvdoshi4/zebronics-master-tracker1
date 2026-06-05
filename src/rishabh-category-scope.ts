import {
  CATALOG_WORKSPACE_HOME_AUDIO,
  sheetCategoryHaystack,
  type CatalogWorkspace,
} from "./catalog-workspace";
import {
  BT_SPEAKER_SUB_LABEL,
  isBluetoothSpeakerSub,
  isSpeaker20Sub,
  rowVisibleViaSharedSub,
  SPEAKER_20_SUB_LABEL,
} from "./shared-ecom-subcategory-scope";
import type { LegacyMarketplace } from "./types";
import { normalizeKey } from "./utils";

/**
 * Authoritative Home Audio (Rishabh /app/ha) sub-categories from the sellout master.
 * All modules must expose and filter these six — never omit Trolley or Tower Speaker.
 */
export const RISHABH_HOME_AUDIO_SUB_CATEGORIES = [
  "Mini Soundbar",
  "Multimedia Speaker",
  "Party Speaker",
  "Soundbar",
  "Trolley Speaker",
  "Tower Speaker",
] as const;

export type RishabhHomeAudioSubCategory = (typeof RISHABH_HOME_AUDIO_SUB_CATEGORIES)[number];

export const RISHABH_HOME_AUDIO_SUB_CATEGORY_SET = new Set<string>(
  RISHABH_HOME_AUDIO_SUB_CATEGORIES,
);

export const RISHABH_TOP_CATEGORIES = ["Home Audio", "IT Accessories", "Personal Audio"] as const;

export type RishabhTopCategory = (typeof RISHABH_TOP_CATEGORIES)[number];

/** Rishabh IT Accessories scope — shared speaker accessories. */
export const RISHABH_IT_ACCESSORIES_SUB_CATEGORIES = [
  SPEAKER_20_SUB_LABEL,
] as const;
export const RISHABH_PERSONAL_AUDIO_SUB_CATEGORIES = [BT_SPEAKER_SUB_LABEL] as const;

export type RishabhSubCategoryFilter =
  | RishabhHomeAudioSubCategory
  | "all"
  | typeof SPEAKER_20_SUB_LABEL
  | typeof BT_SPEAKER_SUB_LABEL;

export const RISHABH_SUB_CATEGORY_FILTER_OPTIONS: readonly RishabhSubCategoryFilter[] = [
  "all",
  ...RISHABH_HOME_AUDIO_SUB_CATEGORIES,
  ...RISHABH_IT_ACCESSORIES_SUB_CATEGORIES,
  ...RISHABH_PERSONAL_AUDIO_SUB_CATEGORIES,
] as const;

export const RISHABH_SUB_CATEGORY_FILTER_LABELS: Record<string, string> = {
  all: "All",
  ...Object.fromEntries(RISHABH_HOME_AUDIO_SUB_CATEGORIES.map((s) => [s, s])),
  [SPEAKER_20_SUB_LABEL]: SPEAKER_20_SUB_LABEL,
  [BT_SPEAKER_SUB_LABEL]: BT_SPEAKER_SUB_LABEL,
};

function canonicalRishabhSubCategoryKey(raw: string): string {
  return normalizeKey(raw).replace(/[\s_-]+/g, "");
}

/** Map sheet Sub category labels (and common variants) to the six canonical names. */
export function resolveRishabhCanonicalSubCategory(
  raw: string,
): RishabhHomeAudioSubCategory | null {
  const key = canonicalRishabhSubCategoryKey(raw);
  if (!key) return null;

  if (key.includes("minisoundbar")) return "Mini Soundbar";
  if (key.includes("trolley")) return "Trolley Speaker";
  if (key.includes("tower") && key.includes("speaker")) return "Tower Speaker";
  if (key.includes("tower")) return "Tower Speaker";
  if (key.includes("multimedia")) return "Multimedia Speaker";
  if (key.includes("party")) return "Party Speaker";
  if (key === "soundbar" || key === "soundbars") return "Soundbar";
  if (key.includes("soundbar") && !key.includes("mini")) return "Soundbar";

  return null;
}

/** Infer canonical sub from category + sub + product name when the sheet label is blank or non-standard. */
export function inferRishabhHomeAudioSubCategoryFromHaystack(
  rawCategory: string,
  rawSubCategory: string,
  productName: string,
): RishabhHomeAudioSubCategory | null {
  const fromSub = resolveRishabhCanonicalSubCategory(rawSubCategory);
  if (fromSub) return fromSub;

  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);
  if (/\bmini\s*soundbar\b/.test(hay)) return "Mini Soundbar";
  if (/\btrolley\b/.test(hay)) return "Trolley Speaker";
  if (/\btower\b/.test(hay) && /\bspeaker\b/.test(hay)) return "Tower Speaker";
  if (/\bparty\b/.test(hay) && /\bspeaker\b/.test(hay)) return "Party Speaker";
  if (/\bmultimedia\b/.test(hay)) return "Multimedia Speaker";
  if (/\bsoundbar\b/.test(hay) && !/\bmini\b/.test(hay)) return "Soundbar";
  return null;
}

/** Sheet Category column for Rishabh (Amazon / Flipkart sellout masters). */
export function isRishabhHomeAudioSheetCategory(category: string | null | undefined): boolean {
  const c = normalizeKey(String(category ?? ""));
  return c === "home audio" || c === "homeaudio" || c === "home audio speakers";
}

export function isPersonalAudioSheetCategory(category: string | null | undefined): boolean {
  const c = normalizeKey(String(category ?? ""));
  return c === "personal audio" || c === "personal audio accessories";
}

/**
 * Rishabh scope: entire Home Audio category on AZ + FK.
 * Excludes Personal Audio (Karan) and other managers' top-level categories.
 */
export function rowPassesRishabhCategoryScope(
  rawCategory: string,
  rawSubCategory: string,
  productName: string,
): boolean {
  const cat = String(rawCategory ?? "").trim();
  const sub = String(rawSubCategory ?? "").trim();
  if (isPersonalAudioSheetCategory(cat)) return false;
  if (isRishabhHomeAudioSheetCategory(cat)) return true;
  const hay = sheetCategoryHaystack(cat, sub, productName);
  if (/\bpersonal\s*audio\b/.test(hay)) return false;
  if (/\bhome\s*audio\b/.test(hay)) return true;
  return false;
}

/** True when row is a Home Audio speaker SKU that must not roll into Rithika IT Accessories. */
export function isRishabhHomeAudioSpeakerProduct(
  rawCategory: string,
  rawSubCategory: string,
  productName: string,
): boolean {
  if (!rowPassesRishabhCategoryScope(rawCategory, rawSubCategory, productName)) {
    return false;
  }
  return (
    inferRishabhHomeAudioSubCategoryFromHaystack(rawCategory, rawSubCategory, productName) != null
  );
}

export function rowPassesRishabhItAccessoriesScope(
  rawCategory: string,
  rawSubCategory: string,
  productName: string,
): boolean {
  if (!isSpeaker20Sub(rawSubCategory, rawCategory, productName)) return false;
  if (isPersonalAudioSheetCategory(rawCategory)) return false;
  const canonical = inferRishabhHomeAudioSubCategoryFromHaystack(
    rawCategory,
    rawSubCategory,
    productName,
  );
  if (canonical === "Multimedia Speaker") return false;
  return true;
}

export function rowPassesRishabhPersonalAudioScope(
  rawCategory: string,
  rawSubCategory: string,
  productName: string,
): boolean {
  return isBluetoothSpeakerSub(rawSubCategory, rawCategory, productName);
}

export function rishabhTopCategoryForSub(sub: string): RishabhTopCategory | null {
  if (normalizeKey(sub) === normalizeKey(BT_SPEAKER_SUB_LABEL)) return "Personal Audio";
  if (normalizeKey(sub) === normalizeKey(SPEAKER_20_SUB_LABEL)) return "IT Accessories";
  if (resolveRishabhCanonicalSubCategory(sub)) return "Home Audio";
  if (RISHABH_HOME_AUDIO_SUB_CATEGORY_SET.has(sub)) return "Home Audio";
  return null;
}

/** Stored sub_category = canonical sheet Sub Category label. */
export function normalizedRishabhSubCategory(
  rawSubCategory: string,
  rawCategory: string,
  productName: string,
): string | null {
  if (rowPassesRishabhPersonalAudioScope(rawCategory, rawSubCategory, productName)) {
    return BT_SPEAKER_SUB_LABEL;
  }
  if (rowPassesRishabhItAccessoriesScope(rawCategory, rawSubCategory, productName)) {
    return SPEAKER_20_SUB_LABEL;
  }
  if (!rowPassesRishabhCategoryScope(rawCategory, rawSubCategory, productName)) {
    return null;
  }
  const canonical = inferRishabhHomeAudioSubCategoryFromHaystack(
    rawCategory,
    rawSubCategory,
    productName,
  );
  if (canonical) return canonical;
  const sub = String(rawSubCategory ?? "").trim();
  if (sub) return sub;
  if (isRishabhHomeAudioSheetCategory(rawCategory)) {
    return "Home Audio";
  }
  return null;
}

function rishabhScopeMatchesRow(row: {
  category?: string | null;
  sub_category?: string | null;
  product_name?: string | null;
}): boolean {
  const cat = String(row.category ?? "");
  const sub = String(row.sub_category ?? "");
  const name = String(row.product_name ?? "");
  return (
    rowPassesRishabhPersonalAudioScope(cat, sub, name) ||
    rowPassesRishabhItAccessoriesScope(cat, sub, name) ||
    rowPassesRishabhCategoryScope(cat, sub, name)
  );
}

export function productMatchesRishabhDashboardScopeForMarketplace(
  row: {
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
    catalog_workspace?: string | null;
  },
  marketplace: LegacyMarketplace,
): boolean {
  if (rowVisibleViaSharedSub(CATALOG_WORKSPACE_HOME_AUDIO, row, marketplace)) {
    return true;
  }
  return rishabhScopeMatchesRow(row);
}

/** Category analysis / dashboard filter: match canonical sub-category label. */
export function productMatchesRishabhCategoryRollup(
  subCategoryFilter: string,
  row: Pick<
    { category?: string | null; sub_category?: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
): boolean {
  if (
    !productMatchesRishabhDashboardScopeForMarketplace(row, "amazon") &&
    !productMatchesRishabhDashboardScopeForMarketplace(row, "flipkart")
  ) {
    return false;
  }
  const filter = String(subCategoryFilter ?? "").trim();
  if (!filter || filter === "all") return true;

  const rowCanonical =
    resolveRishabhCanonicalSubCategory(String(row.sub_category ?? "")) ??
    inferRishabhHomeAudioSubCategoryFromHaystack(
      String(row.category ?? ""),
      String(row.sub_category ?? ""),
      String(row.product_name ?? ""),
    );
  const filterCanonical = resolveRishabhCanonicalSubCategory(filter) ?? filter;
  if (
    normalizeKey(filterCanonical) === normalizeKey(BT_SPEAKER_SUB_LABEL) &&
    isBluetoothSpeakerSub(
      String(row.sub_category ?? ""),
      String(row.category ?? ""),
      String(row.product_name ?? ""),
    )
  ) {
    return true;
  }
  if (!rowCanonical) return false;
  return (
    canonicalRishabhSubCategoryKey(rowCanonical) ===
    canonicalRishabhSubCategoryKey(filterCanonical)
  );
}

/** Always return all six canonical subs, then any extra sheet-only labels (sorted). */
export function orderedRishabhSubCategories(sheetSubs: Iterable<string> = []): string[] {
  const extras = new Set<string>();
  for (const raw of sheetSubs) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) continue;
    const canonical = resolveRishabhCanonicalSubCategory(trimmed);
    if (canonical) continue;
    extras.add(trimmed);
  }
  return [...RISHABH_HOME_AUDIO_SUB_CATEGORIES, ...[...extras].sort((a, b) => a.localeCompare(b))];
}

/** Dashboard sub filter — canonical subs per top category (not limited to loaded PO rows). */
export function rishabhDashboardSubCategoryDisplayOptions(topCategory: string): string[] {
  const sort = (a: string, b: string) =>
    a.localeCompare(b, "en-IN", { numeric: true, sensitivity: "base" });
  if (topCategory === "all") {
    return [
      ...RISHABH_HOME_AUDIO_SUB_CATEGORIES,
      ...RISHABH_IT_ACCESSORIES_SUB_CATEGORIES,
      ...RISHABH_PERSONAL_AUDIO_SUB_CATEGORIES,
    ].sort(sort);
  }
  if (normalizeKey(topCategory) === normalizeKey("Home Audio")) {
    return [...RISHABH_HOME_AUDIO_SUB_CATEGORIES];
  }
  if (normalizeKey(topCategory) === normalizeKey("IT Accessories")) {
    return [...RISHABH_IT_ACCESSORIES_SUB_CATEGORIES];
  }
  if (normalizeKey(topCategory) === normalizeKey("Personal Audio")) {
    return [...RISHABH_PERSONAL_AUDIO_SUB_CATEGORIES];
  }
  return [];
}

export function parseRishabhSubCategoryFilterParam(
  raw: string | null | undefined,
): RishabhSubCategoryFilter | null {
  const decoded = raw != null ? decodeURIComponent(raw) : "";
  if (decoded === "all") return "all";
  const trimmed = decoded.trim();
  if (!trimmed) return null;
  const canonical = resolveRishabhCanonicalSubCategory(trimmed);
  if (canonical) return canonical;
  if (RISHABH_HOME_AUDIO_SUB_CATEGORY_SET.has(trimmed)) {
    return trimmed as RishabhHomeAudioSubCategory;
  }
  return trimmed as RishabhSubCategoryFilter;
}

export function isRishabhWorkspace(workspace: CatalogWorkspace): boolean {
  return workspace === CATALOG_WORKSPACE_HOME_AUDIO;
}
