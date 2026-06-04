/**
 * Sheet-truth category roll-ups: always start from the latest sellout upload's
 * `computed_metrics` rows, then apply category/sub filters via `product_master`.
 *
 * Every dashboard that shows category KPIs (Analysis, GMS, Admin global) must use
 * these helpers — never build SKU lists from product_master alone.
 */
import { supabase } from "./supabase";
import type { Marketplace, ProductMaster } from "./types";
import { normalizeMarketplaceProductCode } from "./utils";

export type CategoryUploadMetricField =
  | "prior_fy_so_units"
  | "current_fy_so_units"
  | "may_mtd_units"
  | "apr_so_units"
  | "prior_year_mtd_units";

export type CategoryUploadProductRow = Pick<
  ProductMaster,
  "product_code" | "sub_category" | "category" | "product_name" | "catalog_workspace"
>;

export type CategoryUploadRollupOpts = {
  /** When set, only these listing codes (deduped) are included — used for Admin global per-workspace buckets. */
  allowedCodes?: Set<string> | null;
  matchesRow: (row: CategoryUploadProductRow) => boolean;
  /** Cocoblu seller tab ASINs — always in PowerBank Amazon roll-up even if sheet Category = ROMA. */
  pravinAmazonCocobluProductCodes?: Set<string> | null;
};

export type CategoryRollupCodesOverride = { amazon: string[]; flipkart: string[] };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    out.push(items.slice(i, i + chunkSize));
  }
  return out;
}

export function allowedCodesForMarketplaceOverride(
  marketplace: Marketplace,
  codesOverride: CategoryRollupCodesOverride | undefined,
  side: "amazon" | "flipkart",
): Set<string> | null {
  if (!codesOverride) return null;
  const raw = side === "amazon" ? codesOverride.amazon : codesOverride.flipkart;
  const set = new Set<string>();
  for (const code of raw) {
    const normalized = normalizeMarketplaceProductCode(marketplace, code);
    if (normalized) set.add(normalized);
    const upper = code.trim().toUpperCase();
    if (upper) set.add(upper);
  }
  return set;
}

export async function fetchProductMasterRowsByCodes(
  marketplace: Marketplace,
  codes: string[],
): Promise<Map<string, CategoryUploadProductRow>> {
  const out = new Map<string, CategoryUploadProductRow>();
  for (const chunk of chunkArray(codes, 150)) {
    const { data, error } = await supabase
      .from("product_master")
      .select("product_code, sub_category, category, product_name, catalog_workspace")
      .eq("marketplace", marketplace)
      .in("product_code", chunk);
    if (error) throw new Error(errorMessage(error));
    for (const row of (data ?? []) as CategoryUploadProductRow[]) {
      const code = String(row.product_code ?? "").trim();
      if (!code) continue;
      out.set(code.toUpperCase(), row);
      out.set(code, row);
    }
  }
  return out;
}

export async function forEachLatestUploadMetricBatch(
  marketplace: Marketplace,
  uploadId: string,
  snapshotDate: string,
  selectFields: string,
  onBatch: (rows: Record<string, unknown>[]) => Promise<void>,
): Promise<void> {
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("computed_metrics")
      .select(selectFields)
      .eq("marketplace", marketplace)
      .eq("as_of_date", snapshotDate)
      .eq("upload_id", uploadId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(errorMessage(error));
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    if (batch.length === 0) break;
    await onBatch(batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
}

function lookupProductMasterRow(
  pmByCode: Map<string, CategoryUploadProductRow>,
  rawCode: string,
  codeKey: string,
): CategoryUploadProductRow | undefined {
  return (
    pmByCode.get(rawCode.toUpperCase()) ??
    pmByCode.get(rawCode) ??
    pmByCode.get(codeKey)
  );
}

function codeAllowed(
  opts: CategoryUploadRollupOpts,
  codeKey: string,
  rawCode: string,
): boolean {
  if (!opts.allowedCodes) return true;
  return (
    opts.allowedCodes.has(codeKey) || opts.allowedCodes.has(rawCode.toUpperCase())
  );
}

function rowIncludedInUploadRollup(
  opts: CategoryUploadRollupOpts,
  pm: CategoryUploadProductRow | undefined,
  rawCode: string,
  codeKey: string,
): boolean {
  if (!codeAllowed(opts, codeKey, rawCode)) return false;
  if (!pm) return false;
  return opts.matchesRow(pm);
}

const KPI_METRIC_MAX_PER_SKU = new Set<CategoryUploadMetricField>([
  "prior_fy_so_units",
  "current_fy_so_units",
  "may_mtd_units",
  "apr_so_units",
  "prior_year_mtd_units",
]);

/**
 * Sum Event SO month columns from `daily_sales` on one upload, including every SKU that
 * passes `matchesRow` (ignores a pre-built code list — fixes Cocoblu ASINs missed by PM tags).
 */
export async function sumMonthColumnsFromUploadDailySales(
  marketplace: Marketplace,
  uploadId: string,
  opts: CategoryUploadRollupOpts,
): Promise<Map<string, number>> {
  const target = new Map<string, number>();
  const pageSize = 2000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("daily_sales")
      .select("product_code, sale_date, units_sold")
      .eq("marketplace", marketplace)
      .eq("upload_id", uploadId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(errorMessage(error));
    const batch = (data ?? []) as Array<{
      product_code: string;
      sale_date: string;
      units_sold: unknown;
    }>;
    if (batch.length === 0) break;

    const codes = [
      ...new Set(
        batch.map((row) => String(row.product_code ?? "").trim()).filter(Boolean),
      ),
    ];
    const pmByCode = await fetchProductMasterRowsByCodes(marketplace, codes);
    for (const row of batch) {
      const rawCode = String(row.product_code ?? "").trim();
      if (!rawCode) continue;
      const codeKey = normalizeMarketplaceProductCode(marketplace, rawCode);
        if (!codeAllowed(opts, codeKey, rawCode)) continue;
        const pm = lookupProductMasterRow(pmByCode, rawCode, codeKey);
        if (!rowIncludedInUploadRollup(opts, pm, rawCode, codeKey)) continue;
        const ym = String(row.sale_date).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      const units = Number(row.units_sold ?? 0);
      if (!Number.isFinite(units) || units <= 0) continue;
      target.set(ym, (target.get(ym) ?? 0) + units);
    }

    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return target;
}

/** Sum one sheet KPI column for every matching SKU on the latest upload. */
export async function sumLatestUploadMetricsForCategoryRollup(
  marketplace: Marketplace,
  uploadId: string,
  snapshotDate: string,
  metricField: CategoryUploadMetricField,
  opts: CategoryUploadRollupOpts,
): Promise<number> {
  const useMaxPerSku = KPI_METRIC_MAX_PER_SKU.has(metricField);
  const byCode = new Map<string, number>();

  await forEachLatestUploadMetricBatch(
    marketplace,
    uploadId,
    snapshotDate,
    `product_code, ${metricField}`,
    async (batch) => {
      const codes = [
        ...new Set(
          batch
            .map((row) => String(row.product_code ?? "").trim())
            .filter(Boolean),
        ),
      ];
      if (codes.length === 0) return;
      const pmByCode = await fetchProductMasterRowsByCodes(marketplace, codes);
      for (const row of batch) {
        const rawCode = String(row.product_code ?? "").trim();
        if (!rawCode) continue;
        const codeKey = normalizeMarketplaceProductCode(marketplace, rawCode);
        if (!codeAllowed(opts, codeKey, rawCode)) continue;
        const pm = lookupProductMasterRow(pmByCode, rawCode, codeKey);
        if (!opts.allowedCodes && !rowIncludedInUploadRollup(opts, pm, rawCode, codeKey)) continue;
        const units = Number(row[metricField] ?? 0);
        if (!Number.isFinite(units) || units <= 0) continue;
        const prev = byCode.get(codeKey) ?? 0;
        byCode.set(
          codeKey,
          useMaxPerSku ? Math.max(prev, units) : prev + units,
        );
      }
    },
  );
  let total = 0;
  for (const units of byCode.values()) {
    total += units;
  }
  return total;
}

/** Listing codes on the latest upload that pass the category/sub filter. */
export async function listLatestUploadCodesForCategoryRollup(
  marketplace: Marketplace,
  uploadId: string,
  snapshotDate: string,
  opts: CategoryUploadRollupOpts,
): Promise<string[]> {
  const seen = new Set<string>();
  const unique: string[] = [];
  await forEachLatestUploadMetricBatch(
    marketplace,
    uploadId,
    snapshotDate,
    "product_code",
    async (batch) => {
      const codes = [
        ...new Set(
          batch
            .map((row) => String(row.product_code ?? "").trim())
            .filter(Boolean),
        ),
      ];
      if (codes.length === 0) return;
      const pmByCode = await fetchProductMasterRowsByCodes(marketplace, codes);
      for (const rawCode of codes) {
        const codeKey = normalizeMarketplaceProductCode(marketplace, rawCode);
        if (!codeAllowed(opts, codeKey, rawCode)) continue;
        const pm = lookupProductMasterRow(pmByCode, rawCode, codeKey);
        if (!rowIncludedInUploadRollup(opts, pm, rawCode, codeKey)) continue;
        if (!codeKey || seen.has(codeKey)) continue;
        seen.add(codeKey);
        unique.push(codeKey);
      }
    },
  );
  return unique;
}

/** Walk upload metrics with SO units and apply a per-row reducer (e.g. GMS = BAU × SO). */
export async function reduceLatestUploadMetricsForCategoryRollup(
  marketplace: Marketplace,
  uploadId: string,
  snapshotDate: string,
  metricFields: CategoryUploadMetricField[],
  opts: CategoryUploadRollupOpts,
  reduce: (row: Record<string, unknown>, productMaster: CategoryUploadProductRow) => number,
): Promise<number> {
  let total = 0;
  const selectFields = ["product_code", ...metricFields].join(", ");
  await forEachLatestUploadMetricBatch(
    marketplace,
    uploadId,
    snapshotDate,
    selectFields,
    async (batch) => {
      const codes = [
        ...new Set(
          batch
            .map((row) => String(row.product_code ?? "").trim())
            .filter(Boolean),
        ),
      ];
      if (codes.length === 0) return;
      const pmByCode = await fetchProductMasterRowsByCodes(marketplace, codes);
      for (const row of batch) {
        const rawCode = String(row.product_code ?? "").trim();
        if (!rawCode) continue;
        const codeKey = normalizeMarketplaceProductCode(marketplace, rawCode);
        if (!codeAllowed(opts, codeKey, rawCode)) continue;
        const pm = lookupProductMasterRow(pmByCode, rawCode, codeKey);
        if (!rowIncludedInUploadRollup(opts, pm, rawCode, codeKey)) continue;
        if (!pm) continue;
        total += reduce(row, pm);
      }
    },
  );
  return total;
}
