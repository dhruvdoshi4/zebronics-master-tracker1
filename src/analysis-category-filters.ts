import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  analysisCategoryFromUrlSegment,
  analysisSubCategoryFromUrlValue,
  isAnalysisCategoryAll,
  isAnalysisSubCategoryAll,
} from "./analysis-category-paths";
import {
  DAWG_ANALYSIS_FILTER_OPTIONS,
  DAWG_SHEET_CATEGORIES,
  productMatchesDawgScope,
} from "./dawg-scope";
import {
  KARAN_SUB_CATEGORY_LABELS,
  KARAN_TRACKED_SUB_CATEGORIES,
  karanDashboardSheetCategoryForKey,
  type KaranSubCategory,
} from "./karan-category-scope";
import {
  PRAVIN_TOP_CATEGORIES,
  pravinTopCategoryForRow,
} from "./pravin-category-scope";
import {
  RITHIKA_SUB_CATEGORY_LABELS,
  RITHIKA_TRACKED_SUB_CATEGORIES,
  inferRithikaSubCategory,
  rithikaDashboardSheetCategoryForKey,
  type RithikaSubCategory,
} from "./rithika-category-scope";
import { getSubCategoryLabel, TRACKED_SUB_CATEGORIES, type SubCategory } from "./types";
import { normalizeKey } from "./utils";

export const KARAN_ANALYSIS_TOP_CATEGORIES = [
  "Personal Audio",
  "Home Automation",
  "ROMA",
  "IT Accessories",
] as const;

export const RITHIKA_ANALYSIS_TOP_CATEGORIES = ["IT Accessories"] as const;

/**
 * Admin global category analysis — only these top-level categories exist across managers.
 * (Not daWg / QCom.)
 */
export const ADMIN_GLOBAL_ANALYSIS_CATEGORY_ORDER = [
  "Cartridge",
  "Monitor & Acc.",
  "Projector & Acc.",
  "Personal Audio",
  "Home Audio",
  "Home Automation",
  "IT Accessories",
  "ROMA",
  "PowerBank",
] as const;

/** Authoritative category + sub source per manager (for docs / ordering). */
export const MANAGER_ANALYSIS_CATEGORY_MANIFEST = {
  Hari: {
    categories: ["Cartridge", "Monitor & Acc.", "Projector & Acc."],
    subSource: "Sheet Category + Sub category; Hari tracked keys (monitor, cartridge, …)",
  },
  Karan: {
    categories: [...KARAN_ANALYSIS_TOP_CATEGORIES],
    subSource: "Tracked keys (personal_audio_*, home_automation_*, auto_*, gaming_headphone)",
  },
  Rithika: {
    categories: [...RITHIKA_ANALYSIS_TOP_CATEGORIES],
    subSource: "Tracked keys (rithika_*) + sheet Sub category labels under IT Accessories",
  },
  Pravin: {
    categories: [...PRAVIN_TOP_CATEGORIES],
    subSource: "Sheet Sub category labels grouped into ROMA vs PowerBank",
  },
  Rishabh: {
    categories: ["Home Audio"],
    subSource: "Sheet Sub category labels under Home Audio",
  },
} as const;

export function sortAdminGlobalAnalysisCategories(categories: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const cat of categories) {
    const trimmed = cat.trim();
    if (trimmed && trimmed !== ANALYSIS_CATEGORY_ALL) set.add(trimmed);
  }
  const orderIndex = new Map(
    ADMIN_GLOBAL_ANALYSIS_CATEGORY_ORDER.map((cat, index) => [normalizeKey(cat), index]),
  );
  return [...set].sort((a, b) => {
    const ai = orderIndex.get(normalizeKey(a));
    const bi = orderIndex.get(normalizeKey(b));
    if (ai != null && bi != null) return ai - bi;
    if (ai != null) return -1;
    if (bi != null) return 1;
    return a.localeCompare(b, "en-IN");
  });
}

/** Collapse subs that normalize to the same key (prefer tracked / shorter token). */
export function dedupeAnalysisSubCategories(subs: Iterable<string>): string[] {
  const byKey = new Map<string, string>();
  for (const raw of subs) {
    const sub = raw.trim();
    if (!sub) continue;
    const key = normalizeKey(sub);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, sub);
      continue;
    }
    const preferExisting =
      existing.startsWith("personal_audio_") ||
      existing.startsWith("home_automation_") ||
      existing.startsWith("auto_") ||
      existing.startsWith("rithika_") ||
      existing === "gaming_headphone" ||
      TRACKED_SUB_CATEGORIES.includes(existing as SubCategory);
    const preferNew =
      sub.startsWith("personal_audio_") ||
      sub.startsWith("home_automation_") ||
      sub.startsWith("auto_") ||
      sub.startsWith("rithika_") ||
      sub === "gaming_headphone" ||
      TRACKED_SUB_CATEGORIES.includes(sub as SubCategory);
    if (!preferExisting && preferNew) byKey.set(key, sub);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "en-IN"));
}

/** Old Rithika analysis buckets — sheet Category is always IT Accessories. */
const RITHIKA_LEGACY_ANALYSIS_CATEGORIES = new Set([
  normalizeKey("Complete IT"),
  normalizeKey("Gaming"),
  normalizeKey("Speakers"),
  normalizeKey("ROMA"),
]);

export function migrateLegacyRithikaAnalysisCategory(
  category: string,
  opts?: { includeRoma?: boolean },
): string {
  const norm = normalizeKey(category);
  if (!norm) return category;
  if (RITHIKA_LEGACY_ANALYSIS_CATEGORIES.has(norm)) {
    if (norm === normalizeKey("ROMA") && opts?.includeRoma === false) return category;
    return "IT Accessories";
  }
  return category;
}

export function migrateLegacyRithikaAnalysisUrlSegment(
  segment: string,
  opts?: { includeRoma?: boolean },
): { category: string; subCategory: string } | null {
  const category = analysisCategoryFromUrlSegment(segment);
  if (isAnalysisCategoryAll(category)) return null;
  const migrated = migrateLegacyRithikaAnalysisCategory(category, opts);
  if (normalizeKey(migrated) === normalizeKey(category)) return null;
  return { category: migrated, subCategory: ANALYSIS_SUB_CATEGORY_ALL };
}

/** Hari tracked sub keys from raw sheet / stored sub_category text. */
export function normalizeHariSubCategoryValue(raw: string): string | null {
  const key = normalizeKey(raw);
  if (!key) return null;
  if (key === "monitor") return "monitor";
  if (key === "monitor arm" || key === "monitor_arm") return "monitor_arm";
  if (key === "projector" || key === "projectors") return "projector";
  if (key === "projector screen" || key === "projector_screen") return "projector_screen";
  if (key === "cartridge" || key === "cartridges") return "cartridge";
  return null;
}

/** Display label for a sub-category filter value (admin global + per-manager). */
export function analysisSubCategoryOptionLabel(subValue: string): string {
  if (subValue in KARAN_SUB_CATEGORY_LABELS) {
    return KARAN_SUB_CATEGORY_LABELS[subValue as KaranSubCategory];
  }
  if (subValue in RITHIKA_SUB_CATEGORY_LABELS) {
    return RITHIKA_SUB_CATEGORY_LABELS[subValue as RithikaSubCategory];
  }
  const hari = normalizeHariSubCategoryValue(subValue);
  if (hari) return getSubCategoryLabel(hari);
  return subValue;
}

export type AnalysisCategoryTree = {
  categories: string[];
  subCategoriesByCategory: Record<string, string[]>;
};

/** Map legacy single-segment daWg URLs (`/analysis/category/gaming-keyboard`). */
export function migrateLegacyDawgAnalysisUrlSegment(
  segment: string,
): { category: string; subCategory: string } | null {
  const key = decodeURIComponent(segment).trim().toLowerCase();
  if (!DAWG_ANALYSIS_FILTER_OPTIONS.some((o) => o.key === key)) return null;
  if (key === "all") {
    return { category: ANALYSIS_CATEGORY_ALL, subCategory: ANALYSIS_SUB_CATEGORY_ALL };
  }
  if (key === "gaming-dawg" || key === "personal-audio") {
    return {
      category: analysisCategoryFromUrlSegment(key),
      subCategory: ANALYSIS_SUB_CATEGORY_ALL,
    };
  }
  const subLabel = analysisSubCategoryFromUrlValue(key);
  if (subLabel !== ANALYSIS_SUB_CATEGORY_ALL && subLabel !== key) {
    return {
      category: "Gaming - daWg",
      subCategory: subLabel,
    };
  }
  return null;
}

/** Map legacy Hari URL that used tracked sub-category as the only segment. */
export function migrateLegacyMonitorAnalysisUrlSegment(
  segment: string,
): { category: string; subCategory: string } | null {
  const decoded = decodeURIComponent(segment).trim();
  if (decoded === ANALYSIS_CATEGORY_ALL) {
    return { category: ANALYSIS_CATEGORY_ALL, subCategory: ANALYSIS_SUB_CATEGORY_ALL };
  }
  if (TRACKED_SUB_CATEGORIES.includes(decoded as SubCategory)) {
    return { category: ANALYSIS_CATEGORY_ALL, subCategory: decoded };
  }
  return null;
}

export function productMatchesDawgCategoryAnalysis(
  category: string,
  subCategory: string,
  row: { category?: string | null; sub_category?: string | null },
): boolean {
  if (!productMatchesDawgScope(row)) return false;
  if (isAnalysisCategoryAll(category)) {
    if (isAnalysisSubCategoryAll(subCategory)) return true;
    return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
  }
  if (normalizeKey(row.category ?? "") !== normalizeKey(category)) return false;
  if (isAnalysisSubCategoryAll(subCategory)) return true;
  return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
}

/** Karan: dashboard top categories with tracked sub keys. */
export function buildKaranAnalysisCategoryTree(): AnalysisCategoryTree {
  const subsByCat: Record<string, string[]> = {};
  for (const cat of KARAN_ANALYSIS_TOP_CATEGORIES) {
    subsByCat[cat] = [];
  }
  for (const sub of KARAN_TRACKED_SUB_CATEGORIES) {
    const cat = karanDashboardSheetCategoryForKey(sub);
    if (!subsByCat[cat]) subsByCat[cat] = [];
    subsByCat[cat].push(sub);
  }
  const sort = (a: string, b: string) => a.localeCompare(b);
  for (const cat of Object.keys(subsByCat)) {
    subsByCat[cat].sort(sort);
  }
  return {
    categories: [ANALYSIS_CATEGORY_ALL, ...KARAN_ANALYSIS_TOP_CATEGORIES],
    subCategoriesByCategory: {
      [ANALYSIS_CATEGORY_ALL]: [...KARAN_TRACKED_SUB_CATEGORIES].sort(sort),
      ...subsByCat,
    },
  };
}

/** Rithika: dashboard top categories; subs = tracked keys + live sheet sub labels. */
export function buildRithikaAnalysisCategoryTree(
  sheetSubs: string[] = [],
): AnalysisCategoryTree {
  const subsByCat: Record<string, Set<string>> = {};
  for (const cat of RITHIKA_ANALYSIS_TOP_CATEGORIES) {
    subsByCat[cat] = new Set<string>();
  }

  for (const key of RITHIKA_TRACKED_SUB_CATEGORIES) {
    const cat = rithikaDashboardSheetCategoryForKey(key);
    if (!subsByCat[cat]) subsByCat[cat] = new Set();
    subsByCat[cat].add(key);
  }

  for (const sub of sheetSubs) {
    const trimmed = sub.trim();
    if (!trimmed) continue;
    for (const mp of ["amazon", "flipkart"] as const) {
      const inferred = inferRithikaSubCategory(
        { category: "", sub_category: trimmed, product_name: "" },
        mp,
      );
      if (!inferred) continue;
      const cat = rithikaDashboardSheetCategoryForKey(inferred);
      if (!subsByCat[cat]) subsByCat[cat] = new Set();
      subsByCat[cat].add(trimmed);
      break;
    }
  }

  const sort = (a: string, b: string) => a.localeCompare(b);
  const subCategoriesByCategory: Record<string, string[]> = {};
  const allSubs = new Set<string>();
  for (const [cat, set] of Object.entries(subsByCat)) {
    const arr = [...set].sort(sort);
    subCategoriesByCategory[cat] = arr;
    for (const s of arr) allSubs.add(s);
  }
  subCategoriesByCategory[ANALYSIS_CATEGORY_ALL] = [...allSubs].sort(sort);

  return {
    categories: [ANALYSIS_CATEGORY_ALL, ...RITHIKA_ANALYSIS_TOP_CATEGORIES],
    subCategoriesByCategory,
  };
}

/** Pravin: ROMA + PowerBank top categories; subs from sheet labels. */
export function buildPravinAnalysisCategoryTree(
  sheetSubs: string[],
): AnalysisCategoryTree {
  const romaSubs: string[] = [];
  const powerBankSubs: string[] = [];
  const allSubs = new Set<string>();
  for (const sub of sheetSubs) {
    const trimmed = sub.trim();
    if (!trimmed) continue;
    allSubs.add(trimmed);
    const top = pravinTopCategoryForRow("", trimmed, trimmed);
    if (top === "PowerBank") powerBankSubs.push(trimmed);
    else if (top === "ROMA") romaSubs.push(trimmed);
  }
  const sort = (a: string, b: string) => a.localeCompare(b);
  return {
    categories: [ANALYSIS_CATEGORY_ALL, ...PRAVIN_TOP_CATEGORIES],
    subCategoriesByCategory: {
      [ANALYSIS_CATEGORY_ALL]: [...allSubs].sort(sort),
      ROMA: romaSubs.sort(sort),
      PowerBank: powerBankSubs.sort(sort),
    },
  };
}

/** Static daWg category tree (sheet categories are fixed). */
export function buildDawgAnalysisCategoryTree(): AnalysisCategoryTree {
  const gamingSubs = [
    "Gaming Mouse",
    "Gaming Keyboard",
    "Gaming Headphone",
    "Gaming Chassis",
    "Gaming Mousepad",
    "AIO Cooler",
  ];
  const categories = [ANALYSIS_CATEGORY_ALL, ...DAWG_SHEET_CATEGORIES];
  const subCategoriesByCategory: Record<string, string[]> = {
    [ANALYSIS_CATEGORY_ALL]: [...gamingSubs],
    "Gaming - daWg": gamingSubs,
    "Personal Audio": [],
  };
  return { categories, subCategoriesByCategory };
}

export function mergeAnalysisCategoryTree(
  a: AnalysisCategoryTree,
  b: AnalysisCategoryTree,
): AnalysisCategoryTree {
  const categories = new Set<string>([ANALYSIS_CATEGORY_ALL]);
  const subCategoriesByCategory: Record<string, string[]> = {
    [ANALYSIS_CATEGORY_ALL]: [],
  };

  for (const c of [...a.categories, ...b.categories]) {
    if (!isAnalysisCategoryAll(c)) categories.add(c);
  }
  for (const cat of categories) {
    if (isAnalysisCategoryAll(cat)) continue;
    const subs = new Set<string>();
    for (const list of [a.subCategoriesByCategory[cat], b.subCategoriesByCategory[cat]]) {
      for (const sub of list ?? []) {
        if (sub.trim()) subs.add(sub.trim());
      }
    }
    subCategoriesByCategory[cat] = [...subs].sort((x, y) => x.localeCompare(y));
  }

  const allSubs = new Set<string>();
  for (const list of Object.values(subCategoriesByCategory)) {
    for (const sub of list) {
      if (sub.trim()) allSubs.add(sub.trim());
    }
  }
  subCategoriesByCategory[ANALYSIS_CATEGORY_ALL] = [...allSubs].sort((x, y) =>
    x.localeCompare(y),
  );

  return {
    categories: [ANALYSIS_CATEGORY_ALL, ...[...categories].filter((c) => !isAnalysisCategoryAll(c)).sort()],
    subCategoriesByCategory,
  };
}

export function treeFromProductMasterRows(
  rows: Array<{
    marketplace: string;
    product_code: string;
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
  }>,
  allowedByMarketplace: { amazon: Set<string>; flipkart: Set<string> },
  matchesScope: (row: (typeof rows)[number]) => boolean,
): AnalysisCategoryTree {
  const categories = new Set<string>();
  const subs = new Map<string, Set<string>>();

  for (const row of rows) {
    if (!matchesScope(row)) continue;
    const code = String(row.product_code ?? "").trim();
    const codeUpper = code.toUpperCase();
    const mp = row.marketplace;
    const allowed =
      mp === "amazon"
        ? allowedByMarketplace.amazon
        : mp === "flipkart"
          ? allowedByMarketplace.flipkart
          : null;
    if (!allowed || (!allowed.has(code) && !allowed.has(codeUpper))) continue;

    const cat = String(row.category ?? "").trim();
    if (!cat) continue;
    categories.add(cat);
    const sub = String(row.sub_category ?? "").trim();
    if (!subs.has(cat)) subs.set(cat, new Set());
    if (sub) subs.get(cat)!.add(sub);
  }

  const sortedCategories = [...categories].sort((a, b) => a.localeCompare(b));
  const subCategoriesByCategory: Record<string, string[]> = {};
  const allSubs = new Set<string>();
  for (const cat of sortedCategories) {
    const catSubs = [...(subs.get(cat) ?? [])].sort((a, b) => a.localeCompare(b));
    subCategoriesByCategory[cat] = catSubs;
    for (const sub of catSubs) allSubs.add(sub);
  }
  subCategoriesByCategory[ANALYSIS_CATEGORY_ALL] = [...allSubs].sort((a, b) =>
    a.localeCompare(b),
  );

  return {
    categories: [ANALYSIS_CATEGORY_ALL, ...sortedCategories],
    subCategoriesByCategory,
  };
}
