import { normalizeKey } from "./utils";

/** Ingest + dashboard + analysis: only these four roll-up groups. */
export const CORE_SELL_OUT_SUB_CATEGORIES = [
  "monitor",
  "monitor_arm",
  "projector",
  "projector_screen",
] as const;

export type CoreSelloutSubCategory = (typeof CORE_SELL_OUT_SUB_CATEGORIES)[number];

export const CORE_SELL_OUT_SUB_CATEGORY_SET = new Set<string>(CORE_SELL_OUT_SUB_CATEGORIES);

export function isCoreSelloutSubCategory(
  value: string | null | undefined,
): value is CoreSelloutSubCategory {
  return CORE_SELL_OUT_SUB_CATEGORY_SET.has(String(value ?? ""));
}

export function isCartridgeSheetCategory(category: string | null | undefined): boolean {
  return normalizeKey(category ?? "") === "cartridge";
}

/**
 * Accessories often sit under "Monitor & Acc." / "Projector & Acc." but are not
 * displays, arms, screens, or projectors (e.g. laptop stand NS1000).
 */
export function isExcludedNonDisplaySelloutProduct(normalizedHay: string): boolean {
  if (!normalizedHay) return true;

  if (/\blaptop\s+stand\b/.test(normalizedHay)) return true;
  if (/\bnotebook\s+stand\b/.test(normalizedHay)) return true;
  if (/\bkeyboard\s+stand\b/.test(normalizedHay)) return true;
  if (/\bphone\s+stand\b/.test(normalizedHay)) return true;
  if (/\btablet\s+stand\b/.test(normalizedHay)) return true;
  if (/\bdesk\s+stand\b/.test(normalizedHay) && !/\bmonitor\b/.test(normalizedHay)) {
    return true;
  }

  if (/\b(keyboard|mouse|webcam|headphone|earphone|earbud|speaker|soundbar)\b/.test(normalizedHay)) {
    return true;
  }
  if (/\b(cable|adapter|converter|hub|dock|dongle|charger|power\s+bank)\b/.test(normalizedHay)) {
    return true;
  }
  if (/\b(bag|backpack|case|cover|sleeve|pouch)\b/.test(normalizedHay)) return true;
  if (/\b(cleaning|wipe|cloth|dust)\s*(kit)?\b/.test(normalizedHay)) return true;
  /** Hari cartridge rows: Category + Sub Category = Cartridge — not accessory noise. */
  if (/\bcartridge\b/.test(normalizedHay) && !/\b(toner|drum)\b/.test(normalizedHay)) {
    return false;
  }
  if (/\b(toner|drum)\b/.test(normalizedHay)) return true;
  if (/\bcartridge\b/.test(normalizedHay)) return true;
  if (/\b(projector\s+stand|tripod|ceiling\s+mount|projector\s+mount)\b/.test(normalizedHay)) {
    return true;
  }

  if (
    /\bstand\b/.test(normalizedHay) &&
    !looksLikeDisplayMonitor(normalizedHay) &&
    !/\bmonitor\s+arm\b/.test(normalizedHay) &&
    !/\bdms\d{2,4}\b/.test(normalizedHay) &&
    !/\bdm\d{3,5}\b/.test(normalizedHay)
  ) {
    return true;
  }

  return false;
}

/** Panel-style monitor (inch size, panel type, resolution, refresh, etc.). */
export function looksLikeDisplayMonitor(normalizedHay: string): boolean {
  if (/\b\d{1,2}(\.\d)?\s*(inch|in|")\b/.test(normalizedHay)) return true;
  if (/\b(led|ips|va|oled|qled)\b/.test(normalizedHay) && /\b(panel|display|monitor)\b/.test(normalizedHay)) {
    return true;
  }
  if (/\b(full\s*hd|fhd|qhd|uhd|4k|8k|wqhd)\b/.test(normalizedHay)) return true;
  if (/\b\d{2,3}\s*hz\b/.test(normalizedHay)) return true;
  if (/\b(curved|gaming)\s+monitor\b/.test(normalizedHay)) return true;
  if (/\bmonitor\s+panel\b/.test(normalizedHay)) return true;
  return false;
}

export function buildSelloutClassificationHaystack(
  rawCategory: string,
  rawSubCategory: string,
  productName: string,
): string {
  return normalizeKey(`${rawCategory} ${rawSubCategory} ${productName}`);
}
