/**
 * Sheet-truth Amazon PowerBank KPIs for Pravin category analysis.
 * Month units come from Event SO day columns (Excel serial headers) rolled up by month,
 * plus the sheet **May** column for the prior month and **Jun MTD** for the report month.
 */
import {
  applyPriorFySoToMonthlyMaps,
  currentFyMonthYms,
  priorFyMonthYms,
  sumFyUnitsFromMonthColumnsAndReportMtd,
  type CategorySheetMonthlySellout,
} from "./category-sellout-insights";
import type { SheetCategoryKpiDedupeState } from "./sheet-category-kpi-totals";
import { normalizeMarketplaceProductCode } from "./utils";
import {
  parsePravinPowerBankAmazonSheetKpisFromUploadNotes,
  type PravinPowerBankAmazonSheetKpis,
} from "./upload-notes";

export type { PravinPowerBankAmazonSheetKpis };
export { parsePravinPowerBankAmazonSheetKpisFromUploadNotes };

export function countPravinPowerBankAmazonListings(
  cocobluProductCodes: Iterable<string>,
  dedupe?: SheetCategoryKpiDedupeState | null,
): number {
  const seen = new Set<string>();
  for (const raw of cocobluProductCodes) {
    const key = normalizeMarketplaceProductCode("amazon", String(raw ?? "").trim());
    if (key) seen.add(key);
  }
  const bucket = dedupe?.get("powerbank");
  if (bucket) {
    for (const codeKey of bucket.keys()) {
      const k = normalizeMarketplaceProductCode("amazon", codeKey) || codeKey;
      if (k) seen.add(k);
    }
  }
  return seen.size;
}

export function buildPravinPowerBankAmazonSheetKpisFromMonthTotals(
  monthTotals: Record<string, number>,
  snapshotDate: string,
  mayMtdUnits: number,
  listingCount: number,
): PravinPowerBankAmazonSheetKpis {
  const monthly = new Map<string, number>();
  for (const [ym, units] of Object.entries(monthTotals)) {
    const n = Number(units ?? 0);
    if (/^\d{4}-\d{2}$/.test(ym) && Number.isFinite(n) && n > 0) {
      monthly.set(ym, n);
    }
  }
  const reportYm = snapshotDate.slice(0, 7);
  return {
    listingCount,
    may_mtd_units: mayMtdUnits,
    prior_fy_from_month_columns: sumFyUnitsFromMonthColumnsAndReportMtd(
      monthly,
      priorFyMonthYms(snapshotDate),
      reportYm,
      mayMtdUnits,
    ),
    current_fy_from_month_columns: sumFyUnitsFromMonthColumnsAndReportMtd(
      monthly,
      currentFyMonthYms(snapshotDate),
      reportYm,
      mayMtdUnits,
    ),
  };
}

function sumPriorFyMonthsInMap(
  monthly: Map<string, number>,
  snapshotDate: string,
): number {
  const reportYm = snapshotDate.slice(0, 7);
  return sumFyUnitsFromMonthColumnsAndReportMtd(
    monthly,
    priorFyMonthYms(snapshotDate),
    reportYm,
    0,
  );
}

/** Merge DB month roll-up with parse-time notes (prefer larger per month). */
export function mergePravinPowerBankAmazonMonthMaps(
  fromDaily: Map<string, number>,
  fromNotes: Map<string, number>,
): Map<string, number> {
  const out = new Map(fromDaily);
  for (const [ym, units] of fromNotes) {
    const prev = out.get(ym) ?? 0;
    if (units > prev) out.set(ym, units);
  }
  return out;
}

export function resolvePravinPowerBankAmazonSheetKpis(
  monthMap: Map<string, number>,
  snapshotDate: string,
  reportMtdAmazon: number,
  listingCount: number,
  notes: string | null | undefined,
): PravinPowerBankAmazonSheetKpis | null {
  let sheetKpis = parsePravinPowerBankAmazonSheetKpisFromUploadNotes(notes);
  const priorFromMap = monthMap.size > 0 ? sumPriorFyMonthsInMap(monthMap, snapshotDate) : 0;

  if (
    sheetKpis &&
    priorFromMap > 50_000 &&
    (sheetKpis.prior_fy_from_month_columns ?? 0) < priorFromMap * 0.9
  ) {
    sheetKpis = null;
  }

  if (!sheetKpis && monthMap.size > 0) {
    const monthRecord: Record<string, number> = {};
    for (const [ym, units] of monthMap) monthRecord[ym] = units;
    sheetKpis = buildPravinPowerBankAmazonSheetKpisFromMonthTotals(
      monthRecord,
      snapshotDate,
      reportMtdAmazon,
      listingCount,
    );
  }

  if (!sheetKpis) return null;

  if (reportMtdAmazon > 0) {
    sheetKpis = { ...sheetKpis, may_mtd_units: reportMtdAmazon };
  }
  if (listingCount > 0) {
    sheetKpis = { ...sheetKpis, listingCount };
  }

  return sheetKpis;
}

/**
 * Apply ingest-time Amazon PowerBank month totals onto category sheet data.
 */
export function applyPravinPowerBankAmazonAuthoritativeKpis(
  sheet: CategorySheetMonthlySellout,
  sheetKpis: PravinPowerBankAmazonSheetKpis,
  monthTotals: Map<string, number>,
  reportSnapshotDate: string,
): CategorySheetMonthlySellout {
  const reportYm = reportSnapshotDate.slice(0, 7);
  const monthlyAmazon = new Map(monthTotals);

  const ongoingMonthMtd = sheet.ongoingMonthMtd
    ? {
        monthYm: reportYm,
        amazon: sheetKpis.may_mtd_units,
        flipkart: sheet.ongoingMonthMtd.flipkart,
      }
    : sheet.channelsActive.amazon
      ? { monthYm: reportYm, amazon: sheetKpis.may_mtd_units, flipkart: 0 }
      : null;

  const priorFySoUnitsAmazon = sheetKpis.prior_fy_from_month_columns;
  const currentFySoUnitsAmazon = sheetKpis.current_fy_from_month_columns;
  const priorFySoUnits =
    priorFySoUnitsAmazon + (sheet.priorFySoUnitsFlipkart ?? 0);
  const currentFySoUnits =
    currentFySoUnitsAmazon + (sheet.currentFySoUnitsFlipkart ?? 0);

  const monthlyCombined = new Map(sheet.monthlyCombined);
  for (const [ym, az] of monthlyAmazon) {
    monthlyCombined.set(ym, az + (sheet.monthlyFlipkart.get(ym) ?? 0));
  }

  const patched: CategorySheetMonthlySellout = {
    ...sheet,
    skuCountAmazon: sheetKpis.listingCount,
    skuCount: sheetKpis.listingCount + sheet.skuCountFlipkart,
    monthlyAmazon,
    monthlyCombined,
    ongoingMonthMtd,
    priorFySoUnits,
    priorFySoUnitsAmazon,
    currentFySoUnits,
    currentFySoUnitsAmazon,
    amazonFyUsesYearSoColumns: false,
    pravinPowerBankAmazonTruthKpis: true,
  };

  if (reportSnapshotDate && priorFySoUnitsAmazon > 0) {
    return applyPriorFySoToMonthlyMaps(patched, reportSnapshotDate, {
      amazon: priorFySoUnitsAmazon,
      flipkart: 0,
    });
  }

  return patched;
}
