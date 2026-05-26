import {
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  sheetCategoryHaystack,
  type CatalogWorkspace,
} from "./catalog-workspace";
import type { LegacyMarketplace } from "./types";
import { normalizeKey } from "./utils";

/** Stored `product_master.sub_category` keys for Karan workspace. */
export const KARAN_TRACKED_SUB_CATEGORIES = [
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
  "auto_cable",
  "auto_charger",
  "auto_mobile_holder",
  "auto_mobile_adapter",
  "gaming_headphone",
] as const;

export type KaranSubCategory = (typeof KARAN_TRACKED_SUB_CATEGORIES)[number];

export const KARAN_TRACKED_SUB_CATEGORY_SET = new Set<string>(KARAN_TRACKED_SUB_CATEGORIES);

export const KARAN_SUB_CATEGORY_LABELS: Record<KaranSubCategory, string> = {
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
  auto_cable: "Cables",
  auto_charger: "Car chargers",
  auto_mobile_holder: "Mobile holders",
  auto_mobile_adapter: "Mobile adapters",
  gaming_headphone: "Gaming headphones (Flipkart)",
};

export type KaranSubCategoryFilter = KaranSubCategory | "all";

export const KARAN_SUB_CATEGORY_FILTER_OPTIONS: readonly KaranSubCategoryFilter[] = [
  "all",
  ...KARAN_TRACKED_SUB_CATEGORIES,
] as const;

export const KARAN_SUB_CATEGORY_FILTER_LABELS: Record<KaranSubCategoryFilter, string> = {
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

function isAutoRomaCategory(cat: string): boolean {
  return cat === "roma" || cat === "cables";
}

function isGamingHeadphoneRow(
  cat: string,
  sub: string,
  hay: string,
  marketplace: LegacyMarketplace,
): boolean {
  if (marketplace !== "flipkart") return false;
  if (sub === "gaming_headphone") return true;
  if (!/\b(headphone|earphone|headset)\b/.test(hay)) return false;
  if (
    !/\bgaming\b/.test(hay) &&
    sub !== "gaming headphone" &&
    sub !== "gaming headphones" &&
    !sub.includes("gaming")
  ) {
    return false;
  }
  return (
    cat.includes("gaming") ||
    cat === "it accessories" ||
    cat === "pc" ||
    sub.includes("gaming")
  );
}

function classifyPersonalAudioSub(sub: string, hay: string): KaranSubCategory | null {
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
    sub === "headphone" ||
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
    hay.includes("headphone") ||
    hay.includes("headset") ||
    hay.includes("speaker")
  ) {
    if (hay.includes("wired") && hay.includes("headphone")) return "personal_audio_wired_headphone";
    if (hay.includes("wired")) return "personal_audio_wired_earphone";
    if (hay.includes("speaker")) return "personal_audio_bt_speaker";
    return "personal_audio_bt_headphone";
  }
  return null;
}

function classifyHomeAutomationSub(sub: string, hay: string): KaranSubCategory | null {
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

function classifyAutoSub(sub: string, hay: string): KaranSubCategory | null {
  if (
    sub.includes("car charger") ||
    sub === "car charger" ||
    hay.includes("car charger")
  ) {
    return "auto_charger";
  }
  if (
    sub.includes("mobile adapter") ||
    sub.includes("mobile adapters") ||
    hay.includes("adapter")
  ) {
    return "auto_mobile_adapter";
  }
  if (
    sub.includes("mobile holder") ||
    sub.includes("car mobile holder") ||
    sub.includes("bike mobile holder") ||
    hay.includes("mobile holder") ||
    hay.includes("phone holder")
  ) {
    return "auto_mobile_holder";
  }
  if (sub === "cables" || sub.includes("cable") || hay.includes("cable")) {
    return "auto_cable";
  }
  return null;
}

/**
 * Maps Ecom Sellout / GMV master rows to Karan stored sub_category.
 * Returns null when the row is outside Karan's scope.
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

  /** Ingest stores this key; dashboard must still map it on Flipkart. */
  if (sub === "gaming_headphone") {
    return marketplace === "flipkart" ? "gaming_headphone" : null;
  }

  if (isGamingHeadphoneRow(cat, sub, hay, marketplace)) {
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

  if (isAutoRomaCategory(cat)) {
    const auto = classifyAutoSub(sub, hay);
    if (auto) return auto;
    if (cat === "roma") {
      return classifyAutoSub("cables", hay) ?? classifyAutoSub(sub, hay);
    }
  }

  return null;
}

/** Sheet Category column label for PO dashboard filters (not every raw master value). */
export function karanDashboardSheetCategoryForKey(
  key: KaranSubCategory,
): "Personal Audio" | "Home Automation" | "ROMA" | "IT Accessories" {
  if (key === "gaming_headphone") return "IT Accessories";
  if (key.startsWith("home_automation_")) return "Home Automation";
  if (key.startsWith("auto_")) return "ROMA";
  return "Personal Audio";
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
  return karanDashboardSheetCategoryForKey(key);
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
  return KARAN_SUB_CATEGORY_LABELS[key];
}

/** Strict row gate — re-infer from sheet fields + channel (never trust stale sub_category alone). */
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
    row.catalog_workspace &&
    row.catalog_workspace !== CATALOG_WORKSPACE_PERSONAL_AUDIO
  ) {
    return false;
  }
  const stored = String(row.sub_category ?? "").trim();
  if (
    stored === "gaming_headphone" &&
    marketplace === "flipkart"
  ) {
    return true;
  }

  const inferred = inferKaranSubCategory(
    {
      category: row.category ?? null,
      sub_category: row.sub_category ?? null,
      product_name: row.product_name ?? null,
    },
    marketplace,
  );
  if (!inferred) return false;
  if (stored && KARAN_TRACKED_SUB_CATEGORY_SET.has(stored) && stored !== inferred) {
    return false;
  }
  return true;
}

export function productMatchesKaranDashboardScope(row: {
  category?: string | null;
  sub_category?: string | null;
  product_name?: string | null;
  catalog_workspace?: string | null;
}): boolean {
  return productMatchesKaranDashboardScopeForMarketplace(row, "amazon");
}

export function productMatchesKaranCategoryRollup(
  subCategory: KaranSubCategory,
  row: Pick<
    { category: string | null; sub_category: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
  marketplace: LegacyMarketplace,
): boolean {
  const inferred = inferKaranSubCategory(row, marketplace);
  return inferred === subCategory;
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
    return decoded as KaranSubCategory;
  }
  return null;
}
