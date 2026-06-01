import { CATALOG_WORKSPACE_RITHIKA, type CatalogWorkspace } from "./catalog-workspace";

import { isPravinManagedRomaSub } from "./pravin-category-scope";

import {

  RITHIKA_ALL_SHEET_SUB_CATEGORIES,

  RITHIKA_TOP_CATEGORIES,

  resolveRithikaTaxonomy,

  rithikaTopCategoryForSub,

  type RithikaTopCategory,

} from "./rithika-sheet-taxonomy";

import {

  GAMING_HEADPHONE_SUB_LABEL,

  PORTABLE_FAN_SUB_LABEL,

  SPEAKER_20_SUB_LABEL,

  isGamingHeadphoneSub,

  isPortableFanSub,

  isSpeaker20Sub,

  rowVisibleViaSharedSub,

} from "./shared-ecom-subcategory-scope";

import type { LegacyMarketplace } from "./types";

import { normalizeKey } from "./utils";



export { RITHIKA_TOP_CATEGORIES, type RithikaTopCategory };



/** All sheet sub labels for roll-ups (IT Accessories + Components + Gaming). */

export const RITHIKA_TRACKED_SUB_CATEGORIES: readonly string[] = RITHIKA_ALL_SHEET_SUB_CATEGORIES;



export type RithikaSubCategory = string;



export const RITHIKA_TRACKED_SUB_CATEGORY_SET = new Set<string>(RITHIKA_TRACKED_SUB_CATEGORIES);



export const RITHIKA_SUB_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(

  RITHIKA_ALL_SHEET_SUB_CATEGORIES.map((sub) => [sub, sub]),

);



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



/** Split subs and legacy specialty rows skip the KAM name gate on ingest. */

function rithikaIngestSkipsKamGate(sub: string, marketplace: LegacyMarketplace): boolean {

  if (isGamingHeadphoneSub(sub, "", "") && marketplace === "amazon") return true;

  if (isPortableFanSub(sub, "", "") && marketplace === "flipkart") return true;

  if (isSpeaker20Sub(sub, "", "") && marketplace === "amazon") return true;

  if (sub.startsWith(RITHIKA_LEGACY_SUB_PREFIX)) return true;

  return false;

}



export function rowPassesRithikaKamGate(

  rawKam: string,

  marketplace: LegacyMarketplace,

  bucket: string | null,

): boolean {

  if (!bucket) return false;

  if (rithikaIngestSkipsKamGate(bucket, marketplace)) return true;



  const kam = normalizeRithikaKam(rawKam);

  if (kam && RITHIKA_KAM_BLOCKLIST.has(kam)) return false;

  const allow =

    marketplace === "amazon"

      ? RITHIKA_AMAZON_KAM_ALLOWLIST

      : RITHIKA_FLIPKART_KAM_ALLOWLIST;

  if (!kam) return true;

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



function applyRithikaMarketplaceIngestGate(

  sub: string,

  marketplace: LegacyMarketplace,

): string | null {

  if (isGamingHeadphoneSub(sub, "", "") && marketplace !== "amazon") return null;

  if (isPortableFanSub(sub, "", "") && marketplace !== "flipkart") return null;

  if (isSpeaker20Sub(sub, "", "") && marketplace !== "amazon") return null;

  return sub;

}



/**

 * Maps Ecom Sellout master rows to canonical sheet sub_category for Rithika.

 * Returns null when the row is outside Rithika scope.

 */

export function normalizedRithikaSubCategory(

  rawSubCategory: string,

  rawCategory: string,

  productName: string,

  marketplace: LegacyMarketplace,

): RithikaSubCategory | null {

  const tax = resolveRithikaTaxonomy(rawSubCategory, rawCategory, productName);

  if (tax) {

    return applyRithikaMarketplaceIngestGate(tax.sub, marketplace);

  }



  if (

    isPortableFanSub(rawSubCategory, rawCategory, productName) &&

    !isPravinManagedRomaSub(rawSubCategory, rawCategory)

  ) {

    return applyRithikaMarketplaceIngestGate(PORTABLE_FAN_SUB_LABEL, marketplace);

  }



  if (isGamingHeadphoneSub(rawSubCategory, rawCategory, productName)) {

    return applyRithikaMarketplaceIngestGate(GAMING_HEADPHONE_SUB_LABEL, marketplace);

  }



  if (isSpeaker20Sub(rawSubCategory, rawCategory, productName)) {

    return applyRithikaMarketplaceIngestGate(SPEAKER_20_SUB_LABEL, marketplace);

  }



  return null;

}



export function rithikaDashboardSheetCategoryForKey(

  sub: string,

): RithikaTopCategory {

  return rithikaTopCategoryForSub(sub) ?? "IT Accessories";

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

  const sub = inferRithikaSubCategory(row, marketplace);

  if (!sub) return null;

  return rithikaDashboardSheetCategoryForKey(sub);

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

  return RITHIKA_SUB_CATEGORY_LABELS[key] ?? key;

}



function rithikaScopeMatchesRow(

  row: {

    category?: string | null;

    sub_category?: string | null;

    product_name?: string | null;

  },

  marketplace: LegacyMarketplace,

): boolean {

  return inferRithikaSubCategory(

    {

      category: row.category ?? null,

      sub_category: row.sub_category ?? null,

      product_name: row.product_name ?? null,

    },

    marketplace,

  ) != null;

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

  if (

    rowVisibleViaSharedSub(CATALOG_WORKSPACE_RITHIKA, row, marketplace) &&

    rithikaScopeMatchesRow(row, marketplace)

  ) {

    return true;

  }



  const tagged = String(row.catalog_workspace ?? "").trim();

  if (tagged && tagged !== CATALOG_WORKSPACE_RITHIKA) {

    return false;

  }



  return rithikaScopeMatchesRow(row, marketplace);

}



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

  if (got === want) return true;

  const inferred = inferRithikaSubCategory(row, marketplace);

  return normalizeKey(inferred ?? "") === normalizeKey(sheetSubCategory);

}



export function productMatchesRithikaTopCategory(

  topCategory: string,

  row: Pick<

    { category: string | null; sub_category: string | null; product_name?: string | null },

    "category" | "sub_category" | "product_name"

  >,

  marketplace: LegacyMarketplace,

): boolean {

  const top = rithikaDashboardSheetCategory(row, marketplace);

  if (!top) return false;

  return normalizeKey(top) === normalizeKey(topCategory);

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



/** Rows Karan must not ingest (Pravin ROMA + Rithika sheet scope + split subs). */

export function isRithikaExclusiveFromKaranAuto(

  rawCategory: string,

  rawSubCategory: string,

  productName: string,

): boolean {

  if (isPravinManagedRomaSub(rawSubCategory, rawCategory)) return true;

  if (isGamingHeadphoneSub(rawSubCategory, rawCategory, productName)) return true;

  if (isSpeaker20Sub(rawSubCategory, rawCategory, productName)) return true;

  if (resolveRithikaTaxonomy(rawSubCategory, rawCategory, productName)) return true;

  if (

    isPortableFanSub(rawSubCategory, rawCategory, productName) &&

    !isPravinManagedRomaSub(rawSubCategory, rawCategory)

  ) {

    return true;

  }

  return false;

}


