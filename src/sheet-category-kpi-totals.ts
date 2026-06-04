/**
 * Sheet-truth category KPI totals: summed from every master row's Category column
 * during parse (before ingest scope filters). Stored on upload notes for KPI cards.
 */
import { getCurrentFyStart } from "./category-sellout-insights";
import { isAnalysisCategoryAll } from "./analysis-category-paths";
import {
  isMonitorAccessorySheetCategory,
  isProjectorAccessorySheetCategory,
} from "./hari-dashboard-scope";
import { isCartridgeSheetCategory } from "./sellout-category-scope";
import { normalizeKey } from "./utils";

export type SheetCategoryKpiBucket = {
  may_mtd_units: number;
  apr_so_units: number;
  prior_fy_so_units: number;
  current_fy_so_units: number;
  sku_count: number;
};

export type SheetCategoryKpiTotalsDoc = {
  byCategory: Record<string, SheetCategoryKpiBucket>;
};

export function emptySheetCategoryKpiBucket(): SheetCategoryKpiBucket {
  return {
    may_mtd_units: 0,
    apr_so_units: 0,
    prior_fy_so_units: 0,
    current_fy_so_units: 0,
    sku_count: 0,
  };
}

export function createSheetCategoryKpiTotalsMap(): Map<string, SheetCategoryKpiBucket> {
  return new Map();
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

type FySoCol = { index: number; fyStart: number };
type YearSoCol = { index: number; year: number };

export type SheetCategoryKpiRowCells = {
  mayMtd: number;
  aprSo: number;
  priorFySo: number;
  currentFySo: number;
};

/** Read FY / MTD cells from one sellout row (same rules as ingest KPI metrics). */
export function readSheetCategoryKpiCellsFromRow(
  row: unknown[],
  opts: {
    columnIndices: {
      currentMonthMtdIndex: number;
      previousMonthSoIndex: number;
    };
    fySoColumns: FySoCol[];
    yearSoColumns: YearSoCol[];
    effectiveSnapshotDate: string;
  },
): SheetCategoryKpiRowCells {
  const { currentMonthMtdIndex, previousMonthSoIndex } = opts.columnIndices;
  const mayMtd = currentMonthMtdIndex >= 0 ? Math.max(0, asNumber(row[currentMonthMtdIndex])) : 0;
  const aprSo = previousMonthSoIndex >= 0 ? Math.max(0, asNumber(row[previousMonthSoIndex])) : 0;

  const reportFyStart = getCurrentFyStart(new Date(`${opts.effectiveSnapshotDate}T12:00:00`));
  const priorFyStart = reportFyStart - 1;
  let priorFySo = 0;
  let currentFySo = 0;
  for (const fyCol of opts.fySoColumns) {
    const units = Math.max(0, asNumber(row[fyCol.index]));
    if (fyCol.fyStart === priorFyStart) priorFySo += units;
    if (fyCol.fyStart === reportFyStart) currentFySo += units;
  }
  for (const yearCol of opts.yearSoColumns) {
    const units = Math.max(0, asNumber(row[yearCol.index]));
    if (yearCol.year === priorFyStart && priorFySo <= 0) priorFySo += units;
    if (yearCol.year === reportFyStart) currentFySo += units;
  }

  return { mayMtd, aprSo, priorFySo, currentFySo };
}

/** Per category + listing: one row per SKU (Cocoblu + Click_tect must not double-count FY SO). */
export type SheetCategoryKpiDedupeState = Map<string, Map<string, SheetCategoryKpiRowCells>>;

export function createSheetCategoryKpiDedupeState(): SheetCategoryKpiDedupeState {
  return new Map();
}

function mergeSheetCategoryKpiCells(
  prev: SheetCategoryKpiRowCells,
  next: SheetCategoryKpiRowCells,
  additive: boolean,
): SheetCategoryKpiRowCells {
  if (additive) {
    return {
      mayMtd: prev.mayMtd + next.mayMtd,
      aprSo: prev.aprSo + next.aprSo,
      priorFySo: prev.priorFySo + next.priorFySo,
      currentFySo: prev.currentFySo + next.currentFySo,
    };
  }
  return {
    mayMtd: Math.max(prev.mayMtd, next.mayMtd),
    aprSo: Math.max(prev.aprSo, next.aprSo),
    priorFySo: Math.max(prev.priorFySo, next.priorFySo),
    currentFySo: Math.max(prev.currentFySo, next.currentFySo),
  };
}

function rebuildTotalsFromDedupeState(
  totals: Map<string, SheetCategoryKpiBucket>,
  dedupe: SheetCategoryKpiDedupeState,
): void {
  totals.clear();
  for (const [catKey, byCode] of dedupe) {
    const bucket = emptySheetCategoryKpiBucket();
    for (const cells of byCode.values()) {
      bucket.may_mtd_units += cells.mayMtd;
      bucket.apr_so_units += cells.aprSo;
      bucket.prior_fy_so_units += cells.priorFySo;
      bucket.current_fy_so_units += cells.currentFySo;
      bucket.sku_count += 1;
    }
    totals.set(catKey, bucket);
  }
}

/**
 * Add one sellout row into category buckets.
 * When `dedupeState` + `productCode` are set, each SKU is counted once per category (max FY cells).
 */
export function accumulateSheetCategoryKpiFromSelloutRow(
  totals: Map<string, SheetCategoryKpiBucket>,
  row: unknown[],
  opts: {
    category: string;
    columnIndices: {
      currentMonthMtdIndex: number;
      previousMonthSoIndex: number;
    };
    fySoColumns: FySoCol[];
    yearSoColumns: YearSoCol[];
    effectiveSnapshotDate: string;
    productCode?: string;
    dedupeState?: SheetCategoryKpiDedupeState;
    dedupeMergeAdditive?: boolean;
  },
): void {
  const category = String(opts.category ?? "").trim();
  if (!category) return;

  const catKey = normalizeKey(category);
  if (!catKey) return;

  const cells = readSheetCategoryKpiCellsFromRow(row, opts);
  const codeKey = normalizeKey(String(opts.productCode ?? "").trim());

  if (opts.dedupeState && codeKey) {
    const byCode = opts.dedupeState.get(catKey) ?? new Map<string, SheetCategoryKpiRowCells>();
    const prev = byCode.get(codeKey);
    byCode.set(
      codeKey,
      prev
        ? mergeSheetCategoryKpiCells(prev, cells, Boolean(opts.dedupeMergeAdditive))
        : cells,
    );
    opts.dedupeState.set(catKey, byCode);
    rebuildTotalsFromDedupeState(totals, opts.dedupeState);
    return;
  }

  const bucket = totals.get(catKey) ?? emptySheetCategoryKpiBucket();
  bucket.may_mtd_units += cells.mayMtd;
  bucket.apr_so_units += cells.aprSo;
  bucket.prior_fy_so_units += cells.priorFySo;
  bucket.current_fy_so_units += cells.currentFySo;
  bucket.sku_count += 1;
  totals.set(catKey, bucket);
}

export function finalizeSheetCategoryKpiTotals(
  totals: Map<string, SheetCategoryKpiBucket>,
): SheetCategoryKpiTotalsDoc {
  const byCategory: Record<string, SheetCategoryKpiBucket> = {};
  for (const [key, bucket] of totals) {
    byCategory[key] = bucket;
  }
  return { byCategory };
}

export function parseSheetCategoryKpiTotalsFromUploadNotes(
  notes: string | null | undefined,
): SheetCategoryKpiTotalsDoc | null {
  const raw = String(notes ?? "").trim();
  if (!raw.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw) as { sheetCategoryKpis?: SheetCategoryKpiTotalsDoc };
    const doc = parsed.sheetCategoryKpis;
    if (!doc?.byCategory || typeof doc.byCategory !== "object") return null;
    return doc;
  } catch {
    return null;
  }
}

function sheetCategoryKpiBucketMatchesSelection(
  bucketKey: string,
  category: string,
): boolean {
  if (bucketKey === normalizeKey(category)) return true;
  if (isCartridgeSheetCategory(category) && isCartridgeSheetCategory(bucketKey)) {
    return true;
  }
  if (isMonitorAccessorySheetCategory(category) && isMonitorAccessorySheetCategory(bucketKey)) {
    return true;
  }
  if (isProjectorAccessorySheetCategory(category) && isProjectorAccessorySheetCategory(bucketKey)) {
    return true;
  }
  return false;
}

export function lookupSheetCategoryKpiBucket(
  notes: string | null | undefined,
  category: string,
  _subCategory: string,
): SheetCategoryKpiBucket | null {
  void _subCategory;
  if (isAnalysisCategoryAll(category)) {
    return null;
  }
  const doc = parseSheetCategoryKpiTotalsFromUploadNotes(notes);
  if (!doc) return null;
  const exact = doc.byCategory[normalizeKey(category)];
  if (exact) return exact;
  for (const [bucketKey, bucket] of Object.entries(doc.byCategory)) {
    if (sheetCategoryKpiBucketMatchesSelection(bucketKey, category)) return bucket;
  }
  return null;
}

export type SheetCategoryKpiMetricField = keyof Pick<
  SheetCategoryKpiBucket,
  "may_mtd_units" | "apr_so_units" | "prior_fy_so_units" | "current_fy_so_units"
>;

/**
 * Resolve one KPI cell per channel. Never let the other marketplace's upload notes
 * short-circuit this channel — when notes are missing/zero but SKUs exist, use upload rollup.
 */
export async function resolveCategoryChannelKpiMetric(
  bucket: SheetCategoryKpiBucket | null,
  metric: SheetCategoryKpiMetricField,
  sumFromUpload: () => Promise<number>,
): Promise<number> {
  if (bucket) {
    const fromNotes = Number(bucket[metric] ?? 0);
    if (fromNotes > 0) return fromNotes;
    if ((bucket.sku_count ?? 0) > 0) {
      const fromUpload = await sumFromUpload();
      return fromUpload > 0 ? fromUpload : fromNotes;
    }
    return fromNotes;
  }
  return sumFromUpload();
}
