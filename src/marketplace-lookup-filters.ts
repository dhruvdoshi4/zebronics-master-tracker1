import { productMatchesDawgAnalysisFilter, productMatchesDawgScope } from "./dawg-scope";
import {
  KARAN_SUB_CATEGORY_FILTER_LABELS,
  KARAN_TRACKED_SUB_CATEGORIES,
  normalizedKaranSubCategory,
  type KaranSubCategory,
} from "./karan-category-scope";
import {
  inferRithikaSubCategory,
  productMatchesRithikaCategoryRollup,
  RITHIKA_SUB_CATEGORY_LABELS,
  RITHIKA_TRACKED_SUB_CATEGORIES,
  type RithikaSubCategory,
} from "./rithika-category-scope";
import { isRishabhHomeAudioSheetCategory } from "./rishabh-category-scope";
export type ProductScopeRow = {
  category?: string | null;
  sub_category?: string | null;
  product_name?: string | null;
};

export type ProductScopeFilter = (row: ProductScopeRow) => boolean;
import {
  SUB_CATEGORY_FILTER_LABELS,
  TRACKED_SUB_CATEGORIES,
  type SubCategory,
} from "./types";
import { normalizeKey } from "./utils";

export const MARKETPLACE_LOOKUP_FILTER_ALL = "all";

export type MarketplaceLookupCategory =
  | typeof MARKETPLACE_LOOKUP_FILTER_ALL
  | "monitor_projector"
  | "cartridge"
  | "gaming-dawg"
  | "personal-audio"
  | "karan_personal_audio"
  | "karan_home_automation"
  | "karan_auto"
  | "karan_gaming"
  | "pravin_roma"
  | "pravin_powerbank"
  | "rithika_it_accessories"
  | "rishabh_home_audio";

export type MarketplaceLookupWorkspace = "hari" | "dawg" | "karan" | "rithika" | "rishabh";

export function marketplaceLookupWorkspace(options: {
  isDawg: boolean;
  isPersonalAudio: boolean;
  isRithika?: boolean;
  isRishabh?: boolean;
}): MarketplaceLookupWorkspace {
  if (options.isDawg) return "dawg";
  if (options.isPersonalAudio) return "karan";
  if (options.isRithika) return "rithika";
  if (options.isRishabh) return "rishabh";
  return "hari";
}

const HARI_CATEGORY_OPTIONS: ReadonlyArray<{ value: MarketplaceLookupCategory; label: string }> = [
  { value: MARKETPLACE_LOOKUP_FILTER_ALL, label: "All categories" },
  { value: "monitor_projector", label: "Monitor & projector" },
  { value: "cartridge", label: "Cartridge" },
];

const DAWG_CATEGORY_OPTIONS: ReadonlyArray<{ value: MarketplaceLookupCategory; label: string }> = [
  { value: MARKETPLACE_LOOKUP_FILTER_ALL, label: "All categories" },
  { value: "gaming-dawg", label: "Gaming - daWg" },
  { value: "personal-audio", label: "Personal Audio" },
];

const KARAN_CATEGORY_OPTIONS: ReadonlyArray<{ value: MarketplaceLookupCategory; label: string }> = [
  { value: MARKETPLACE_LOOKUP_FILTER_ALL, label: "All categories" },
  { value: "karan_personal_audio", label: "Personal audio" },
  { value: "karan_home_automation", label: "Home automation" },
  { value: "karan_auto", label: "Auto & cables" },
  { value: "karan_gaming", label: "Gaming headphones" },
];

const RITHIKA_CATEGORY_OPTIONS: ReadonlyArray<{ value: MarketplaceLookupCategory; label: string }> = [
  { value: MARKETPLACE_LOOKUP_FILTER_ALL, label: "All categories" },
  { value: "rithika_it_accessories", label: "IT Accessories" },
];

const RISHABH_CATEGORY_OPTIONS: ReadonlyArray<{ value: MarketplaceLookupCategory; label: string }> = [
  { value: MARKETPLACE_LOOKUP_FILTER_ALL, label: "All categories" },
  { value: "rishabh_home_audio", label: "Home Audio" },
];

const MONITOR_PROJECTOR_SUBS: readonly SubCategory[] = [
  "monitor",
  "monitor_arm",
  "projector",
  "projector_screen",
];

const DAWG_SUB_BY_CATEGORY: Record<string, readonly string[]> = {
  [MARKETPLACE_LOOKUP_FILTER_ALL]: [
    "gaming-mouse",
    "gaming-keyboard",
    "gaming-headphone",
    "gaming-chassis",
    "gaming-mousepad",
    "aio-cooler",
    "personal-audio",
  ],
  "gaming-dawg": [
    "gaming-mouse",
    "gaming-keyboard",
    "gaming-headphone",
    "gaming-chassis",
    "gaming-mousepad",
    "aio-cooler",
  ],
  "personal-audio": ["personal-audio"],
};

const DAWG_SUB_LABELS: Record<string, string> = {
  "gaming-mouse": "Gaming Mouse",
  "gaming-keyboard": "Gaming Keyboard",
  "gaming-headphone": "Gaming Headphone",
  "gaming-chassis": "Gaming Chassis",
  "gaming-mousepad": "Gaming Mousepad",
  "aio-cooler": "AIO Cooler",
  "personal-audio": "Personal Audio",
};

export function marketplaceLookupCategoryOptions(
  workspace: MarketplaceLookupWorkspace,
): ReadonlyArray<{ value: MarketplaceLookupCategory; label: string }> {
  if (workspace === "dawg") return DAWG_CATEGORY_OPTIONS;
  if (workspace === "karan") return KARAN_CATEGORY_OPTIONS;
  if (workspace === "rithika") return RITHIKA_CATEGORY_OPTIONS;
  if (workspace === "rishabh") return RISHABH_CATEGORY_OPTIONS;
  return HARI_CATEGORY_OPTIONS;
}

function dedupeSubOptions(
  options: ReadonlyArray<{ value: string; label: string }>,
): Array<{ value: string; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ value: string; label: string }> = [];
  for (const opt of options) {
    const key = normalizeKey(opt.value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(opt);
  }
  return out;
}

function rithikaTrackedSubOptions(): Array<{ value: string; label: string }> {
  return RITHIKA_TRACKED_SUB_CATEGORIES.map((value) => ({
    value,
    label: RITHIKA_SUB_CATEGORY_LABELS[value as RithikaSubCategory],
  }));
}

export function marketplaceLookupSubCategoryOptions(
  workspace: MarketplaceLookupWorkspace,
  category: MarketplaceLookupCategory,
  sheetSubs: ReadonlyArray<{ value: string; label: string }> = [],
): ReadonlyArray<{ value: string; label: string }> {
  const all = { value: MARKETPLACE_LOOKUP_FILTER_ALL, label: "All sub-categories" };

  if (workspace === "rithika") {
    if (category !== MARKETPLACE_LOOKUP_FILTER_ALL && category !== "rithika_it_accessories") {
      return [all];
    }
    return [
      all,
      ...dedupeSubOptions([...rithikaTrackedSubOptions(), ...sheetSubs]),
    ];
  }

  if (workspace === "rishabh") {
    if (category !== MARKETPLACE_LOOKUP_FILTER_ALL && category !== "rishabh_home_audio") {
      return [all];
    }
    return [all, ...dedupeSubOptions(sheetSubs)];
  }

  if (workspace === "dawg") {
    const keys = DAWG_SUB_BY_CATEGORY[category] ?? DAWG_SUB_BY_CATEGORY[MARKETPLACE_LOOKUP_FILTER_ALL];
    return [
      all,
      ...keys.map((value) => ({
        value,
        label: DAWG_SUB_LABELS[value] ?? value,
      })),
    ];
  }

  if (workspace === "karan") {
    const subs = KARAN_TRACKED_SUB_CATEGORIES.filter((sub) => {
      if (category === MARKETPLACE_LOOKUP_FILTER_ALL) return true;
      if (category === "karan_personal_audio") return sub.startsWith("personal_audio_");
      if (category === "karan_home_automation") return sub.startsWith("home_automation_");
      if (category === "karan_auto") return sub.startsWith("auto_");
      if (category === "karan_gaming") return sub === "gaming_headphone";
      return true;
    });
    return [
      all,
      ...subs.map((value) => ({
        value,
        label: KARAN_SUB_CATEGORY_FILTER_LABELS[value as KaranSubCategory],
      })),
    ];
  }

  if (category === "cartridge") {
    return [
      all,
      { value: "cartridge", label: SUB_CATEGORY_FILTER_LABELS.cartridge },
    ];
  }
  if (category === "monitor_projector") {
    return [
      all,
      ...MONITOR_PROJECTOR_SUBS.map((value) => ({
        value,
        label: SUB_CATEGORY_FILTER_LABELS[value],
      })),
    ];
  }

  return [
    all,
    ...TRACKED_SUB_CATEGORIES.map((value) => ({
      value,
      label: SUB_CATEGORY_FILTER_LABELS[value],
    })),
  ];
}

function matchesRithikaCategory(category: MarketplaceLookupCategory, row: ProductScopeRow): boolean {
  if (category === MARKETPLACE_LOOKUP_FILTER_ALL) return true;
  if (category !== "rithika_it_accessories") return false;
  const rollupRow = {
    category: row.category ?? null,
    sub_category: row.sub_category ?? null,
    product_name: row.product_name ?? null,
  };
  return (
    inferRithikaSubCategory(rollupRow, "amazon") != null ||
    inferRithikaSubCategory(rollupRow, "flipkart") != null
  );
}

function matchesRishabhCategory(category: MarketplaceLookupCategory, row: ProductScopeRow): boolean {
  if (category === MARKETPLACE_LOOKUP_FILTER_ALL) return true;
  if (category !== "rishabh_home_audio") return false;
  return isRishabhHomeAudioSheetCategory(row.category ?? "");
}

function matchesRithikaSubCategory(subCategory: string, row: ProductScopeRow): boolean {
  const rollupRow = {
    category: row.category ?? null,
    sub_category: row.sub_category ?? null,
    product_name: row.product_name ?? null,
  };
  if (productMatchesRithikaCategoryRollup(subCategory, rollupRow, "amazon")) return true;
  if (productMatchesRithikaCategoryRollup(subCategory, rollupRow, "flipkart")) return true;
  return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
}

function matchesHariCategory(category: MarketplaceLookupCategory, row: ProductScopeRow): boolean {
  if (category === MARKETPLACE_LOOKUP_FILTER_ALL) return true;
  const cat = normalizeKey(row.category ?? "");
  const sub = normalizeKey(row.sub_category ?? "");
  if (category === "cartridge") {
    return cat === "cartridge" || sub === "cartridge";
  }
  if (category === "monitor_projector") {
    return (
      cat.includes("monitor") ||
      cat.includes("projector") ||
      MONITOR_PROJECTOR_SUBS.some((s) => sub === s)
    );
  }
  return true;
}

function matchesKaranCategory(category: MarketplaceLookupCategory, row: ProductScopeRow): boolean {
  if (category === MARKETPLACE_LOOKUP_FILTER_ALL) return true;
  const inferred = normalizedKaranSubCategory(
    String(row.sub_category ?? ""),
    String(row.category ?? ""),
    String(row.product_name ?? ""),
    "amazon",
  );
  if (!inferred) return false;
  if (category === "karan_personal_audio") return inferred.startsWith("personal_audio_");
  if (category === "karan_home_automation") return inferred.startsWith("home_automation_");
  if (category === "karan_auto") return inferred.startsWith("auto_");
  if (category === "karan_gaming") return inferred === "gaming_headphone";
  return true;
}

export function buildMarketplaceLookupScopeFilter(options: {
  workspace: MarketplaceLookupWorkspace;
  category: MarketplaceLookupCategory;
  subCategory: string;
  matchesDashboardScope: (row: ProductScopeRow) => boolean;
}): ProductScopeFilter {
  const { workspace, category, subCategory, matchesDashboardScope } = options;

  return (row) => {
    if (!matchesDashboardScope(row)) return false;

    if (workspace === "dawg") {
      if (category !== MARKETPLACE_LOOKUP_FILTER_ALL) {
        if (!productMatchesDawgAnalysisFilter(category, row)) return false;
      } else if (!productMatchesDawgScope(row)) {
        return false;
      }
      if (subCategory !== MARKETPLACE_LOOKUP_FILTER_ALL) {
        if (!productMatchesDawgAnalysisFilter(subCategory, row)) return false;
      }
      return true;
    }

    if (workspace === "karan") {
      if (!matchesKaranCategory(category, row)) return false;
      if (subCategory !== MARKETPLACE_LOOKUP_FILTER_ALL) {
        const sub = String(row.sub_category ?? "").trim();
        if (sub && normalizeKey(sub) === normalizeKey(subCategory)) return true;
        const inferred = normalizedKaranSubCategory(
          String(row.sub_category ?? ""),
          String(row.category ?? ""),
          String(row.product_name ?? ""),
          "amazon",
        );
        return inferred === subCategory;
      }
      return true;
    }

    if (workspace === "rithika") {
      if (!matchesRithikaCategory(category, row)) return false;
      if (subCategory !== MARKETPLACE_LOOKUP_FILTER_ALL) {
        return matchesRithikaSubCategory(subCategory, row);
      }
      return true;
    }

    if (workspace === "rishabh") {
      if (!matchesRishabhCategory(category, row)) return false;
      if (subCategory !== MARKETPLACE_LOOKUP_FILTER_ALL) {
        return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
      }
      return true;
    }

    if (!matchesHariCategory(category, row)) return false;
    if (subCategory !== MARKETPLACE_LOOKUP_FILTER_ALL) {
      return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
    }
    return true;
  };
}

export function marketplaceLookupFiltersActive(
  category: MarketplaceLookupCategory,
  subCategory: string,
): boolean {
  return category !== MARKETPLACE_LOOKUP_FILTER_ALL || subCategory !== MARKETPLACE_LOOKUP_FILTER_ALL;
}
