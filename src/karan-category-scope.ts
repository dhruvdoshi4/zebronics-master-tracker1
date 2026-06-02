import {
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  sheetCategoryHaystack,
  type CatalogWorkspace,
} from "./catalog-workspace";
import {
  GAMING_HEADPHONE_SUB_LABEL,
  isGamingHeadphoneSub,
  isPortableFanSub,
  rowVisibleViaSharedSub,
} from "./shared-ecom-subcategory-scope";
import { isPravinManagedRomaSub } from "./pravin-category-scope";
import type { LegacyMarketplace } from "./types";
import { normalizeKey } from "./utils";

export const KARAN_TOP_CATEGORIES = [
  "Personal Audio",
  "Home Automation",
  "Misc",
  "IT Accessories",
] as const;

export type KaranTopCategory = (typeof KARAN_TOP_CATEGORIES)[number];

export const PORTABLE_FAN_SUB_LABEL = "Portable Fan";

/** Misc — sheet Sub category labels (Car Charger is Karan-only; ROMA has its own Car Charger). */
export const KARAN_MISC_SUB_CATEGORIES = [
  "Car Charger",
  "Car Media Receiver",
  "Tyre Inflator",
  PORTABLE_FAN_SUB_LABEL,
] as const;

export const KARAN_KEYED_SUB_CATEGORIES = [
  "personal_audio_tws",
  "personal_audio_bt_speaker",
  "personal_audio_bt_headphone",
  "personal_audio_wired_earphone",
  "personal_audio_wired_headphone",
  "personal_audio_bt_earphone",
  "personal_audio_mic",
  "home_automation_camera",
  "home_automation_switch",
  "home_automation_doorbell",
  "gaming_headphone",
] as const;

export type KaranKeyedSubCategory = (typeof KARAN_KEYED_SUB_CATEGORIES)[number];

export type KaranSubCategory = KaranKeyedSubCategory | (typeof KARAN_MISC_SUB_CATEGORIES)[number];

export const KARAN_TRACKED_SUB_CATEGORIES: readonly string[] = [
  ...KARAN_KEYED_SUB_CATEGORIES,
  ...KARAN_MISC_SUB_CATEGORIES,
];

export const KARAN_TRACKED_SUB_CATEGORY_SET = new Set<string>(KARAN_TRACKED_SUB_CATEGORIES);

export const KARAN_SUB_CATEGORY_LABELS: Record<string, string> = {
  personal_audio_tws: "TWS",
  personal_audio_bt_speaker: "Bluetooth speakers",
  personal_audio_bt_headphone: "Bluetooth headphones",
  personal_audio_wired_earphone: "Wired earphones",
  personal_audio_wired_headphone: "Wired headphones",
  personal_audio_bt_earphone: "Bluetooth earphones",
  personal_audio_mic: "Microphones",
  home_automation_camera: "Smart cameras",
  home_automation_switch: "Smart switches",
  home_automation_doorbell: "Video doorbells",
  gaming_headphone: GAMING_HEADPHONE_SUB_LABEL,
  "Car Charger": "Car Charger",
  "Car Media Receiver": "Car Media Receiver",
  "Tyre Inflator": "Tyre Inflator",
  [PORTABLE_FAN_SUB_LABEL]: PORTABLE_FAN_SUB_LABEL,
};

export type KaranSubCategoryFilter =
  | "all"
  | KaranSubCategory
  | (typeof KARAN_MISC_SUB_CATEGORIES)[number];

export const KARAN_SUB_CATEGORY_FILTER_OPTIONS: readonly KaranSubCategoryFilter[] = [
  "all",
  ...(KARAN_TRACKED_SUB_CATEGORIES as KaranSubCategory[]),
] as const;

export const KARAN_SUB_CATEGORY_FILTER_LABELS: Record<string, string> = {
  all: "All",
  ...KARAN_SUB_CATEGORY_LABELS,
};

function isPersonalAudioCategory(cat: string): boolean {
  return cat === "personal audio" || cat === "audio";
}

function isHomeAutomationCategory(cat: string): boolean {
  return (
    cat === "home automation" ||
    cat.includes("smart home") ||
    (cat.includes("automation") && !cat.includes("automobile"))
  );
}

function isMiscCategory(cat: string): boolean {
  return cat === "misc" || cat === "miscellaneous";
}

function isGamingHeadphoneRow(
  cat: string,
  sub: string,
  hay: string,
  _marketplace: LegacyMarketplace,
): boolean {
  return isGamingHeadphoneSub(sub, cat, hay);
}

function classifyPersonalAudioSub(sub: string, hay: string): KaranKeyedSubCategory | null {
  if (sub === "tws" || /\btws\b/.test(hay) || hay.includes("true wireless")) {
    return "personal_audio_tws";
  }
  if (
    sub.includes("bluetooth speaker") ||
    (sub === "party speaker" && hay.includes("portable")) ||
    (hay.includes("speaker") && !hay.includes("headphone") && !hay.includes("earphone"))
  ) {
    return "personal_audio_bt_speaker";
  }
  if (sub.includes("wired earphone") || sub === "wired earphones") {
    return "personal_audio_wired_earphone";
  }
  if (sub.includes("wired headphone")) {
    return "personal_audio_wired_headphone";
  }
  if (sub.includes("bluetooth earphone") || sub === "neckband") {
    return "personal_audio_bt_earphone";
  }
  if (
    sub.includes("bluetooth headphone") ||
    sub === "bt headphone" ||
    (sub === "headphone" && !sub.includes("gaming")) ||
    sub === "headphones" ||
    sub.includes("ows")
  ) {
    return "personal_audio_bt_headphone";
  }
  if (sub === "mic" || sub === "microphone" || hay.includes("microphone")) {
    return "personal_audio_mic";
  }
  if (
    hay.includes("earphone") ||
    hay.includes("earbud") ||
    (hay.includes("headphone") && !hay.includes("gaming")) ||
    hay.includes("headset") ||
    (hay.includes("speaker") && !hay.includes("gaming"))
  ) {
    if (hay.includes("wired") && hay.includes("headphone")) return "personal_audio_wired_headphone";
    if (hay.includes("wired")) return "personal_audio_wired_earphone";
    if (hay.includes("speaker")) return "personal_audio_bt_speaker";
    return "personal_audio_bt_headphone";
  }
  return null;
}

function classifyHomeAutomationSub(sub: string, hay: string): KaranKeyedSubCategory | null {
  if (
    sub.includes("smart camera") ||
    sub.includes("security camera") ||
    hay.includes("smart cam")
  ) {
    return "home_automation_camera";
  }
  if (sub.includes("smart switch") || sub.includes("smart plug") || hay.includes("smart plug")) {
    return "home_automation_switch";
  }
  if (sub.includes("video doorbell") || sub.includes("door bell") || hay.includes("doorbell")) {
    return "home_automation_doorbell";
  }
  if (hay.includes("camera") || hay.includes("doorbell") || hay.includes("smart switch")) {
    if (hay.includes("doorbell")) return "home_automation_doorbell";
    if (hay.includes("switch") || hay.includes("plug")) return "home_automation_switch";
    return "home_automation_camera";
  }
  return null;
}

function classifyMiscSub(
  sub: string,
  hay: string,
  rawSubCategory: string,
  rawCategory: string,
): (typeof KARAN_MISC_SUB_CATEGORIES)[number] | null {
  if (isPravinManagedRomaSub(rawSubCategory, rawCategory)) return null;
  if (isPortableFanSub(sub, rawCategory, hay)) return PORTABLE_FAN_SUB_LABEL;
  if (sub.includes("car media") || hay.includes("car media receiver")) return "Car Media Receiver";
  if (sub.includes("tyre inflator") || hay.includes("tyre inflator")) return "Tyre Inflator";
  if (sub.includes("car charger") || hay.includes("car charger")) return "Car Charger";
  return null;
}

export function karanTopCategoryForSub(sub: string): KaranTopCategory | null {
  if (sub === "gaming_headphone" || normalizeKey(sub) === normalizeKey(GAMING_HEADPHONE_SUB_LABEL)) {
    return "IT Accessories";
  }
  if (KARAN_MISC_SUB_CATEGORIES.includes(sub as (typeof KARAN_MISC_SUB_CATEGORIES)[number])) {
    return "Misc";
  }
  if (sub.startsWith("home_automation_")) return "Home Automation";
  if (sub.startsWith("personal_audio_")) return "Personal Audio";
  return null;
}

/**
 * Maps Ecom Sellout rows to Karan stored sub_category.
 * Returns null when the row is outside Karan's scope (ROMA → Pravin, etc.).
 */
export function normalizedKaranSubCategory(
  rawSubCategory: string,
  rawCategory: string,
  productName: string,
  marketplace: LegacyMarketplace,
): KaranSubCategory | null {
  const cat = normalizeKey(rawCategory);
  const sub = normalizeKey(rawSubCategory);
  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);

  if (isPravinManagedRomaSub(rawSubCategory, rawCategory)) return null;

  if (sub === "gaming_headphone" || isGamingHeadphoneRow(cat, sub, hay, marketplace)) {
    if (marketplace !== "flipkart") return null;
    return "gaming_headphone";
  }

  if (isPersonalAudioCategory(cat)) {
    const pa = classifyPersonalAudioSub(sub, hay);
    if (pa) return pa;
  }

  if (isHomeAutomationCategory(cat)) {
    const ha = classifyHomeAutomationSub(sub, hay);
    if (ha) return ha;
  }

  if (isMiscCategory(cat) || classifyMiscSub(sub, hay, rawSubCategory, rawCategory)) {
    const misc = classifyMiscSub(sub, hay, rawSubCategory, rawCategory);
    if (misc) {
      if (misc === PORTABLE_FAN_SUB_LABEL && marketplace !== "amazon") return null;
      return misc;
    }
  }

  const miscFromHay = classifyMiscSub(sub, hay, rawSubCategory, rawCategory);
  if (miscFromHay) {
    if (miscFromHay === PORTABLE_FAN_SUB_LABEL && marketplace !== "amazon") return null;
    return miscFromHay;
  }

  return null;
}

export function karanDashboardSheetCategoryForKey(
  sub: string,
): KaranTopCategory | null {
  return karanTopCategoryForSub(sub);
}

/** Dashboard / PO filters — display labels for every tracked sub under a top category. */
export function karanDashboardSubCategoryDisplayOptions(topCategory: string): string[] {
  const labels: string[] = [];
  for (const sub of KARAN_TRACKED_SUB_CATEGORIES) {
    const top = karanTopCategoryForSub(sub);
    if (!top) continue;
    if (topCategory !== "all" && normalizeKey(topCategory) !== normalizeKey(top)) continue;
    labels.push(KARAN_SUB_CATEGORY_LABELS[sub] ?? sub);
  }
  return labels.sort((a, b) => a.localeCompare(b, "en-IN", { numeric: true, sensitivity: "base" }));
}

export function inferKaranSubCategory(
  row: Pick<
    { category: string | null; sub_category: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
  marketplace: LegacyMarketplace,
): KaranSubCategory | null {
  return normalizedKaranSubCategory(
    String(row.sub_category ?? ""),
    String(row.category ?? ""),
    String(row.product_name ?? ""),
    marketplace,
  );
}

export function karanDashboardSheetCategory(
  row: Pick<
    { category: string | null; sub_category: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
  marketplace: LegacyMarketplace,
): string | null {
  const key = inferKaranSubCategory(row, marketplace);
  if (!key) return null;
  return karanTopCategoryForSub(key);
}

export function karanDashboardSubCategoryLabel(
  row: Pick<
    { category: string | null; sub_category: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
  marketplace: LegacyMarketplace,
): string | null {
  const key = inferKaranSubCategory(row, marketplace);
  if (!key) return null;
  return KARAN_SUB_CATEGORY_LABELS[key] ?? key;
}

function karanScopeMatchesRow(
  row: {
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
  },
  marketplace: LegacyMarketplace,
): boolean {
  const stored = String(row.sub_category ?? "").trim();
  if (stored && (KARAN_TRACKED_SUB_CATEGORY_SET.has(stored) || KARAN_MISC_SUB_CATEGORIES.includes(stored as (typeof KARAN_MISC_SUB_CATEGORIES)[number]))) {
    const inferred = inferKaranSubCategory(
      {
        category: row.category ?? null,
        sub_category: row.sub_category ?? null,
        product_name: row.product_name ?? null,
      },
      marketplace,
    );
    if (inferred && stored !== inferred && KARAN_TRACKED_SUB_CATEGORY_SET.has(stored)) {
      return false;
    }
    if (inferred || KARAN_MISC_SUB_CATEGORIES.includes(stored as (typeof KARAN_MISC_SUB_CATEGORIES)[number])) {
      return true;
    }
  }
  return (
    inferKaranSubCategory(
      {
        category: row.category ?? null,
        sub_category: row.sub_category ?? null,
        product_name: row.product_name ?? null,
      },
      marketplace,
    ) != null
  );
}

export function productMatchesKaranDashboardScopeForMarketplace(
  row: {
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
    catalog_workspace?: string | null;
  },
  marketplace: LegacyMarketplace,
): boolean {
  if (
    rowVisibleViaSharedSub(CATALOG_WORKSPACE_PERSONAL_AUDIO, row, marketplace) &&
    karanScopeMatchesRow(row, marketplace)
  ) {
    return true;
  }

  const tagged = String(row.catalog_workspace ?? "").trim();
  if (tagged && tagged !== CATALOG_WORKSPACE_PERSONAL_AUDIO) {
    return false;
  }

  return karanScopeMatchesRow(row, marketplace);
}

export function productMatchesKaranDashboardScope(row: {
  category?: string | null;
  sub_category?: string | null;
  product_name?: string | null;
  catalog_workspace?: string | null;
}): boolean {
  return (
    productMatchesKaranDashboardScopeForMarketplace(row, "amazon") ||
    productMatchesKaranDashboardScopeForMarketplace(row, "flipkart")
  );
}

export function productMatchesKaranCategoryRollup(
  subCategory: string,
  row: Pick<
    { category: string | null; sub_category: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
  marketplace: LegacyMarketplace,
): boolean {
  const filter = String(subCategory ?? "").trim();
  if (!filter || filter === "all") {
    return productMatchesKaranDashboardScopeForMarketplace(row, marketplace);
  }
  for (const mp of ["amazon", "flipkart"] as const) {
    const inferred = inferKaranSubCategory(row, mp);
    if (inferred && normalizeKey(inferred) === normalizeKey(filter)) {
      return productMatchesKaranDashboardScopeForMarketplace(row, mp);
    }
    if (
      KARAN_MISC_SUB_CATEGORIES.includes(filter as (typeof KARAN_MISC_SUB_CATEGORIES)[number]) &&
      normalizeKey(String(row.sub_category ?? "")) === normalizeKey(filter)
    ) {
      return productMatchesKaranDashboardScopeForMarketplace(row, mp);
    }
  }
  return false;
}

export function productMatchesKaranTopCategory(
  topCategory: string,
  row: Pick<
    { category: string | null; sub_category: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
  marketplace: LegacyMarketplace,
): boolean {
  const top = karanDashboardSheetCategory(row, marketplace);
  if (!top) return false;
  return normalizeKey(top) === normalizeKey(topCategory);
}

export function isKaranWorkspace(workspace: CatalogWorkspace): boolean {
  return workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO;
}

export function parseKaranSubCategoryFilterParam(
  raw: string | null | undefined,
): KaranSubCategoryFilter | null {
  const decoded = raw != null ? decodeURIComponent(raw) : "";
  if (decoded === "all") return "all";
  if (KARAN_TRACKED_SUB_CATEGORY_SET.has(decoded)) {
    return decoded as KaranSubCategoryFilter;
  }
  if (KARAN_MISC_SUB_CATEGORIES.includes(decoded as (typeof KARAN_MISC_SUB_CATEGORIES)[number])) {
    return decoded as KaranSubCategoryFilter;
  }
  return null;
}
