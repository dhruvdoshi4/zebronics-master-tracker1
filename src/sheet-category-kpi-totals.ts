/**
 * Sheet-truth category KPI totals: summed from every master row's Category column
 * during parse (before ingest scope filters). Stored on upload notes for KPI cards.
 */
import { getCurrentFyStart } from "./category-sellout-insights";
import {
  isAnalysisCategoryAll,
  isAnalysisSubCategoryAll,
} from "./analysis-category-paths";
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

/** Add one Ecom Sellout row into category buckets (mirrors KPI cell reads in parsers.ts). */
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
  },
): void {
  const category = String(opts.category ?? "").trim();
  if (!category) return;

  const catKey = normalizeKey(category);
  if (!catKey) return;

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
  if (priorFySo <= 0) {
    for (const yearCol of opts.yearSoColumns) {
      if (yearCol.year !== priorFyStart) continue;
      priorFySo += Math.max(0, asNumber(row[yearCol.index]));
    }
  }

  const bucket = totals.get(catKey) ?? emptySheetCategoryKpiBucket();
  bucket.may_mtd_units += mayMtd;
  bucket.apr_so_units += aprSo;
  bucket.prior_fy_so_units += priorFySo;
  bucket.current_fy_so_units += currentFySo;
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

export function lookupSheetCategoryKpiBucket(
  notes: string | null | undefined,
  category: string,
  subCategory: string,
): SheetCategoryKpiBucket | null {
  if (isAnalysisCategoryAll(category) || !isAnalysisSubCategoryAll(subCategory)) {
    return null;
  }
  const doc = parseSheetCategoryKpiTotalsFromUploadNotes(notes);
  if (!doc) return null;
  return doc.byCategory[normalizeKey(category)] ?? null;
}
