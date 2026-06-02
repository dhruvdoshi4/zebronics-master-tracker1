import { sheetCategoryHaystack } from "./catalog-workspace";
import {
  GAMING_HEADPHONE_SUB_LABEL,
  isGamingHeadphoneSub,
  isSpeaker20Sub,
} from "./shared-ecom-subcategory-scope";
import { isPravinManagedRomaSub } from "./pravin-category-scope";
import { isRishabhHomeAudioSpeakerProduct } from "./rishabh-category-scope";
import { looksLikeDisplayMonitor } from "./sellout-category-scope";
import { normalizeKey } from "./utils";

export const RITHIKA_TOP_CATEGORIES = ["IT Accessories", "Components", "Gaming"] as const;

export type RithikaTopCategory = (typeof RITHIKA_TOP_CATEGORIES)[number];

/** Confirm with ops before adding — non-exhaustive IT Accessories from master. */
export const RITHIKA_IT_ACCESSORIES_SUB_CATEGORIES = [
  "Aux Convertor",
  "Cleaning Kits",
  "Cooling Pad",
  "HDMI Adapter",
  "HDMI Cable",
  "LAN Adaptor",
  "Lapdesk",
  "Laptop Adaptor",
  "Laptop Stand",
  "Mini Adaptor",
  "MousePad",
  "OTG Adapter",
  "Patch Cable",
  "PC Cables",
  "Power Strip",
  "Power Supply",
  "Presentation Pointer",
  "Printer Cable",
  "Selfie Stick",
  "Stylus Pen",
  "UPS",
  "USB Cables",
  "USB Hub",
  "Web Camera",
  "Wired Combo",
  "Wired Keyboard",
  "Wired Mouse",
  "Wireless Combo",
  "Wireless Keyboard",
  "Wireless Mouse",
  "Wrist Ease",
  GAMING_HEADPHONE_SUB_LABEL,
  "2.0 Speaker",
] as const;

export const RITHIKA_COMPONENTS_SUB_CATEGORIES = [
  "Desktop Ram",
  "Graphic Card",
  "Motherboard",
  "SSD Card",
  "SSD Case",
] as const;

export const RITHIKA_GAMING_SUB_CATEGORIES = [
  "AIO Cooler",
  "Desk Mat",
  "Gaming Chasis",
  "Gaming Chassis",
  "Gaming Headphone",
  "Gaming JoyPad",
  "Gaming Keyboard",
  "Gaming Mic",
  "Gaming Mouse",
  "Gaming Mousepad",
  "Gaming Power Supply",
  "Headphone Stand",
  "Joypad Dock",
  "Mobile Cooler",
  "Gaming Combo",
  "Mechanical Keyboard",
] as const;

export const RITHIKA_ALL_SHEET_SUB_CATEGORIES: readonly string[] = [
  ...RITHIKA_IT_ACCESSORIES_SUB_CATEGORIES,
  ...RITHIKA_COMPONENTS_SUB_CATEGORIES,
  ...RITHIKA_GAMING_SUB_CATEGORIES,
];

const SUB_TO_TOP = new Map<string, RithikaTopCategory>();

function registerSubs(top: RithikaTopCategory, subs: readonly string[]): void {
  for (const sub of subs) {
    SUB_TO_TOP.set(normalizeKey(sub), top);
  }
}

registerSubs("IT Accessories", RITHIKA_IT_ACCESSORIES_SUB_CATEGORIES);
registerSubs("Components", RITHIKA_COMPONENTS_SUB_CATEGORIES);
registerSubs("Gaming", RITHIKA_GAMING_SUB_CATEGORIES);

function canonicalSubLabel(raw: string): string | null {
  const key = normalizeKey(raw);
  if (!key) return null;
  for (const sub of RITHIKA_ALL_SHEET_SUB_CATEGORIES) {
    if (normalizeKey(sub) === key) return sub;
  }
  if (key.includes("chasis") || key.includes("chassis")) {
    return RITHIKA_GAMING_SUB_CATEGORIES.find((s) => normalizeKey(s).includes("chassis")) ?? "Gaming Chassis";
  }
  return null;
}

function topFromCategoryColumn(rawCategory: string): RithikaTopCategory | null {
  const cat = normalizeKey(rawCategory);
  if (cat.includes("component")) return "Components";
  if (cat.includes("gaming")) return "Gaming";
  if (cat.includes("it accessor") || cat === "complete it" || cat === "pc") return "IT Accessories";
  return null;
}

export function resolveRithikaTaxonomy(
  rawSubCategory: string,
  rawCategory: string,
  productName: string,
): { top: RithikaTopCategory; sub: string } | null {
  const hay = sheetCategoryHaystack(rawCategory, rawSubCategory, productName);
  if (isHariDisplayProduct(hay)) return null;
  if (isRishabhHomeAudioSpeakerProduct(rawCategory, rawSubCategory, productName)) return null;
  if (isPravinManagedRomaSub(rawSubCategory, rawCategory)) return null;

  const subLabel = canonicalSubLabel(rawSubCategory);
  if (subLabel) {
    const top = SUB_TO_TOP.get(normalizeKey(subLabel)) ?? topFromCategoryColumn(rawCategory);
    if (top) return { top, sub: subLabel };
  }

  if (isGamingHeadphoneSub(rawSubCategory, rawCategory, productName)) {
    return { top: "IT Accessories", sub: GAMING_HEADPHONE_SUB_LABEL };
  }
  if (isSpeaker20Sub(rawSubCategory, rawCategory, productName)) {
    return { top: "IT Accessories", sub: "2.0 Speaker" };
  }

  const topOnly = topFromCategoryColumn(rawCategory);
  if (topOnly && subLabel) return { top: topOnly, sub: subLabel };

  return null;
}

function isHariDisplayProduct(hay: string): boolean {
  return looksLikeDisplayMonitor(hay);
}

export function rithikaTopCategoryForSub(sub: string): RithikaTopCategory | null {
  return SUB_TO_TOP.get(normalizeKey(sub)) ?? null;
}

/** Dashboard sub filter — canonical sheet subs per top category. */
export function rithikaDashboardSubCategoryDisplayOptions(topCategory: string): string[] {
  const sort = (a: string, b: string) =>
    a.localeCompare(b, "en-IN", { numeric: true, sensitivity: "base" });
  if (topCategory === "all") return [...RITHIKA_ALL_SHEET_SUB_CATEGORIES].sort(sort);
  if (normalizeKey(topCategory) === normalizeKey("IT Accessories")) {
    return [...RITHIKA_IT_ACCESSORIES_SUB_CATEGORIES].sort(sort);
  }
  if (normalizeKey(topCategory) === normalizeKey("Components")) {
    return [...RITHIKA_COMPONENTS_SUB_CATEGORIES].sort(sort);
  }
  if (normalizeKey(topCategory) === normalizeKey("Gaming")) {
    return [...RITHIKA_GAMING_SUB_CATEGORIES].sort(sort);
  }
  return [];
}
