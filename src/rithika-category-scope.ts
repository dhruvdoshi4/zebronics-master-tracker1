import {
  CATALOG_WORKSPACE_RITHIKA,
  sheetCategoryHaystack,
  type CatalogWorkspace,
} from "./catalog-workspace";
import { looksLikeDisplayMonitor } from "./sellout-category-scope";
import type { LegacyMarketplace } from "./types";
import { normalizeKey } from "./utils";

/** Stored `product_master.sub_category` keys for Rithika workspace. */
export const RITHIKA_TRACKED_SUB_CATEGORIES = [
  "rithika_complete_it_accessories",
  "rithika_gaming_components",
  "rithika_speakers_20",
  "rithika_gaming_headphones",
  "rithika_roma_aux_otg",
  "rithika_portable_fans",
  "rithika_drive_cast",
] as const;

export type RithikaSubCategory = (typeof RITHIKA_TRACKED_SUB_CATEGORIES)[number];

export const RITHIKA_TRACKED_SUB_CATEGORY_SET = new Set<string>(RITHIKA_TRACKED_SUB_CATEGORIES);

export const RITHIKA_SUB_CATEGORY_LABELS: Record<RithikaSubCategory, string> = {
  rithika_complete_it_accessories: "Complete IT & accessories",
  rithika_gaming_components: "Gaming & components",
  rithika_speakers_20: "2.0 speakers (Amazon)",
  rithika_gaming_headphones: "Gaming headphones (Amazon)",
  rithika_roma_aux_otg: "ROMA — AUX / OTG",
  rithika_portable_fans: "Portable fans",
  rithika_drive_cast: "Drive cast",
};

/** Sheet **Sub category** cell value, or `all`. */
export type RithikaSubCategoryFilter = string;

const RITHIKA_LEGACY_SUB_PREFIX = "rithika_";

export const RITHIKA_AMAZON_KAM_ALLOWLIST = new Set([
  "deesha",
  "suchitra",
  "somya",
  "rithika",
]);

export const RITHIKA_FLIPKART_KAM_ALLOWLIST = new Set(["deesha", "suchitra"]);

/** KAMs that must never ingest into Rithika (unless row is a ROMA specialty bucket). */
const RITHIKA_KAM_BLOCKLIST = new Set([
  "hari",
  "karan",
  "mohana priya",
  "mohana",
  "rishabh",
  "diya",
  "varnit",
  "paavan",
]);

function normalizeRithikaKam(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isRithikaRomaSpecialtyBucket(bucket: RithikaSubCategory): boolean {
  return (
    bucket === "rithika_roma_aux_otg" ||
    bucket === "rithika_portable_fans" ||
    bucket === "rithika_drive_cast"
  );
}

function isRithikaCategoryOnlyBucket(bucket: RithikaSubCategory): boolean {
  return (
    bucket === "rithika_speakers_20" || bucket === "rithika_gaming_headphones"
  );
}

/**
 * Ingest gate: KAM column + scope bucket. ROMA specialty and Amazon-only speaker/headphone
 * buckets use category rules; IT/gaming rows require the right KAM name on the sheet.
 */
export function rowPassesRithikaKamGate(
  rawKam: string,
  marketplace: LegacyMarketplace,
  bucket: RithikaSubCategory | null,
): boolean {
  if (!bucket) return false;
  if (isRithikaRomaSpecialtyBucket(bucket) || isRithikaCategoryOnlyBucket(bucket)) {
    return true;
  }
  const kam = normalizeRithikaKam(rawKam);
  if (kam && RITHIKA_KAM_BLOCKLIST.has(kam)) return false;
  const allow =
    marketplace === "amazon"
      ? RITHIKA_AMAZON_KAM_ALLOWLIST
      : RITHIKA_FLIPKART_KAM_ALLOWLIST;
  if (!kam) return true;
  if (bucket === "rithika_gaming_components") {
    return allow.has(kam) || kam === "somya";
  }
  if (bucket === "rithika_complete_it_accessories") {
    return allow.has(kam);
  }
  return allow.has(kam);
}

export function isLegacyRithikaStoredSubCategory(sub: string | null | undefined): boolean {
  const key = normalizeKey(String(sub ?? ""));
  return key.startsWith(RITHIKA_LEGACY_SUB_PREFIX);
}

export function sheetSubCategoryLabel(
  row: Pick<{ sub_category?: string | null }, "sub_category">,
): string {
  const stored = String(row.sub_category ?? "").trim();
  if (!stored || isLegacyRithikaStoredSubCategory(stored)) return "";
  return stored;
}

export const RITHIKA_SUB_CATEGORY_FILTER_OPTIONS: readonly RithikaSubCategoryFilter[] = [
  "all",
  ...RITHIKA_TRACKED_SUB_CATEGORIES,
] as const;

export const RITHIKA_SUB_CATEGORY_FILTER_LABELS: Record<RithikaSubCategoryFilter, string> = {
  all: "All",
  ...RITHIKA_SUB_CATEGORY_LABELS,
};

function isRomaCategory(cat: string): boolean {
  return cat === "roma" || cat === "cables";
}

function isCompleteItCategory(cat: string): boolean {
  return (
    cat.includes("complete it") ||
    cat.includes("it accessories") ||
    cat.includes("it accessory") ||
    cat.includes("computer accessories") ||
    cat === "accessories"
  );
}

function isGamingCategory(cat: string): boolean {
  return cat.includes("gaming") || cat === "pc" || cat.includes("gaming &");
}

function isHariDisplayProduct(hay: string): boolean {
  if (looksLikeDisplayMonitor(hay)) return true;
  if (/\b(projector|cartridge|monitor arm)\b/.test(hay)) return true;
  return false;
}

function isRithikaAuxOtg(hay: string, sub: string): boolean {
  if (/\b(aux|otg)\b/.test(hay)) return true;
  if (/\botg\b/.test(sub) || /\baux\b/.test(sub)) return true;
  if (/\btype[\s-]?c\b/.test(hay) && /\b(otg|adapter|convertor|converter)\b/.test(hay)) {
    return true;
  }
  return false;
}

function isPortableFan(hay: string, cat: string): boolean {
  if (/\b(portable fan|table fan|desk fan|mini fan|rechargeable fan)\b/.test(hay)) {
    return true;
  }
  if (/\bfan\b/.test(hay) && !/\b(gpu|graphics|cooling fan)\b/.test(hay)) {
    return cat.includes("roma") || /\bportable\b/.test(hay);
  }
  return false;
}

function isDriveCast(hay: string): boolean {
  return /\b(drive\s*cast|drivecast|chromecast|tv\s*cast|media\s*cast)\b/.test(hay);
}

function isSpeaker20(hay: string, sub: string): boolean {
  if (/\b(bluetooth|bt\b|tws|true wireless|party speaker|portable speaker)\b/.test(hay)) {
    return false;
  }
  if (/\bneckband\b/.test(hay)) return false;
  if (/\b(2\.0|2\.1)\b/.test(hay) && /\bspeaker\b/.test(hay)) return true;
  if (/\b(multimedia speaker|usb speaker|wired speaker|desktop speaker|computer speaker)\b/.test(hay)) {
    return true;
  }
  if (sub.includes("2.0") || sub.includes("multimedia")) return true;
  if (/\bspeaker\b/.test(hay) && !/\b(bluetooth|wireless|bt)\b/.test(hay)) return true;
  return false;
}

function isGamingHeadphone(hay: string, sub: string, cat: string): boolean {
  if (!/\b(headphone|earphone|headset)\b/.test(hay)) return false;
  if (/\bgaming\b/.test(hay) || sub.includes("gaming") || cat.includes("gaming")) return true;
  if (sub === "gaming headphone" || sub === "gaming headphones") return true;
  return false;
}

function isGamingComponent(cat: string, sub: string, hay: string): boolean {
  const isComponentsCategory = cat.includes("component") || sub.includes("component");
  if (!isGamingCategory(cat) && !/\bgaming\b/.test(hay) && !isComponentsCategory) {
    return false;
  }
  if (isGamingHeadphone(hay, sub, cat)) return false;
  if (/\b(headphone|earphone|speaker|soundbar)\b/.test(hay) && !/\b(keyboard|mouse)\b/.test(hay)) {
    return false;
  }
  if (
    cat.includes("component") ||
    sub.includes("component") ||
    /\b(gpu|graphics card|motherboard|gaming cabinet|gaming case|gaming keyboard|gaming mouse|gaming chair|gaming cooler|gaming psu|gaming power)\b/.test(
      hay,
    )
  ) {
    return true;
  }
  if (isGamingCategory(cat)) return true;
  return false;
}

function isCompleteItAccessory(cat: string, sub: string, hay: string): boolean {
  if (isHariDisplayProduct(hay)) return false;
  if (isGamingComponent(cat, sub, hay)) return false;
  if (isCompleteItCategory(cat)) return true;
  if (
    /\b(keyboard|mouse|webcam|usb hub|hub|dock|dongle|laptop bag|cooling pad|presenter|pad)\b/.test(
      hay,
    ) &&
    !/\bgaming\b/.test(hay)
  ) {
    return true;
  }
  return false;
}

/**
 * Maps Ecom Sellout master rows to Rithika stored sub_category.
 * Returns null when the row is outside Rithika scope.
 */
export function normalizedRithikaSubCategory(
  rawSubCategory: string,
  rawCategory: string,
  productName: string,
  marketplace: LegacyMarketplace,
): RithikaSubCategory | null {
  const cat = normalizeKey(rawCategory);
  const sub = normalizeKey(rawSubCategory);
  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);

  if (isHariDisplayProduct(hay)) return null;

  if (sub.startsWith("rithika_") && RITHIKA_TRACKED_SUB_CATEGORY_SET.has(sub)) {
    const key = sub as RithikaSubCategory;
    if (key === "rithika_speakers_20" || key === "rithika_gaming_headphones") {
      return marketplace === "amazon" ? key : null;
    }
    return key;
  }

  if (isDriveCast(hay)) return "rithika_drive_cast";

  if (isPortableFan(hay, cat)) return "rithika_portable_fans";

  if (isRomaCategory(cat) && isRithikaAuxOtg(hay, sub)) {
    return "rithika_roma_aux_otg";
  }

  if (marketplace === "amazon" && isGamingHeadphone(hay, sub, cat)) {
    return "rithika_gaming_headphones";
  }

  if (marketplace === "amazon" && isSpeaker20(hay, sub)) {
    return "rithika_speakers_20";
  }

  if (isGamingComponent(cat, sub, hay)) return "rithika_gaming_components";

  if (isCompleteItAccessory(cat, sub, hay)) return "rithika_complete_it_accessories";

  return null;
}

export function rithikaDashboardSheetCategoryForKey(
  key: RithikaSubCategory,
): "Complete IT" | "Gaming" | "Speakers" | "ROMA" | "IT Accessories" {
  switch (key) {
    case "rithika_gaming_components":
    case "rithika_gaming_headphones":
      return "Gaming";
    case "rithika_speakers_20":
      return "Speakers";
    case "rithika_roma_aux_otg":
    case "rithika_portable_fans":
    case "rithika_drive_cast":
      return "ROMA";
    case "rithika_complete_it_accessories":
    default:
      return "Complete IT";
  }
}

export function inferRithikaSubCategory(
  row: Pick<
    { category: string | null; sub_category: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
  marketplace: LegacyMarketplace,
): RithikaSubCategory | null {
  return normalizedRithikaSubCategory(
    String(row.sub_category ?? ""),
    String(row.category ?? ""),
    String(row.product_name ?? ""),
    marketplace,
  );
}

export function rithikaDashboardSheetCategory(
  row: Pick<
    { category: string | null; sub_category: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
  marketplace: LegacyMarketplace,
): string | null {
  const key = inferRithikaSubCategory(row, marketplace);
  if (!key) return null;
  return rithikaDashboardSheetCategoryForKey(key);
}

export function rithikaDashboardSubCategoryLabel(
  row: Pick<
    { category: string | null; sub_category: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
  marketplace: LegacyMarketplace,
): string | null {
  const key = inferRithikaSubCategory(row, marketplace);
  if (!key) return null;
  return RITHIKA_SUB_CATEGORY_LABELS[key];
}

export function productMatchesRithikaDashboardScopeForMarketplace(
  row: {
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
    catalog_workspace?: string | null;
  },
  marketplace: LegacyMarketplace,
): boolean {
  if (row.catalog_workspace && row.catalog_workspace !== CATALOG_WORKSPACE_RITHIKA) {
    return false;
  }
  const stored = String(row.sub_category ?? "").trim();
  const inferred = inferRithikaSubCategory(
    {
      category: row.category ?? null,
      sub_category: row.sub_category ?? null,
      product_name: row.product_name ?? null,
    },
    marketplace,
  );
  if (!inferred) return false;
  if (isLegacyRithikaStoredSubCategory(stored)) return true;
  return true;
}

/** Filter by exact sheet **Sub category** (same spelling as master). */
export function productMatchesRithikaCategoryRollup(
  sheetSubCategory: string,
  row: Pick<
    { category: string | null; sub_category: string | null; product_name?: string | null },
    "category" | "sub_category" | "product_name"
  >,
  marketplace: LegacyMarketplace,
): boolean {
  if (inferRithikaSubCategory(row, marketplace) === null) return false;
  const want = String(sheetSubCategory ?? "").trim().toLowerCase();
  if (!want || want === "all") return true;
  const got = sheetSubCategoryLabel(row).toLowerCase();
  return got === want;
}

export function isRithikaWorkspace(workspace: CatalogWorkspace): boolean {
  return workspace === CATALOG_WORKSPACE_RITHIKA;
}

export function parseRithikaSubCategoryFilterParam(
  raw: string | null | undefined,
): RithikaSubCategoryFilter | null {
  const decoded = raw != null ? decodeURIComponent(raw) : "";
  if (decoded === "all") return "all";
  if (!decoded.trim()) return null;
  if (isLegacyRithikaStoredSubCategory(decoded)) return null;
  return decoded.trim();
}

/** Rows Karan must not ingest (owned by Rithika on ROMA / accessories). */
export function isRithikaExclusiveFromKaranAuto(
  rawCategory: string,
  rawSubCategory: string,
  productName: string,
): boolean {
  const cat = normalizeKey(rawCategory);
  const sub = normalizeKey(rawSubCategory);
  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);
  if (isRithikaAuxOtg(hay, sub)) return true;
  if (isDriveCast(hay)) return true;
  if (isPortableFan(hay, cat) && isRomaCategory(cat)) return true;
  if (isSpeaker20(hay, sub)) return true;
  if (isGamingHeadphone(hay, sub, cat)) return true;
  return false;
}
