/**
 * Sub-categories owned jointly by two manager workspaces.
 * Both managers see these SKUs on Amazon and Flipkart in dashboard / analysis
 * (catalog_workspace on ingest may still tag the primary owner).
 */
import {
  CATALOG_WORKSPACE_HOME_AUDIO,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_RITHIKA,
  sheetCategoryHaystack,
  type CatalogWorkspace,
} from "./catalog-workspace";
import type { LegacyMarketplace } from "./types";
import { normalizeKey } from "./utils";

export const GAMING_HEADPHONE_SUB_LABEL = "Gaming Headphone";
export const PORTABLE_FAN_SUB_LABEL = "Portable Fan";
export const SPEAKER_20_SUB_LABEL = "2.0 Speaker";
export const BT_SPEAKER_SUB_LABEL = "Bluetooth speakers";

const GAMING_HEADPHONE_WORKSPACES = new Set<CatalogWorkspace>([
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_RITHIKA,
]);

const PORTABLE_FAN_WORKSPACES = new Set<CatalogWorkspace>([
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_RITHIKA,
]);

const SPEAKER_20_WORKSPACES = new Set<CatalogWorkspace>([
  CATALOG_WORKSPACE_RITHIKA,
  CATALOG_WORKSPACE_HOME_AUDIO,
]);

const BT_SPEAKER_WORKSPACES = new Set<CatalogWorkspace>([
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_HOME_AUDIO,
]);

export function isGamingHeadphoneSub(
  rawSubCategory: string,
  rawCategory = "",
  productName = "",
): boolean {
  const sub = normalizeKey(rawSubCategory);
  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);
  if (sub === "gaming_headphone" || sub === "gaming headphones") return true;
  if (!/\b(headphone|headset)\b/.test(hay)) return false;
  return (
    /\bgaming\b/.test(hay) ||
    sub.includes("gaming") ||
    normalizeKey(rawCategory).includes("gaming")
  );
}

export function isPortableFanSub(
  rawSubCategory: string,
  rawCategory = "",
  productName = "",
): boolean {
  const sub = normalizeKey(rawSubCategory);
  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);
  if (sub.includes("portable") && sub.includes("fan")) return true;
  return /\b(portable fan|rechargeable fan|table fan|desk fan|mini fan)\b/.test(hay);
}

export function isSpeaker20Sub(
  rawSubCategory: string,
  rawCategory = "",
  productName = "",
): boolean {
  const sub = normalizeKey(rawSubCategory);
  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);
  // normalizeKey removes punctuation, so "2.0 Speaker" often becomes "20 speaker".
  if ((sub.includes("20") || /\b2\s*0\b/.test(sub)) && /\bspeaker\b/.test(sub)) return true;
  if (sub.includes("rithika") && sub.includes("speaker") && sub.includes("20")) return true;
  return /\b2[\s._-]*0\b/.test(hay) && /\bspeaker\b/.test(hay);
}

export function isBluetoothSpeakerSub(
  rawSubCategory: string,
  rawCategory = "",
  productName = "",
): boolean {
  const sub = normalizeKey(rawSubCategory);
  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);
  if (sub.includes("bluetooth") && sub.includes("speaker")) return true;
  if (sub === "bt speaker" || sub === "bt speakers") return true;
  return /\b(bluetooth|bt)\b/.test(hay) && /\bspeaker\b/.test(hay);
}

export function sharedSubAllowsWorkspace(
  workspace: CatalogWorkspace,
  marketplace: LegacyMarketplace,
  rawSubCategory: string,
  rawCategory: string,
  productName: string,
): boolean {
  if (isGamingHeadphoneSub(rawSubCategory, rawCategory, productName)) {
    return GAMING_HEADPHONE_WORKSPACES.has(workspace);
  }
  if (isPortableFanSub(rawSubCategory, rawCategory, productName)) {
    return PORTABLE_FAN_WORKSPACES.has(workspace);
  }
  if (isSpeaker20Sub(rawSubCategory, rawCategory, productName)) {
    return SPEAKER_20_WORKSPACES.has(workspace);
  }
  if (isBluetoothSpeakerSub(rawSubCategory, rawCategory, productName)) {
    // BT speakers: Karan shared visibility on Flipkart; Rishabh can view Amazon + Flipkart.
    if (!BT_SPEAKER_WORKSPACES.has(workspace)) return false;
    if (workspace === CATALOG_WORKSPACE_HOME_AUDIO) return true;
    return marketplace === "flipkart";
  }
  return false;
}

/** Cross-workspace dashboard visibility for jointly handled subs (both marketplaces). */
export function rowVisibleViaSharedSub(
  workspace: CatalogWorkspace,
  row: {
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
    catalog_workspace?: string | null;
  },
  marketplace: LegacyMarketplace,
): boolean {
  return sharedSubAllowsWorkspace(
    workspace,
    marketplace,
    String(row.sub_category ?? ""),
    String(row.category ?? ""),
    String(row.product_name ?? ""),
  );
}
