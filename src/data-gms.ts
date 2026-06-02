import {
  applyOngoingMtdToMaps,
  applyPriorFySoToMonthlyMaps,
  mergeCategorySheetMonthlySellout,
  previousMonthYmFromSnapshot,
  priorFyMonthYms,
  type CategoryOngoingMonthMtd,
  type CategorySheetMonthlySellout,
} from "./category-sellout-insights";
import {
  effectiveBauPrice,
  gmsFromBauAndSo,
  gmsFromFlipkartDrr,
  gmsFromFlipkartSellout,
  buildGmsGapSuggestion,
} from "./gms";
import {
  RISHABH_HOME_AUDIO_SUB_CATEGORIES,
  RISHABH_IT_ACCESSORIES_SUB_CATEGORIES,
} from "./rishabh-category-scope";
import { supabase } from "./supabase";
import type {
  ComputedMetric,
  Marketplace,
  ProductMaster,
  SubCategory,
  SubCategoryFilter,
} from "./types";
import { TRACKED_SUB_CATEGORIES } from "./types";
import {
  CATALOG_WORKSPACE_MONITOR,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_HOME_AUDIO,
  CATALOG_WORKSPACE_RITHIKA,
  type CatalogWorkspace,
} from "./catalog-workspace";
import { getActiveCatalogWorkspace } from "./workspace-catalog-scope";
import {
  KARAN_TRACKED_SUB_CATEGORIES,
  type KaranSubCategoryFilter,
} from "./karan-category-scope";
import type { RithikaSubCategoryFilter } from "./rithika-category-scope";
import { ADMIN_MANAGER_WORKSPACES } from "./admin-realm";
import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  isAnalysisCategoryAll,
  isAnalysisSubCategoryAll,
} from "./analysis-category-paths";
import {
  chunkArray,
  categoryRollupProductCodes,
  getLatestUploadContextByMarketplace,
  getGmsProductCodesForCategorySelection,
  listDistinctRithikaSheetSubCategories,
  pruneOlderUploads,
  getPeersForSelloutChannel,
  resolveProductContextByErpId,
  productMatchesStrictSheetCategoryRollup,
  productMatchesSubCategoryForWorkspace,
  rowMatchesHariGmsSheetCategory,
  type WorkspaceSubCategory,
} from "./data";
import { displayModelName } from "./product-display";
import type { DataScope } from "./types";
import { getActiveDataScope } from "./workspace-data-scope";
import type {
  ParsedAmazonGmsAvsRow,
  ParsedBauPayload,
  ParsedBauRow,
  ParsedGmsPlanPayload,
  ParsedGmsPlanRow,
} from "./parsers-gms";
import { normalizeMarketplaceProductCode } from "./utils";

type ChannelSkuRef = { marketplace: Marketplace; product_code: string };
type GmsDailySnapshotRow = {
  marketplace: Marketplace;
  product_code: string;
  as_of_date: string;
  upload_id: string | null;
  so_units_mtd: number;
  bau_price_used: number;
  event_price_used?: number;
  price_source?: "bau" | "event" | "official_may_mtd" | "flipkart_weekday" | "flipkart_18_12";
  gms_inr_mtd: number;
  sheet_category?: string | null;
  sheet_sub_category?: string | null;
};

function isMissingGmsSnapshotColumnError(error: unknown, column: string): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes(column.toLowerCase()) && msg.includes("does not exist");
}

function gmsAvsRowMatchesSheetSelection(
  row: { sheet_category: string | null; sheet_sub_category: string | null },
  category: string,
  subCategory: string,
): boolean {
  const sheetCategory = String(row.sheet_category ?? "").trim();
  if (!sheetCategory) return false;
  return rowMatchesHariGmsSheetCategory(category, subCategory, {
    category: sheetCategory,
    sub_category: row.sheet_sub_category,
    product_name: null,
  });
}
type PricePair = {
  bau: number;
  event: number;
};
type GmsCategoryChannelContext = {
  marketplace: Marketplace;
  codes: string[];
  priceMap: Map<string, PricePair>;
  snapshotDate: string | null;
  uploadId: string | null;
};

function skuKey(marketplace: Marketplace, productCode: string): string {
  return `${marketplace}:${productCode}`;
}

/** One sheet row → Amazon + Flipkart SKUs when ASIN/FSN are on the row (no DB). */
function expandRowToChannelSkusSync(row: {
  product_name: string;
  asin?: string;
  fsn?: string;
}): ChannelSkuRef[] {
  const map = new Map<string, ChannelSkuRef>();

  if (row.asin) {
    const code = row.asin.trim();
    map.set(skuKey("amazon", code), { marketplace: "amazon", product_code: code });
  }
  if (row.fsn) {
    const code = row.fsn.trim().toUpperCase();
    map.set(skuKey("flipkart", code), { marketplace: "flipkart", product_code: code });
  }

  return [...map.values()];
}

async function applySharedBauByModelName(
  marketplace: Marketplace,
  codes: string[],
  map: Map<string, PricePair>,
): Promise<void> {
  const missing = codes.filter((c) => (map.get(c)?.bau ?? 0) <= 0);
  if (missing.length === 0) return;

  const { data: products, error: pErr } = await supabase
    .from("product_master")
    .select("product_code, product_name")
    .eq("marketplace", marketplace)
    .in("product_code", missing);
  if (pErr) throw new Error(getErrorMessage(pErr));

  const names = [
    ...new Set(
      ((products ?? []) as Pick<ProductMaster, "product_code" | "product_name">[])
        .map((p) => p.product_name?.trim())
        .filter(Boolean) as string[],
    ),
  ];
  if (names.length === 0) return;

  const { data: siblings, error: sErr } = await supabase
    .from("product_master")
    .select("marketplace, product_code, product_name")
    .in("product_name", names);
  if (sErr) throw new Error(getErrorMessage(sErr));

  const allCodes = ((siblings ?? []) as ChannelSkuRef[]).map((s) => s.product_code);
  if (allCodes.length === 0) return;

  const { data: bench, error: bErr } = await supabase
    .from("product_bau_benchmark")
    .select("product_code, bau_price, event_price")
    .eq("marketplace", marketplace)
    .in("product_code", allCodes);
  if (bErr && !getErrorMessage(bErr).includes("does not exist")) {
    throw new Error(getErrorMessage(bErr));
  }

  const bauByCode = new Map(
    (
      (bench ?? []) as {
        product_code: string;
        bau_price: unknown;
        event_price?: unknown;
      }[]
    ).map((r) => [
      r.product_code,
      {
        bau: Number(r.bau_price ?? 0),
        event: Number(r.event_price ?? 0),
      },
    ]),
  );

  const bauByModel = new Map<string, PricePair>();
  for (const row of (siblings ?? []) as Array<{
    product_code: string;
    product_name: string;
  }>) {
    const price = bauByCode.get(row.product_code) ?? { bau: 0, event: 0 };
    if (price.bau <= 0) continue;
    const name = row.product_name.trim();
    if (!bauByModel.has(name) || price.bau > (bauByModel.get(name)?.bau ?? 0)) {
      bauByModel.set(name, price);
    }
  }

  const nameByCode = new Map(
    ((products ?? []) as Pick<ProductMaster, "product_code" | "product_name">[]).map((p) => [
      p.product_code,
      p.product_name?.trim() ?? "",
    ]),
  );

  for (const code of missing) {
    const shared = bauByModel.get(nameByCode.get(code) ?? "");
    if (shared != null && shared.bau > 0) map.set(code, shared);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    const msg = (error as { message: string }).message;
    const hint =
      "hint" in error && typeof (error as { hint?: unknown }).hint === "string"
        ? (error as { hint: string }).hint
        : "";
    return hint ? `${msg} (${hint})` : msg;
  }
  return "Unknown error";
}

function isMissingSchemaError(error: unknown, token: string): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes(token.toLowerCase()) && msg.includes("does not exist");
}

async function insertGmsAuxUploadRow(row: Record<string, unknown>): Promise<string> {
  const withKind = { ...row, upload_kind: row.upload_kind ?? "bau" };
  let { data, error } = await supabase.from("uploads").insert(withKind).select("id").single();

  if (error && isMissingSchemaError(error, "upload_kind")) {
    const { upload_kind: _removed, ...withoutKind } = withKind;
    void _removed;
    const retry = await supabase.from("uploads").insert(withoutKind).select("id").single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    if (isMissingSchemaError(error, "product_bau_benchmark")) {
      throw new Error(
        "Database missing GMS tables. Run supabase/run-gms-tracker.sql in Supabase SQL Editor, then retry.",
      );
    }
    throw new Error(getErrorMessage(error));
  }

  return String(data!.id);
}

async function upsertInBatches(table: string, rows: unknown[], onConflict: string) {
  const { upsertSupabaseParallel } = await import("./xlsx-fast");
  await upsertSupabaseParallel(table, rows, onConflict, { batchSize: 700, concurrency: 4 });
}

function isMissingGmsDailySnapshotSchemaError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes("gms_daily_snapshot") && msg.includes("does not exist");
}

function isMissingGmsOfficialMonthlySchemaError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes("gms_official_monthly") && msg.includes("does not exist");
}

const AMAZON_BAU_MTD_TOLERANCE_INR = 1;

/** True when GMS equals BAU × May SO ÷ 1.18 (legacy snapshot rows — not GMS_AVS). */
function isStaleAmazonBauMtd(gms: number, bau: number, maySoUnits: number): boolean {
  if (gms <= 0 || bau <= 0 || maySoUnits <= 0) return false;
  return Math.abs(gms - gmsFromBauAndSo(bau, maySoUnits)) < AMAZON_BAU_MTD_TOLERANCE_INR;
}

/** GMS_AVS ingest only — reject legacy BAU×SO posing as official GMS. */
function amazonGmsAvsMtdInr(gmsInr: number, bau: number, maySoUnits: number): number {
  if (!Number.isFinite(gmsInr) || gmsInr <= 0) return 0;
  if (isStaleAmazonBauMtd(gmsInr, bau, maySoUnits)) return 0;
  return gmsInr;
}

/**
 * Amazon GMS Tracker MTD (GMS_AVS only): `official_may_mtd` May MTD column on the sellout as-on date.
 * No gms_official_monthly fallback. Missing / stale BAU×SO → 0.
 */
function resolveAmazonProductMtdGms(
  mayMtdFromGmsAvs: number,
  bau: number,
  maySoUnits: number,
): number {
  return amazonGmsAvsMtdInr(mayMtdFromGmsAvs, bau, maySoUnits);
}

async function loadAmazonMayMtdUnitsByCodes(
  codes: string[],
  asOfDate: string,
  uploadId: string | null,
): Promise<Map<string, number>> {
  const byCode = new Map<string, number>();
  if (!asOfDate || !uploadId || codes.length === 0) return byCode;
  for (const chunk of chunkArray(codes, 150)) {
    const { data, error } = await supabase
      .from("computed_metrics")
      .select("product_code, may_mtd_units")
      .eq("marketplace", "amazon")
      .eq("as_of_date", asOfDate)
      .eq("upload_id", uploadId)
      .in("product_code", chunk);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of (data ?? []) as Pick<ComputedMetric, "product_code" | "may_mtd_units">[]) {
      byCode.set(String(row.product_code), Number(row.may_mtd_units ?? 0));
    }
  }
  return byCode;
}

/** Per-SKU Amazon MTD for GMS Tracker product list / channel totals (GMS_AVS only). */
async function loadAmazonGmsTrackerMtdByCodes(
  asOfDate: string,
  uploadId: string | null,
  codes: string[],
  bauMap: Map<string, PricePair>,
): Promise<Map<string, number>> {
  const rawByCode = await loadAmazonOfficialMayMtdByCodes(asOfDate, codes, uploadId);
  const maySoByCode = await loadAmazonMayMtdUnitsByCodes(codes, asOfDate, uploadId);
  const out = new Map<string, number>();
  for (const code of codes) {
    const bau = bauMap.get(code)?.bau ?? 0;
    const maySo = maySoByCode.get(code) ?? 0;
    const raw = lookupMtdFromMap("amazon", rawByCode, code);
    const mtd = amazonGmsAvsMtdInr(raw, bau, maySo);
    out.set(code, mtd);
    const key = normalizeMarketplaceProductCode("amazon", code);
    if (key) out.set(key, mtd);
  }
  return out;
}

/** GMS_AVS May MTD is tied to the sellout as-on date only — never an earlier snapshot in the month. */
function resolveOfficialAmazonGmsAsOfDate(asOfDate: string): string {
  return asOfDate;
}

/**
 * Amazon May MTD GMS: read-only sum of GMS_AVS "May MTD" ingested as official_may_mtd.
 * Missing / blank ASIN → 0. No BAU×DRR fallback and no DB writes on read.
 */
async function loadAmazonOfficialMayMtdByCodes(
  asOfDate: string,
  codes: string[],
  uploadId: string | null = null,
): Promise<Map<string, number>> {
  const gmsByCode = new Map<string, number>();
  const scopeKeys = new Set<string>();
  for (const raw of codes) {
    const key = normalizeMarketplaceProductCode("amazon", raw);
    if (!key) continue;
    scopeKeys.add(key);
    gmsByCode.set(key, 0);
  }
  if (!asOfDate || scopeKeys.size === 0) return gmsByCode;

  const snapshotDate = resolveOfficialAmazonGmsAsOfDate(asOfDate);

  for (const chunk of chunkArray(codes, 150)) {
    let query = supabase
      .from("gms_daily_snapshot")
      .select("product_code, gms_inr_mtd")
      .eq("marketplace", "amazon")
      .eq("as_of_date", snapshotDate)
      .eq("price_source", "official_may_mtd")
      .in("product_code", chunk);
    if (uploadId) {
      query = query.eq("upload_id", uploadId);
    }
    const { data, error } = await query;
    if (error) {
      if (isMissingGmsDailySnapshotSchemaError(error)) return gmsByCode;
      throw new Error(getErrorMessage(error));
    }
    for (const row of (data ?? []) as Array<{ product_code: string; gms_inr_mtd: unknown }>) {
      const key = normalizeMarketplaceProductCode("amazon", String(row.product_code ?? ""));
      if (!key || !scopeKeys.has(key)) continue;
      const gms = Number(row.gms_inr_mtd ?? 0);
      gmsByCode.set(key, Number.isFinite(gms) ? Math.max(0, gms) : 0);
    }
  }

  return gmsByCode;
}

type OfficialGmsMonthlyRow = {
  product_code: string;
  month_ym: string;
  gms_inr: unknown;
  sheet_category?: string | null;
  sheet_sub_category?: string | null;
};

/** All Amazon GMS months from ingested GMS_AVS (never BAU×SO). */
async function loadAmazonOfficialGmsMonthlyRollup(
  asOfDate: string,
  fallbackCodes: string[],
  sheetSelection?: { category: string; subCategory: string },
  uploadId: string | null = null,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
): Promise<{ monthlyTotals: Map<string, number>; codes: string[] }> {
  const monthlyTotals = new Map<string, number>();
  const codes = new Set<string>();
  if (!asOfDate) return { monthlyTotals, codes: [] };

  const snapshotDate = resolveOfficialAmazonGmsAsOfDate(asOfDate);
  const reportYm = asOfDate.slice(0, 7);
  const scopeKeys = new Set(
    fallbackCodes
      .map((c) => normalizeMarketplaceProductCode("amazon", c))
      .filter(Boolean) as string[],
  );
  const filterBySheet =
    catalogWorkspace === CATALOG_WORKSPACE_MONITOR && Boolean(sheetSelection);
  const cat = sheetSelection?.category.trim() || ANALYSIS_CATEGORY_ALL;
  const sub = sheetSelection?.subCategory.trim() || ANALYSIS_SUB_CATEGORY_ALL;

  let offset = 0;
  const pageSize = 1000;
  let tableAvailable = true;
  const bauMap = await getBauMapsForCodes("amazon", fallbackCodes, snapshotDate);
  const maySoByCode = uploadId
    ? await loadAmazonMayMtdUnitsByCodes(fallbackCodes, snapshotDate, uploadId)
    : new Map<string, number>();

  while (tableAvailable) {
    let monthlyQuery = supabase
      .from("gms_official_monthly")
      .select("product_code, month_ym, gms_inr, sheet_category, sheet_sub_category")
      .eq("marketplace", "amazon")
      .eq("as_of_date", snapshotDate)
      .range(offset, offset + pageSize - 1);
    if (uploadId) {
      monthlyQuery = monthlyQuery.eq("upload_id", uploadId);
    }
    const { data, error } = await monthlyQuery;

    if (error) {
      if (isMissingGmsOfficialMonthlySchemaError(error)) {
        tableAvailable = false;
        break;
      }
      throw new Error(getErrorMessage(error));
    }

    const rows = (data ?? []) as OfficialGmsMonthlyRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const key = normalizeMarketplaceProductCode("amazon", String(row.product_code ?? ""));
      if (!key) continue;
      if (filterBySheet) {
        if (
          !gmsAvsRowMatchesSheetSelection(
            {
              sheet_category: row.sheet_category ?? null,
              sheet_sub_category: row.sheet_sub_category ?? null,
            },
            cat,
            sub,
          )
        ) {
          continue;
        }
      } else if (scopeKeys.size > 0 && !scopeKeys.has(key)) {
        continue;
      }
      const ym = String(row.month_ym ?? "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      /** Current month MTD comes only from GMS_AVS "May MTD" snapshot rows — not monthly columns. */
      if (ym === reportYm) continue;
      const productCode = String(row.product_code ?? "");
      const bau = bauMap.get(productCode)?.bau ?? bauMap.get(key)?.bau ?? 0;
      const maySo = maySoByCode.get(productCode) ?? maySoByCode.get(key) ?? 0;
      const raw = Number(row.gms_inr ?? 0);
      const add = Number.isFinite(raw) ? amazonGmsAvsMtdInr(raw, bau, maySo) : 0;
      monthlyTotals.set(ym, (monthlyTotals.get(ym) ?? 0) + add);
      codes.add(key);
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  /** Report month MTD must match GMS_AVS "May MTD" snapshot, not a different monthly column. */
  if (fallbackCodes.length > 0 && asOfDate) {
    const bauMap = await getBauMapsForCodes("amazon", fallbackCodes, asOfDate);
    const mtdByCode = await loadAmazonGmsTrackerMtdByCodes(
      asOfDate,
      uploadId,
      fallbackCodes,
      bauMap,
    );
    let mtdSum = 0;
    for (const code of fallbackCodes) {
      mtdSum += lookupMtdFromMap("amazon", mtdByCode, code);
    }
    if (mtdSum > 0) monthlyTotals.set(reportYm, mtdSum);
  }

  return { monthlyTotals, codes: [...codes] };
}

/**
 * Amazon May MTD = sum of GMS_AVS "May MTD" for Hari sheet categories (Monitor & Acc., etc.).
 * Uses ingested sheet_category when available; falls back to product_master scope codes.
 */
async function sumAmazonOfficialMayMtdForSheetSelection(
  asOfDate: string,
  category: string,
  subCategory: string,
  fallbackCodes: string[],
  uploadId: string | null = null,
  useSheetCategoryFilter = true,
): Promise<{ total: number; codes: string[] }> {
  if (!asOfDate) return { total: 0, codes: [] };

  if (!useSheetCategoryFilter) {
    const bauMap = await getBauMapsForCodes("amazon", fallbackCodes, asOfDate);
    const mtdByCode = await loadAmazonGmsTrackerMtdByCodes(
      asOfDate,
      uploadId,
      fallbackCodes,
      bauMap,
    );
    let total = 0;
    const codes: string[] = [];
    for (const code of fallbackCodes) {
      const key = normalizeMarketplaceProductCode("amazon", code);
      const gms = key ? (mtdByCode.get(key) ?? mtdByCode.get(code) ?? 0) : 0;
      total += gms;
      if (key && gms > 0) codes.push(key);
    }
    return { total, codes };
  }

  const snapshotDate = resolveOfficialAmazonGmsAsOfDate(asOfDate);
  const cat = category.trim() || ANALYSIS_CATEGORY_ALL;
  const sub = subCategory.trim() || ANALYSIS_SUB_CATEGORY_ALL;
  const bauMap = await getBauMapsForCodes("amazon", fallbackCodes, snapshotDate);
  const maySoByCode = await loadAmazonMayMtdUnitsByCodes(fallbackCodes, snapshotDate, uploadId);

  let offset = 0;
  const pageSize = 1000;
  let total = 0;
  const codes = new Set<string>();
  let sheetCategoryAvailable = true;

  while (true) {
    let query = supabase
      .from("gms_daily_snapshot")
      .select("product_code, gms_inr_mtd, sheet_category, sheet_sub_category")
      .eq("marketplace", "amazon")
      .eq("as_of_date", snapshotDate)
      .eq("price_source", "official_may_mtd")
      .range(offset, offset + pageSize - 1);
    if (uploadId) {
      query = query.eq("upload_id", uploadId);
    }

    const { data, error } = await query;
    if (error) {
      if (
        sheetCategoryAvailable &&
        (isMissingGmsSnapshotColumnError(error, "sheet_category") ||
          isMissingGmsSnapshotColumnError(error, "sheet_sub_category"))
      ) {
        sheetCategoryAvailable = false;
        break;
      }
      if (isMissingGmsDailySnapshotSchemaError(error)) {
        return { total: 0, codes: [] };
      }
      throw new Error(getErrorMessage(error));
    }

    const rows = (data ?? []) as Array<{
      product_code: string;
      gms_inr_mtd: unknown;
      sheet_category?: string | null;
      sheet_sub_category?: string | null;
    }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      if (
        !gmsAvsRowMatchesSheetSelection(
          {
            sheet_category: row.sheet_category ?? null,
            sheet_sub_category: row.sheet_sub_category ?? null,
          },
          cat,
          sub,
        )
      ) {
        continue;
      }
      const key = normalizeMarketplaceProductCode("amazon", String(row.product_code ?? ""));
      if (!key) continue;
      const raw = Number(row.gms_inr_mtd ?? 0);
      const productCode = String(row.product_code ?? "");
      const bau = bauMap.get(productCode)?.bau ?? bauMap.get(key)?.bau ?? 0;
      const maySo = maySoByCode.get(productCode) ?? maySoByCode.get(key) ?? 0;
      const gms = amazonGmsAvsMtdInr(Number.isFinite(raw) ? raw : 0, bau, maySo);
      total += gms;
      codes.add(key);
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  if (sheetCategoryAvailable && codes.size > 0) {
    return { total, codes: [...codes] };
  }

  const gmsByCode = await loadAmazonGmsTrackerMtdByCodes(
    snapshotDate,
    uploadId,
    fallbackCodes,
    bauMap,
  );
  let fallbackTotal = 0;
  const fallbackCodesOut: string[] = [];
  for (const code of fallbackCodes) {
    const key = normalizeMarketplaceProductCode("amazon", code);
    const gms = key ? (gmsByCode.get(key) ?? gmsByCode.get(code) ?? 0) : 0;
    fallbackTotal += gms;
    if (key) fallbackCodesOut.push(key);
  }
  return { total: fallbackTotal, codes: fallbackCodesOut };
}

async function loadFrozenMtdGmsByCodes(
  marketplace: Marketplace,
  asOfDate: string,
  uploadId: string | null,
  codes: string[],
  priceMap: Map<string, PricePair>,
): Promise<Map<string, number>> {
  if (marketplace === "amazon") {
    if (priceMap.size > 0) {
      return loadAmazonGmsTrackerMtdByCodes(asOfDate, uploadId, codes, priceMap);
    }
    return loadAmazonOfficialMayMtdByCodes(asOfDate, codes, uploadId);
  }

  const gmsByCode = new Map<string, number>();
  if (codes.length === 0) return gmsByCode;

  const missing = new Set(codes);
  let snapshotTableAvailable = true;

  for (const chunk of chunkArray(codes, 150)) {
    const { data, error } = await supabase
      .from("gms_daily_snapshot")
      .select("product_code, gms_inr_mtd, price_source")
      .eq("marketplace", marketplace)
      .eq("as_of_date", asOfDate)
      .in("product_code", chunk);
    if (error) {
      if (isMissingGmsDailySnapshotSchemaError(error)) {
        snapshotTableAvailable = false;
        break;
      }
      throw new Error(getErrorMessage(error));
    }
    for (const row of (data ?? []) as Array<{
      product_code: string;
      gms_inr_mtd: unknown;
      price_source?: string | null;
    }>) {
      const code = String(row.product_code);
      if (row.price_source === "official_may_mtd") continue;
      if (row.price_source !== "flipkart_weekday") continue;
      const gms = Number(row.gms_inr_mtd ?? 0);
      gmsByCode.set(code, gms);
      missing.delete(code);
    }
  }

  if (missing.size === 0) return gmsByCode;

  const missingCodes = [...missing];
  const rowsToInsert: GmsDailySnapshotRow[] = [];

  for (const chunk of chunkArray(missingCodes, 150)) {
    const { data, error } = await supabase
      .from("computed_metrics")
      .select("product_code, may_mtd_units, drr_units")
      .eq("marketplace", marketplace)
      .eq("as_of_date", asOfDate)
      .eq("upload_id", uploadId)
      .in("product_code", chunk);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of (data ?? []) as Pick<ComputedMetric, "product_code" | "may_mtd_units" | "drr_units">[]) {
      const code = String(row.product_code);
      const units = Number(row.may_mtd_units ?? 0);
      const drr = Number(row.drr_units ?? 0);
      const price = priceMap.get(code) ?? { bau: 0, event: 0 };
      const gms =
        units > 0
          ? gmsFromFlipkartSellout(price.bau, price.event, units, asOfDate)
          : gmsFromFlipkartDrr(price.bau, price.event, drr, asOfDate);
      gmsByCode.set(code, gms);
      rowsToInsert.push({
        marketplace,
        product_code: code,
        as_of_date: asOfDate,
        upload_id: uploadId,
        so_units_mtd: units,
        bau_price_used: price.bau,
        event_price_used: price.event,
        price_source: "flipkart_weekday",
        gms_inr_mtd: gms,
      });
    }
  }

  if (snapshotTableAvailable && rowsToInsert.length > 0) {
    const { error: writeErr } = await supabase
      .from("gms_daily_snapshot")
      .upsert(rowsToInsert, {
        onConflict: "marketplace,product_code,as_of_date",
      });
    if (writeErr && !isMissingGmsDailySnapshotSchemaError(writeErr)) {
      console.warn("gms_daily_snapshot upsert failed:", getErrorMessage(writeErr));
    }
  }

  return gmsByCode;
}

export async function getBauMapsForCodes(
  marketplace: Marketplace,
  codes: string[],
  asOfDate?: string | null,
): Promise<Map<string, PricePair>> {
  const map = new Map<string, PricePair>();
  if (codes.length === 0) return map;

  const { data: products, error: pErr } = await supabase
    .from("product_master")
    .select("product_code, bau_price")
    .eq("marketplace", marketplace)
    .in("product_code", codes);
  if (pErr) throw new Error(getErrorMessage(pErr));

  const { data: bench, error: bErr } = await supabase
    .from("product_bau_price_history")
    .select("product_code, bau_price, event_price, effective_from")
    .eq("marketplace", marketplace)
    .in("product_code", codes)
    .lte("effective_from", asOfDate ?? "9999-12-31")
    .order("effective_from", { ascending: false });
  if (bErr && !getErrorMessage(bErr).includes("does not exist")) {
    throw new Error(getErrorMessage(bErr));
  }

  const { data: benchCurrent, error: bcErr } = await supabase
    .from("product_bau_benchmark")
    .select("product_code, bau_price, event_price")
    .eq("marketplace", marketplace)
    .in("product_code", codes);
  if (bcErr && !getErrorMessage(bcErr).includes("does not exist")) {
    throw new Error(getErrorMessage(bcErr));
  }

  const benchMap = new Map<string, PricePair>();
  for (const row of (bench ?? []) as Array<{
    product_code: string;
    bau_price: unknown;
    event_price?: unknown;
  }>) {
    if (!benchMap.has(row.product_code)) {
      benchMap.set(row.product_code, {
        bau: Number(row.bau_price ?? 0),
        event: Number(row.event_price ?? 0),
      });
    }
  }
  for (const row of (benchCurrent ?? []) as Array<{
    product_code: string;
    bau_price: unknown;
    event_price?: unknown;
  }>) {
    if (!benchMap.has(row.product_code)) {
      benchMap.set(row.product_code, {
        bau: Number(row.bau_price ?? 0),
        event: Number(row.event_price ?? 0),
      });
    }
  }

  for (const row of (products ?? []) as Pick<ProductMaster, "product_code" | "bau_price">[]) {
    const code = row.product_code;
    map.set(
      code,
      {
        bau: effectiveBauPrice(row.bau_price as number | null, benchMap.get(code)?.bau),
        event: benchMap.get(code)?.event ?? 0,
      },
    );
  }
  for (const code of codes) {
    if (!map.has(code)) map.set(code, benchMap.get(code) ?? { bau: 0, event: 0 });
  }

  await applySharedBauByModelName(marketplace, codes, map);
  return map;
}

/** BAU + event SP from the latest BAU sheet (`product_bau_benchmark`), with model-level fallback. */
export async function getSheetBauPricesForCodes(
  marketplace: Marketplace,
  codes: string[],
): Promise<Map<string, PricePair>> {
  const map = new Map<string, PricePair>();
  if (codes.length === 0) return map;

  for (const chunk of chunkArray(codes, 150)) {
    const { data, error } = await supabase
      .from("product_bau_benchmark")
      .select("product_code, bau_price, event_price")
      .eq("marketplace", marketplace)
      .in("product_code", chunk);
    if (error) {
      if (getErrorMessage(error).includes("does not exist")) return map;
      throw new Error(getErrorMessage(error));
    }
    for (const row of data ?? []) {
      const r = row as {
        product_code: string;
        bau_price: unknown;
        event_price?: unknown;
      };
      map.set(r.product_code, {
        bau: Math.max(0, Number(r.bau_price ?? 0)),
        event: Math.max(0, Number(r.event_price ?? 0)),
      });
    }
  }

  await applySharedBauByModelName(marketplace, codes, map);
  for (const code of codes) {
    if (!map.has(code)) map.set(code, { bau: 0, event: 0 });
  }
  return map;
}

/** Per-SKU monthly SO units from latest sellout upload (YYYY-MM-01 rows only). */
async function loadSkuMonthlySo(
  marketplace: Marketplace,
  codes: string[],
  uploadId: string | null,
): Promise<Map<string, Map<string, number>>> {
  const byCode = new Map<string, Map<string, number>>();
  if (!uploadId || codes.length === 0) return byCode;

  for (const chunk of chunkArray(codes, 150)) {
    const { data, error } = await supabase
      .from("daily_sales")
      .select("product_code, sale_date, units_sold")
      .eq("marketplace", marketplace)
      .eq("upload_id", uploadId)
      .in("product_code", chunk);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of data ?? []) {
      const r = row as { product_code: string; sale_date: string; units_sold: unknown };
      const saleDate = String(r.sale_date);
      if (!/^\d{4}-\d{2}-01$/.test(saleDate)) continue;
      const ym = saleDate.slice(0, 7);
      const code = String(r.product_code);
      if (!byCode.has(code)) byCode.set(code, new Map());
      const m = byCode.get(code)!;
      m.set(ym, (m.get(ym) ?? 0) + Number(r.units_sold ?? 0));
    }
  }
  return byCode;
}

function rollupGmsFromSkuSo(
  skuSo: Map<string, Map<string, number>>,
  priceMap: Map<string, PricePair>,
  marketplace: Marketplace,
): Map<string, number> {
  const monthly = new Map<string, number>();
  for (const [code, months] of skuSo) {
    const price = priceMap.get(code) ?? { bau: 0, event: 0 };
    for (const [ym, units] of months) {
      const gms =
        marketplace === "amazon"
          ? 0
          : marketplace === "flipkart"
            ? gmsFromFlipkartSellout(price.bau, price.event, units, ym)
            : gmsFromBauAndSo(price.bau, units);
      monthly.set(ym, (monthly.get(ym) ?? 0) + gms);
    }
  }
  return monthly;
}

function lookupMtdFromMap(
  marketplace: Marketplace,
  gmsByCode: Map<string, number>,
  productCode: string,
): number {
  if (marketplace === "amazon") {
    const key = normalizeMarketplaceProductCode("amazon", productCode);
    return key ? (gmsByCode.get(key) ?? 0) : 0;
  }
  return gmsByCode.get(productCode) ?? 0;
}

async function loadGmsMtdForChannel(
  channel: GmsCategoryChannelContext,
  sheetSelection?: { category: string; subCategory: string },
  amazonMtdUseSheetCategory = false,
): Promise<number> {
  const { marketplace, codes, snapshotDate, uploadId, priceMap } = channel;
  if (!snapshotDate) return 0;
  if (marketplace === "amazon") {
    if (sheetSelection) {
      const { total } = await sumAmazonOfficialMayMtdForSheetSelection(
        snapshotDate,
        sheetSelection.category,
        sheetSelection.subCategory,
        codes,
        uploadId,
        amazonMtdUseSheetCategory,
      );
      return total;
    }
    const bauMap =
      priceMap.size > 0 ? priceMap : await getBauMapsForCodes("amazon", codes, snapshotDate);
    const gmsByCode = await loadAmazonGmsTrackerMtdByCodes(
      snapshotDate,
      uploadId,
      codes,
      bauMap,
    );
    let total = 0;
    for (const code of codes) total += lookupMtdFromMap("amazon", gmsByCode, code);
    return total;
  }
  if (!uploadId) return 0;
  const gmsByCode = await loadFrozenMtdGmsByCodes(
    marketplace,
    snapshotDate,
    uploadId,
    codes,
    priceMap,
  );
  let total = 0;
  for (const code of codes) total += gmsByCode.get(code) ?? 0;
  return total;
}

/** Prior completed FY GMS from **FY 2025-26 SO** (etc.) when month columns are missing in daily_sales. */
async function loadPriorFySoGmsForChannel(
  channel: GmsCategoryChannelContext,
): Promise<number> {
  const { marketplace, codes, snapshotDate, uploadId, priceMap } = channel;
  if (marketplace === "amazon") return 0;
  if (!snapshotDate || !uploadId) return 0;
  let total = 0;
  for (const chunk of chunkArray(codes, 150)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from("computed_metrics")
      .select("product_code, prior_fy_so_units")
      .eq("marketplace", marketplace)
      .eq("as_of_date", snapshotDate)
      .eq("upload_id", uploadId)
      .in("product_code", chunk);
    if (error) {
      const msg = getErrorMessage(error).toLowerCase();
      if (msg.includes("prior_fy_so_units")) {
        return loadPriorFySoGmsFromDailySales(
          marketplace,
          codes,
          priceMap,
          uploadId,
          snapshotDate,
        );
      }
      throw new Error(getErrorMessage(error));
    }
    for (const row of (data ?? []) as Pick<ComputedMetric, "product_code" | "prior_fy_so_units">[]) {
      const price = priceMap.get(row.product_code) ?? { bau: 0, event: 0 };
      const units = Number(row.prior_fy_so_units ?? 0);
      total += gmsFromFlipkartSellout(price.bau, price.event, units, snapshotDate.slice(0, 7));
    }
  }
  if (total <= 0) {
    total = await loadPriorFySoGmsFromDailySales(
      marketplace,
      codes,
      priceMap,
      uploadId,
      snapshotDate,
    );
  }
  return total;
}

/** Sum BAU×SO from prior-FY monthly rows when FY SO column was not stored on metrics. */
async function loadPriorFySoGmsFromDailySales(
  marketplace: Marketplace,
  codes: string[],
  priceMap: Map<string, PricePair>,
  uploadId: string | null,
  snapshotDate: string,
): Promise<number> {
  if (marketplace === "amazon") return 0;
  if (!uploadId || codes.length === 0) return 0;
  const skuSo = await loadSkuMonthlySo(marketplace, codes, uploadId);
  const monthly = rollupGmsFromSkuSo(skuSo, priceMap, marketplace);
  const fyMonths = priorFyMonthYms(snapshotDate);
  return fyMonths.reduce((sum, ym) => sum + (monthly.get(ym) ?? 0), 0);
}

/** Flipkart **Apr** column → GMS when Event SO month rows were not ingested into daily_sales. */
async function loadPreviousMonthGmsForChannel(
  channel: GmsCategoryChannelContext,
): Promise<number> {
  const { marketplace, codes, snapshotDate, uploadId, priceMap } = channel;
  if (marketplace === "amazon") return 0;
  if (!snapshotDate || !uploadId) return 0;
  const prevYm = previousMonthYmFromSnapshot(snapshotDate);
  let total = 0;
  for (const chunk of chunkArray(codes, 150)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from("computed_metrics")
      .select("product_code, apr_so_units")
      .eq("marketplace", marketplace)
      .eq("as_of_date", snapshotDate)
      .eq("upload_id", uploadId)
      .in("product_code", chunk);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of (data ?? []) as Pick<ComputedMetric, "product_code" | "apr_so_units">[]) {
      const price = priceMap.get(row.product_code) ?? { bau: 0, event: 0 };
      const units = Number(row.apr_so_units ?? 0);
      total += gmsFromFlipkartSellout(price.bau, price.event, units, prevYm);
    }
  }
  return total;
}

function applyPreviousMonthGmsWhenMissing(
  monthlyAmazon: Map<string, number>,
  monthlyFlipkart: Map<string, number>,
  monthlyCombined: Map<string, number>,
  channelsActive: { amazon: boolean; flipkart: boolean },
  monthYm: string,
  amazonGms: number,
  flipkartGms: number,
): void {
  if (channelsActive.amazon && amazonGms > 0 && (monthlyAmazon.get(monthYm) ?? 0) === 0) {
    monthlyAmazon.set(monthYm, amazonGms);
    monthlyCombined.set(monthYm, (monthlyCombined.get(monthYm) ?? 0) + amazonGms);
  }
  if (channelsActive.flipkart && flipkartGms > 0 && (monthlyFlipkart.get(monthYm) ?? 0) === 0) {
    monthlyFlipkart.set(monthYm, flipkartGms);
    monthlyCombined.set(monthYm, (monthlyCombined.get(monthYm) ?? 0) + flipkartGms);
  }
}

export async function loadCategoryGmsMonthlySellout(
  subCategory: SubCategoryFilter | KaranSubCategoryFilter | RithikaSubCategoryFilter,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
): Promise<CategorySheetMonthlySellout> {
  if (subCategory === "all" && catalogWorkspace === CATALOG_WORKSPACE_MONITOR) {
    return loadCategoryGmsMonthlySelloutBySheetSelection(
      ANALYSIS_CATEGORY_ALL,
      ANALYSIS_SUB_CATEGORY_ALL,
      catalogWorkspace,
      getActiveDataScope(),
    );
  }
  if (subCategory === "all") {
    const tracked =
      catalogWorkspace === CATALOG_WORKSPACE_RITHIKA
        ? await listDistinctRithikaSheetSubCategories(catalogWorkspace)
        : catalogWorkspace === CATALOG_WORKSPACE_HOME_AUDIO
          ? [
              ...RISHABH_HOME_AUDIO_SUB_CATEGORIES,
              ...RISHABH_IT_ACCESSORIES_SUB_CATEGORIES,
            ]
          : catalogWorkspace === CATALOG_WORKSPACE_PERSONAL_AUDIO
            ? [...KARAN_TRACKED_SUB_CATEGORIES]
            : [...TRACKED_SUB_CATEGORIES];
    const parts = await Promise.all(
      tracked.map((key) =>
        loadCategoryGmsMonthlySelloutForOne(key, catalogWorkspace),
      ),
    );
    return mergeCategorySheetMonthlySellout(parts);
  }
  return loadCategoryGmsMonthlySelloutForOne(subCategory, catalogWorkspace);
}

async function loadCategoryGmsMonthlySelloutForOne(
  subCategory: WorkspaceSubCategory | string,
  catalogWorkspace: CatalogWorkspace,
): Promise<CategorySheetMonthlySellout> {
  return loadCategoryGmsMonthlySelloutBySheetSelection(
    ANALYSIS_CATEGORY_ALL,
    String(subCategory),
    catalogWorkspace,
    getActiveDataScope(),
  );
}

/** GMS category roll-up for sheet Category + Sub category (same selection as analysis / dashboards). */
async function loadGlobalCategoryGmsMonthlySelloutForSelection(
  category: string,
  subCategory: string,
  dataScope: DataScope = "default",
): Promise<CategorySheetMonthlySellout> {
  const buckets = new Map<
    CatalogWorkspace,
    { amazon: Set<string>; flipkart: Set<string> }
  >();
  for (const workspace of ADMIN_MANAGER_WORKSPACES) {
    buckets.set(workspace, { amazon: new Set(), flipkart: new Set() });
  }

  const seenAmazon = new Set<string>();
  const seenFlipkart = new Set<string>();

  const workspaceCodes = await Promise.all(
    ADMIN_MANAGER_WORKSPACES.map(async (workspace) => {
      const [amazonCodes, flipkartCodes] = await Promise.all([
        getGmsProductCodesForCategorySelection("amazon", category, subCategory, workspace, dataScope),
        getGmsProductCodesForCategorySelection("flipkart", category, subCategory, workspace, dataScope),
      ]);
      return { workspace, amazonCodes, flipkartCodes };
    }),
  );

  for (const { workspace, amazonCodes, flipkartCodes } of workspaceCodes) {
    const bucket = buckets.get(workspace)!;
    for (const code of amazonCodes) {
      const key = code.trim().toUpperCase();
      if (!key || seenAmazon.has(key)) continue;
      seenAmazon.add(key);
      bucket.amazon.add(key);
    }
    for (const code of flipkartCodes) {
      const key = code.trim().toUpperCase();
      if (!key || seenFlipkart.has(key)) continue;
      seenFlipkart.add(key);
      bucket.flipkart.add(key);
    }
  }

  const parts = (
    await Promise.all(
      [...buckets.entries()].map(async ([workspace, codes]) => {
        if (codes.amazon.size === 0 && codes.flipkart.size === 0) return null;
        const uploadCtx = await getLatestUploadContextByMarketplace(
          dataScope === "dawg" ? "dawg" : workspace,
        );
        const channelsActive = {
          amazon: uploadCtx.amazon != null,
          flipkart: uploadCtx.flipkart != null,
        };
        return loadCategoryGmsMonthlySelloutFromSkuCodes(
          [...codes.amazon],
          [...codes.flipkart],
          workspace,
          uploadCtx,
          channelsActive,
          { category, subCategory },
        );
      }),
    )
  ).filter((p): p is CategorySheetMonthlySellout => p != null);

  return {
    ...mergeCategorySheetMonthlySellout(parts),
    skuCountAmazon: seenAmazon.size,
    skuCountFlipkart: seenFlipkart.size,
    skuCount: seenAmazon.size + seenFlipkart.size,
  };
}

/** Admin global GMS category analysis — dedupe SKUs across manager workspaces before summing. */
export async function loadGlobalCategoryGmsMonthlySellout(
  category: string,
  subCategory: string,
  dataScope: DataScope = "default",
): Promise<CategorySheetMonthlySellout> {
  const cat = category.trim() || ANALYSIS_CATEGORY_ALL;
  const sub = subCategory.trim() || ANALYSIS_SUB_CATEGORY_ALL;

  if (isAnalysisCategoryAll(cat) && isAnalysisSubCategoryAll(sub)) {
    return loadGlobalCategoryGmsMonthlySelloutForSelection(
      ANALYSIS_CATEGORY_ALL,
      ANALYSIS_SUB_CATEGORY_ALL,
      dataScope,
    );
  }

  return loadGlobalCategoryGmsMonthlySelloutForSelection(cat, sub, dataScope);
}

export async function loadCategoryGmsMonthlySelloutBySheetSelection(
  category: string,
  subCategory: string,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
  dataScope: DataScope = getActiveDataScope(),
): Promise<CategorySheetMonthlySellout> {
  const cat = category.trim() || ANALYSIS_CATEGORY_ALL;
  const sub = subCategory.trim() || ANALYSIS_SUB_CATEGORY_ALL;

  const uploadCtx = await getLatestUploadContextByMarketplace(
    dataScope === "dawg" ? "dawg" : catalogWorkspace,
  );
  const channelsActive = {
    amazon: uploadCtx.amazon != null,
    flipkart: uploadCtx.flipkart != null,
  };

  const [codesAmazon, codesFlipkart] = await Promise.all([
    channelsActive.amazon
      ? getGmsProductCodesForCategorySelection(
          "amazon",
          cat,
          sub,
          catalogWorkspace,
          dataScope,
        )
      : Promise.resolve([] as string[]),
    channelsActive.flipkart
      ? getGmsProductCodesForCategorySelection(
          "flipkart",
          cat,
          sub,
          catalogWorkspace,
          dataScope,
        )
      : Promise.resolve([] as string[]),
  ]);

  return loadCategoryGmsMonthlySelloutFromSkuCodes(
    codesAmazon,
    codesFlipkart,
    catalogWorkspace,
    uploadCtx,
    channelsActive,
    { category: cat, subCategory: sub },
  );
}

async function loadCategoryGmsMonthlySelloutFromSkuCodes(
  codesAmazon: string[],
  codesFlipkart: string[],
  catalogWorkspace: CatalogWorkspace,
  uploadCtx: Awaited<ReturnType<typeof getLatestUploadContextByMarketplace>>,
  channelsActive: { amazon: boolean; flipkart: boolean },
  sheetSelection?: { category: string; subCategory: string },
): Promise<CategorySheetMonthlySellout> {
  const [bauFlipkart, soFlipkart] = await Promise.all([
    channelsActive.flipkart ? getBauMapsForCodes("flipkart", codesFlipkart) : Promise.resolve(new Map()),
    channelsActive.flipkart
      ? loadSkuMonthlySo("flipkart", codesFlipkart, uploadCtx.flipkart?.id ?? null)
      : Promise.resolve(new Map()),
  ]);
  const channelContext: { amazon: GmsCategoryChannelContext; flipkart: GmsCategoryChannelContext } = {
    amazon: {
      marketplace: "amazon",
      codes: codesAmazon,
      priceMap: new Map(),
      snapshotDate: uploadCtx.amazon?.snapshotDate ?? null,
      uploadId: uploadCtx.amazon?.id ?? null,
    },
    flipkart: {
      marketplace: "flipkart",
      codes: codesFlipkart,
      priceMap: bauFlipkart,
      snapshotDate: uploadCtx.flipkart?.snapshotDate ?? null,
      uploadId: uploadCtx.flipkart?.id ?? null,
    },
  };

  let resolvedAmazonCodes = codesAmazon;
  const monthlyAmazon = new Map<string, number>();
  if (channelsActive.amazon && uploadCtx.amazon?.snapshotDate) {
    const hariSheet =
      catalogWorkspace === CATALOG_WORKSPACE_MONITOR && sheetSelection
        ? sheetSelection
        : undefined;
    const official = await loadAmazonOfficialGmsMonthlyRollup(
      uploadCtx.amazon.snapshotDate,
      codesAmazon,
      hariSheet,
      uploadCtx.amazon.id,
      catalogWorkspace,
    );
    for (const [ym, v] of official.monthlyTotals) monthlyAmazon.set(ym, v);
    if (official.codes.length > 0) resolvedAmazonCodes = official.codes;
  }

  const monthlyFlipkart = rollupGmsFromSkuSo(soFlipkart, bauFlipkart, "flipkart");
  const monthlyCombined = new Map<string, number>();
  for (const [ym, v] of monthlyAmazon) monthlyCombined.set(ym, (monthlyCombined.get(ym) ?? 0) + v);
  for (const [ym, v] of monthlyFlipkart) monthlyCombined.set(ym, (monthlyCombined.get(ym) ?? 0) + v);

  const snapshotDatesForPrev = [
    channelsActive.amazon ? uploadCtx.amazon?.snapshotDate : null,
    channelsActive.flipkart ? uploadCtx.flipkart?.snapshotDate : null,
  ].filter(Boolean) as string[];
  if (snapshotDatesForPrev.length > 0) {
    const reportSnapshot = snapshotDatesForPrev.sort((a, b) => b.localeCompare(a))[0];
    const prevYm = previousMonthYmFromSnapshot(reportSnapshot);
    const prevAmazonGms = channelsActive.amazon ? (monthlyAmazon.get(prevYm) ?? 0) : 0;
    const prevFlipkartGms = channelsActive.flipkart
      ? await loadPreviousMonthGmsForChannel(channelContext.flipkart)
      : 0;
    applyPreviousMonthGmsWhenMissing(
      monthlyAmazon,
      monthlyFlipkart,
      monthlyCombined,
      channelsActive,
      prevYm,
      prevAmazonGms,
      prevFlipkartGms,
    );

    const priorFyFlipkartGms = channelsActive.flipkart
      ? await loadPriorFySoGmsForChannel(channelContext.flipkart)
      : 0;

    const withPriorFy = applyPriorFySoToMonthlyMaps(
      {
        skuCountAmazon: resolvedAmazonCodes.length,
        skuCountFlipkart: codesFlipkart.length,
        skuCount: resolvedAmazonCodes.length + codesFlipkart.length,
        channelsActive,
        monthlyAmazon,
        monthlyFlipkart,
        monthlyCombined,
        ongoingMonthMtd: null,
        previousMonthSo: null,
      },
      reportSnapshot,
      { amazon: 0, flipkart: priorFyFlipkartGms },
    );
    for (const [ym, v] of withPriorFy.monthlyFlipkart) monthlyFlipkart.set(ym, v);
    for (const [ym, v] of withPriorFy.monthlyCombined) {
      monthlyCombined.set(ym, (monthlyAmazon.get(ym) ?? 0) + v);
    }
  }

  const snapshotDates = [
    channelsActive.amazon ? uploadCtx.amazon?.snapshotDate : null,
    channelsActive.flipkart ? uploadCtx.flipkart?.snapshotDate : null,
  ].filter(Boolean) as string[];
  const reportSnapshotDate =
    snapshotDates.sort((a, b) => b.localeCompare(a))[0] ?? null;

  const nowYm = new Date().toISOString().slice(0, 7);
  let ongoingMonthMtd: CategoryOngoingMonthMtd | null = null;
  if (snapshotDates.length > 0) {
    const reportYm = snapshotDates.sort((a, b) => b.localeCompare(a))[0].slice(0, 7);
    if (reportYm === nowYm) {
      const amazon = channelsActive.amazon
        ? await loadGmsMtdForChannel(
            channelContext.amazon,
            sheetSelection,
            catalogWorkspace === CATALOG_WORKSPACE_MONITOR,
          )
        : 0;
      const flipkart = channelsActive.flipkart
        ? await loadGmsMtdForChannel(channelContext.flipkart, sheetSelection)
        : 0;
      ongoingMonthMtd = { monthYm: nowYm, amazon, flipkart };
    }
  }

  const base: CategorySheetMonthlySellout = {
    skuCountAmazon: resolvedAmazonCodes.length,
    skuCountFlipkart: codesFlipkart.length,
    skuCount: resolvedAmazonCodes.length + codesFlipkart.length,
    channelsActive,
    monthlyAmazon,
    monthlyFlipkart,
    monthlyCombined,
    ongoingMonthMtd,
    previousMonthSo: null,
    reportSnapshotDate,
  };
  const gmsBase = applyOngoingMtdToMaps(base);

  return gmsBase;
}

export type GmsProductRow = {
  product_code: string;
  product_name: string;
  sub_category: string | null;
  bau_price: number;
  planned_gms: number;
  target_gms: number;
  actual_gms_mtd: number;
  gap_gms: number;
  gap_units: number;
  suggestion: string;
};

export async function getGmsProductRows(
  marketplace: Marketplace,
  subCategory: SubCategoryFilter,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<GmsProductRow[]> {
  if (subCategory === "all") {
    if (catalogWorkspace === CATALOG_WORKSPACE_MONITOR) {
      return getGmsProductRowsBySheetSelection(
        marketplace,
        ANALYSIS_CATEGORY_ALL,
        ANALYSIS_SUB_CATEGORY_ALL,
        catalogWorkspace,
        getActiveDataScope(),
      );
    }
    const tracked =
      catalogWorkspace === CATALOG_WORKSPACE_RITHIKA
        ? await listDistinctRithikaSheetSubCategories(catalogWorkspace)
        : catalogWorkspace === CATALOG_WORKSPACE_HOME_AUDIO
          ? [...RISHABH_HOME_AUDIO_SUB_CATEGORIES]
          : catalogWorkspace === CATALOG_WORKSPACE_PERSONAL_AUDIO
            ? [...KARAN_TRACKED_SUB_CATEGORIES]
            : [...TRACKED_SUB_CATEGORIES];
    const parts = await Promise.all(
      tracked.map((key) =>
        getGmsProductRowsForOne(marketplace, key, catalogWorkspace),
      ),
    );
    const byCode = new Map<string, GmsProductRow>();
    for (const rows of parts) {
      for (const row of rows) {
        byCode.set(row.product_code, row);
      }
    }
    const merged = [...byCode.values()];
    merged.sort((a, b) => {
      const score = (row: GmsProductRow) =>
        row.planned_gms > 0 ? row.gap_gms : Number.NEGATIVE_INFINITY;
      const gapDiff = score(b) - score(a);
      if (gapDiff !== 0) return gapDiff;
      if (b.gap_units !== a.gap_units) return b.gap_units - a.gap_units;
      return a.product_name.localeCompare(b.product_name, "en-IN");
    });
    return merged;
  }
  return getGmsProductRowsForOne(marketplace, subCategory, catalogWorkspace);
}

/** Product GMS table filtered by sheet Category + Sub category. */
export async function getGmsProductRowsBySheetSelection(
  marketplace: Marketplace,
  category: string,
  subCategory: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
  dataScope: DataScope = getActiveDataScope(),
): Promise<GmsProductRow[]> {
  const cat = category.trim() || ANALYSIS_CATEGORY_ALL;
  const sub = subCategory.trim() || ANALYSIS_SUB_CATEGORY_ALL;

  let codes = await getGmsProductCodesForCategorySelection(
    marketplace,
    cat,
    sub,
    catalogWorkspace,
    dataScope,
  );
  if (marketplace === "amazon" && catalogWorkspace === CATALOG_WORKSPACE_MONITOR) {
    const uploadCtx = await getLatestUploadContextByMarketplace(catalogWorkspace);
    if (uploadCtx.amazon?.snapshotDate) {
      const official = await sumAmazonOfficialMayMtdForSheetSelection(
        uploadCtx.amazon.snapshotDate,
        cat,
        sub,
        codes,
        uploadCtx.amazon.id,
      );
      if (official.codes.length > 0) codes = official.codes;
    }
  }
  return getGmsProductRowsForCodes(marketplace, codes, catalogWorkspace);
}

async function getGmsProductRowsForOne(
  marketplace: Marketplace,
  subCategory: SubCategory | string,
  catalogWorkspace: CatalogWorkspace,
): Promise<GmsProductRow[]> {
  const codes = await categoryRollupProductCodes(
    marketplace,
    ANALYSIS_CATEGORY_ALL,
    String(subCategory),
    catalogWorkspace,
    getActiveDataScope(),
  );
  return getGmsProductRowsForCodes(marketplace, codes, catalogWorkspace, subCategory);
}

async function getGmsProductRowsForCodes(
  marketplace: Marketplace,
  codes: string[],
  catalogWorkspace: CatalogWorkspace,
  subCategoryFilter?: SubCategory | string,
): Promise<GmsProductRow[]> {
  const uploadCtx = await getLatestUploadContextByMarketplace(catalogWorkspace);
  const ctx = marketplace === "amazon" ? uploadCtx.amazon : uploadCtx.flipkart;
  if (!ctx) return [];

  const codeSet = new Set(codes);
  const { data: products, error } = await supabase
    .from("product_master")
    .select("product_code, product_name, sub_category, category, bau_price")
    .eq("marketplace", marketplace)
    .in("product_code", codes.length ? codes : ["__none__"]);
  if (error) throw new Error(getErrorMessage(error));

  const filtered = ((products ?? []) as ProductMaster[]).filter((p) => {
    if (!codeSet.has(p.product_code)) return false;
    if (!subCategoryFilter) return true;
    if (
      catalogWorkspace === CATALOG_WORKSPACE_RITHIKA ||
      catalogWorkspace === CATALOG_WORKSPACE_HOME_AUDIO
    ) {
      return productMatchesSubCategoryForWorkspace(
        subCategoryFilter,
        p,
        marketplace,
        catalogWorkspace,
      );
    }
    if (catalogWorkspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) {
      return productMatchesSubCategoryForWorkspace(
        subCategoryFilter,
        p,
        marketplace,
        catalogWorkspace,
      );
    }
    if (
      catalogWorkspace === CATALOG_WORKSPACE_MONITOR &&
      TRACKED_SUB_CATEGORIES.includes(subCategoryFilter as SubCategory)
    ) {
      return productMatchesStrictSheetCategoryRollup(subCategoryFilter as SubCategory, p);
    }
    return productMatchesSubCategoryForWorkspace(
      subCategoryFilter,
      p,
      marketplace,
      catalogWorkspace,
    );
  });
  const bauMap = await getBauMapsForCodes(marketplace, codes, ctx.snapshotDate);
  const nowYm = new Date().toISOString().slice(0, 7);

  const planMap = new Map<string, { planned: number; target: number }>();
  for (const chunk of chunkArray(codes, 150)) {
    const { data: plans, error: pErr } = await supabase
      .from("gms_plan_monthly")
      .select("product_code, planned_gms, target_gms")
      .eq("marketplace", marketplace)
      .eq("month_ym", nowYm)
      .in("product_code", chunk);
    if (pErr && !getErrorMessage(pErr).includes("does not exist")) throw new Error(getErrorMessage(pErr));
    for (const row of (plans ?? []) as {
      product_code: string;
      planned_gms: unknown;
      target_gms: unknown;
    }[]) {
      planMap.set(String(row.product_code), {
        planned: Number(row.planned_gms ?? 0),
        target: Number(row.target_gms ?? 0),
      });
    }
  }

  const mtdMap = new Map<string, number>();
  if (marketplace === "amazon") {
    const amazonMtd = await loadAmazonGmsTrackerMtdByCodes(
      ctx.snapshotDate,
      ctx.id,
      codes,
      bauMap,
    );
    for (const code of codes) {
      mtdMap.set(code, lookupMtdFromMap("amazon", amazonMtd, code));
    }
  } else {
    const frozenMtdMap = await loadFrozenMtdGmsByCodes(
      marketplace,
      ctx.snapshotDate,
      ctx.id,
      codes,
      bauMap,
    );
    for (const code of codes) {
      mtdMap.set(code, frozenMtdMap.get(code) ?? 0);
    }
  }

  const rows = filtered.map((p) => {
    const bau = bauMap.get(p.product_code)?.bau ?? 0;
    const plan = planMap.get(p.product_code) ?? { planned: 0, target: 0 };
    const actual = mtdMap.get(p.product_code) ?? 0;
    const gap = buildGmsGapSuggestion(plan.planned, actual, bau);
    return {
      product_code: p.product_code,
      product_name: p.product_name,
      sub_category: p.sub_category,
      bau_price: bau,
      planned_gms: plan.planned,
      target_gms: plan.target,
      actual_gms_mtd: actual,
      gap_gms: gap.gapGms,
      gap_units: gap.gapUnits,
      suggestion: gap.message,
    };
  });

  /** Most behind plan first; no-plan rows last; ahead-of-plan at bottom. */
  rows.sort((a, b) => {
    const score = (row: GmsProductRow) =>
      row.planned_gms > 0 ? row.gap_gms : Number.NEGATIVE_INFINITY;
    const gapDiff = score(b) - score(a);
    if (gapDiff !== 0) return gapDiff;
    if (b.gap_units !== a.gap_units) return b.gap_units - a.gap_units;
    return a.product_name.localeCompare(b.product_name, "en-IN");
  });

  return rows;
}

export type ProductGmsMonthPoint = { month_ym: string; so_units: number; gms_inr: number };

export async function loadProductGmsHistory(
  marketplace: Marketplace,
  productCode: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<{
  product: ProductMaster | null;
  bau_price: number;
  months: ProductGmsMonthPoint[];
  planCurrent: { planned: number; target: number };
  mtdGms: number;
}> {
  const { data: product, error: pErr } = await supabase
    .from("product_master")
    .select("*")
    .eq("marketplace", marketplace)
    .eq("product_code", productCode)
    .maybeSingle();
  if (pErr) throw new Error(getErrorMessage(pErr));

  const uploadCtx = await getLatestUploadContextByMarketplace(catalogWorkspace);
  const ctx = marketplace === "amazon" ? uploadCtx.amazon : uploadCtx.flipkart;
  const bauMap = await getBauMapsForCodes(
    marketplace,
    [productCode],
    uploadCtx.amazon?.snapshotDate ?? uploadCtx.flipkart?.snapshotDate ?? null,
  );
  const pricePair = bauMap.get(productCode) ?? { bau: 0, event: 0 };
  const bau = pricePair.bau;

  const nowYm = new Date().toISOString().slice(0, 7);
  let mtdGms = 0;
  const monthsByYm = new Map<string, { so_units: number; gms_inr: number }>();

  if (ctx && marketplace === "amazon") {
    const snapshotDate = resolveOfficialAmazonGmsAsOfDate(ctx.snapshotDate);
    const normalizedCode =
      normalizeMarketplaceProductCode("amazon", productCode) || productCode;
    const reportYm = ctx.snapshotDate.slice(0, 7);

    const [{ data: officialMonths, error: omErr }, { data: metricRow, error: metricErr }] =
      await Promise.all([
        supabase
          .from("gms_official_monthly")
          .select("month_ym, gms_inr")
          .eq("marketplace", "amazon")
          .eq("product_code", normalizedCode)
          .eq("as_of_date", snapshotDate)
          .eq("upload_id", ctx.id),
        supabase
          .from("computed_metrics")
          .select("may_mtd_units")
          .eq("marketplace", "amazon")
          .eq("product_code", normalizedCode)
          .eq("as_of_date", ctx.snapshotDate)
          .eq("upload_id", ctx.id)
          .maybeSingle(),
      ]);
    if (omErr && !isMissingGmsOfficialMonthlySchemaError(omErr)) {
      throw new Error(getErrorMessage(omErr));
    }
    if (metricErr) throw new Error(getErrorMessage(metricErr));

    const maySoUnits = Number(
      (metricRow as { may_mtd_units?: number } | null)?.may_mtd_units ?? 0,
    );

    for (const row of (officialMonths ?? []) as Array<{ month_ym: string; gms_inr: unknown }>) {
      const ym = String(row.month_ym ?? "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      if (ym === reportYm) continue;
      const raw = Number(row.gms_inr ?? 0);
      const gms = Number.isFinite(raw) ? amazonGmsAvsMtdInr(raw, bau, 0) : 0;
      monthsByYm.set(ym, { so_units: 0, gms_inr: gms });
    }

    const dailyMtd = lookupMtdFromMap(
      "amazon",
      await loadAmazonOfficialMayMtdByCodes(snapshotDate, [normalizedCode], ctx.id),
      normalizedCode,
    );

    mtdGms = resolveAmazonProductMtdGms(dailyMtd, bau, maySoUnits);
    if (mtdGms > 0) {
      monthsByYm.set(nowYm, { so_units: maySoUnits, gms_inr: mtdGms });
    }
  } else if (ctx) {
    const soByMonth =
      (await loadSkuMonthlySo(marketplace, [productCode], ctx.id)).get(productCode) ??
      new Map<string, number>();
    const frozen = await loadFrozenMtdGmsByCodes(
      marketplace,
      ctx.snapshotDate,
      ctx.id,
      [productCode],
      bauMap,
    );
    mtdGms = lookupMtdFromMap(marketplace, frozen, productCode);
    const { data: m } = await supabase
      .from("computed_metrics")
      .select("may_mtd_units")
      .eq("marketplace", marketplace)
      .eq("product_code", productCode)
      .eq("as_of_date", ctx.snapshotDate)
      .eq("upload_id", ctx.id)
      .maybeSingle();
    if (ctx.snapshotDate.slice(0, 7) === nowYm) {
      soByMonth.set(nowYm, Number((m as { may_mtd_units?: number } | null)?.may_mtd_units ?? 0));
    }
    for (const [month_ym, so_units] of soByMonth) {
      monthsByYm.set(month_ym, {
        so_units,
        gms_inr:
          month_ym === ctx.snapshotDate.slice(0, 7) && month_ym === nowYm
            ? mtdGms
            : gmsFromFlipkartSellout(pricePair.bau, pricePair.event, so_units, month_ym),
      });
    }
  }

  const months: ProductGmsMonthPoint[] = [...monthsByYm.entries()]
    .map(([month_ym, v]) => ({
      month_ym,
      so_units: v.so_units,
      gms_inr: v.gms_inr,
    }))
    .sort((a, b) => a.month_ym.localeCompare(b.month_ym));

  const { data: plan } = await supabase
    .from("gms_plan_monthly")
    .select("planned_gms, target_gms")
    .eq("marketplace", marketplace)
    .eq("product_code", productCode)
    .eq("month_ym", nowYm)
    .maybeSingle();

  return {
    product: (product as ProductMaster | null) ?? null,
    bau_price: bau,
    months,
    planCurrent: {
      planned: Number((plan as { planned_gms?: number } | null)?.planned_gms ?? 0),
      target: Number((plan as { target_gms?: number } | null)?.target_gms ?? 0),
    },
    mtdGms,
  };
}

export async function updateProductBauPrice(
  marketplace: Marketplace,
  productCode: string,
  bauPrice: number,
): Promise<void> {
  const price =
    Number.isFinite(bauPrice) && bauPrice > 0 ? Math.round(bauPrice * 100) / 100 : null;
  const { error } = await supabase
    .from("product_master")
    .update({ bau_price: price })
    .eq("marketplace", marketplace)
    .eq("product_code", productCode);
  if (error) throw new Error(getErrorMessage(error));
}

async function buildExpandedBauBenchmarkRows(
  rows: ParsedBauRow[],
): Promise<Array<{ marketplace: Marketplace; product_code: string; bau_price: number; event_price: number }>> {
  const deduped = new Map<
    string,
    { marketplace: Marketplace; product_code: string; bau_price: number; event_price: number }
  >();
  const modelOnly: ParsedBauRow[] = [];

  for (const row of rows) {
    const skus = expandRowToChannelSkusSync(row);
    if (skus.length > 0) {
      for (const sku of skus) {
        deduped.set(skuKey(sku.marketplace, sku.product_code), {
          ...sku,
            bau_price: row.bau_sp,
            event_price: row.event_sp,
        });
      }
    } else if (row.product_name.trim()) {
      modelOnly.push(row);
    }
  }

  if (modelOnly.length > 0) {
    const names = [...new Set(modelOnly.map((r) => r.product_name.trim()).filter(Boolean))];
    for (const nameChunk of chunkArray(names, 80)) {
      const { data, error } = await supabase
        .from("product_master")
        .select("marketplace, product_code, product_name")
        .in("product_name", nameChunk);
      if (error) throw new Error(getErrorMessage(error));
      const byName = new Map<string, ChannelSkuRef[]>();
      for (const p of (data ?? []) as Array<{
        marketplace: Marketplace;
        product_code: string;
        product_name: string;
      }>) {
        const list = byName.get(p.product_name) ?? [];
        list.push({ marketplace: p.marketplace, product_code: p.product_code });
        byName.set(p.product_name, list);
      }
      for (const row of modelOnly) {
        const matches = byName.get(row.product_name.trim()) ?? [];
        for (const sku of matches) {
          deduped.set(skuKey(sku.marketplace, sku.product_code), {
            ...sku,
            bau_price: row.bau_sp,
            event_price: row.event_sp,
          });
        }
      }
    }
  }

  return [...deduped.values()];
}

export async function ingestBauUpload({
  payload,
  fileName,
  uploadedBy,
}: {
  payload: ParsedBauPayload;
  fileName: string;
  uploadedBy: string;
}): Promise<string> {
  const expanded = await buildExpandedBauBenchmarkRows(payload.rows);

  if (expanded.length === 0) {
    throw new Error(
      "No SKUs matched. Upload Amazon and Flipkart sellout masters first so ASIN/FSN exist in Product Master, then re-upload BAU.",
    );
  }

  const uploadId = await insertGmsAuxUploadRow({
    marketplace: "amazon",
    file_name: fileName,
    uploaded_by: uploadedBy,
    snapshot_date: new Date().toISOString().slice(0, 10),
    status: "processing",
    upload_kind: "bau",
    raw_row_count: payload.rows.length,
    valid_row_count: expanded.length,
    rejected_row_count: payload.errors.length,
    notes: "Amazon + Flipkart combined BAU sheet",
  });

  try {
    const effectiveFrom = new Date().toISOString().slice(0, 10);
    await upsertInBatches(
      "product_bau_benchmark",
      expanded.map((r) => ({
        marketplace: r.marketplace,
        product_code: r.product_code,
        bau_price: r.bau_price,
        event_price: r.event_price,
        upload_id: uploadId,
      })),
      "marketplace,product_code",
    );
    await upsertInBatches(
      "product_bau_price_history",
      expanded.map((r) => ({
        marketplace: r.marketplace,
        product_code: r.product_code,
        effective_from: effectiveFrom,
        bau_price: r.bau_price,
        event_price: r.event_price,
        upload_id: uploadId,
      })),
      "marketplace,product_code,effective_from",
    );
  } catch (e: unknown) {
    const reason = getErrorMessage(e);
    await supabase
      .from("uploads")
      .update({
        status: "failed",
        notes: `BAU upload failed: ${reason}`,
      })
      .eq("id", uploadId);
    if (isMissingSchemaError(e, "product_bau_benchmark")) {
      throw new Error(
        "Table product_bau_benchmark is missing. Run supabase/run-gms-tracker.sql in Supabase SQL Editor, then upload again.",
        { cause: e },
      );
    }
    throw e;
  }

  await supabase
    .from("uploads")
    .update({
      status: "completed",
      notes: `BAU: ${payload.rows.length} sheet rows → ${expanded.length} SKUs (Amazon + Flipkart)`,
    })
    .eq("id", uploadId);

  await pruneOlderUploads(uploadId);
  return uploadId;
}

/** Ingest every month from GMS_AVS into gms_official_monthly (+ current month snapshot row). */
export async function ingestAmazonGmsAvsMayMtd({
  rows,
  snapshotDate,
  uploadId = null,
}: {
  rows: ParsedAmazonGmsAvsRow[];
  snapshotDate: string;
  uploadId?: string | null;
}): Promise<number> {
  if (!rows.length) return 0;

  const reportYm = snapshotDate.slice(0, 7);
  const asins = [
    ...new Set(
      rows
        .map((row) => normalizeMarketplaceProductCode("amazon", row.asin))
        .filter(Boolean) as string[],
    ),
  ];

  for (const chunk of chunkArray(asins, 150)) {
    const { error: delMonthly } = await supabase
      .from("gms_official_monthly")
      .delete()
      .eq("marketplace", "amazon")
      .eq("as_of_date", snapshotDate)
      .in("product_code", chunk);
    if (delMonthly && !isMissingGmsOfficialMonthlySchemaError(delMonthly)) {
      throw new Error(getErrorMessage(delMonthly));
    }
    const { error: delDaily } = await supabase
      .from("gms_daily_snapshot")
      .delete()
      .eq("marketplace", "amazon")
      .eq("as_of_date", snapshotDate)
      .in("product_code", chunk);
    if (delDaily && !isMissingGmsDailySnapshotSchemaError(delDaily)) {
      throw new Error(getErrorMessage(delDaily));
    }
  }

  const monthlyRows: Array<{
    marketplace: "amazon";
    product_code: string;
    month_ym: string;
    as_of_date: string;
    gms_inr: number;
    sheet_category: string | null;
    sheet_sub_category: string | null;
    upload_id: string | null;
  }> = [];

  for (const row of rows) {
    const asin =
      normalizeMarketplaceProductCode("amazon", row.asin) ?? row.asin.trim().toUpperCase();
    for (const { month_ym, gms_inr } of row.months) {
      const ym = month_ym.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      const gms = Number.isFinite(gms_inr) ? Math.max(0, gms_inr) : 0;
      monthlyRows.push({
        marketplace: "amazon",
        product_code: asin,
        month_ym: ym,
        as_of_date: snapshotDate,
        gms_inr: gms,
        sheet_category: row.sheet_category ?? null,
        sheet_sub_category: row.sheet_sub_category ?? null,
        upload_id: uploadId,
      });
    }
  }

  if (monthlyRows.length > 0) {
    for (const chunk of chunkArray(monthlyRows, 400)) {
      const { error } = await supabase.from("gms_official_monthly").upsert(chunk, {
        onConflict: "marketplace,product_code,month_ym,as_of_date",
      });
      if (error) {
        if (isMissingGmsOfficialMonthlySchemaError(error)) {
          throw new Error(
            "Table gms_official_monthly is missing. Run supabase/run-gms-tracker.sql in Supabase SQL Editor, then retry.",
          );
        }
        throw new Error(getErrorMessage(error));
      }
    }
  }

  const dailyUpserts = rows.map((row) => {
    const asin =
      normalizeMarketplaceProductCode("amazon", row.asin) ?? row.asin.trim().toUpperCase();
    const fromMayMtdCol = Number(row.may_mtd_inr ?? 0);
    const fromMonths =
      row.months.find((m) => m.month_ym.slice(0, 7) === reportYm)?.gms_inr ??
      row.months[row.months.length - 1]?.gms_inr ??
      0;
    const gms = Number.isFinite(fromMayMtdCol) && fromMayMtdCol > 0
      ? fromMayMtdCol
      : Number.isFinite(fromMonths)
        ? Math.max(0, fromMonths)
        : 0;
    return {
      marketplace: "amazon" as const,
      product_code: asin,
      as_of_date: snapshotDate,
      upload_id: uploadId,
      so_units_mtd: 0,
      bau_price_used: 0,
      event_price_used: 0,
      price_source: "official_may_mtd" as const,
      gms_inr_mtd: gms,
      sheet_category: row.sheet_category ?? null,
      sheet_sub_category: row.sheet_sub_category ?? null,
    };
  });

  const upsertOpts = { onConflict: "marketplace,product_code,as_of_date" as const };
  let { error } = await supabase.from("gms_daily_snapshot").upsert(dailyUpserts, upsertOpts);
  if (
    error &&
    (isMissingGmsSnapshotColumnError(error, "sheet_category") ||
      isMissingGmsSnapshotColumnError(error, "sheet_sub_category"))
  ) {
    const legacyRows = dailyUpserts.map(
      ({ sheet_category: _c, sheet_sub_category: _s, ...rest }) => rest,
    );
    ({ error } = await supabase.from("gms_daily_snapshot").upsert(legacyRows, upsertOpts));
  }
  if (error && !isMissingGmsDailySnapshotSchemaError(error)) {
    throw new Error(getErrorMessage(error));
  }

  return rows.length;
}

/** Parse GMS_AVS from the Amazon sellout workbook and upsert official May MTD + monthly GMS. */
/** Remove stale official GMS for a sellout date when GMS_AVS is missing from the workbook. */
async function clearAmazonGmsAvsForSnapshotDate(snapshotDate: string): Promise<void> {
  if (!snapshotDate) return;
  const { error: dailyErr } = await supabase
    .from("gms_daily_snapshot")
    .delete()
    .eq("marketplace", "amazon")
    .eq("as_of_date", snapshotDate)
    .eq("price_source", "official_may_mtd");
  if (dailyErr && !isMissingGmsDailySnapshotSchemaError(dailyErr)) {
    throw new Error(getErrorMessage(dailyErr));
  }
  const { error: monthlyErr } = await supabase
    .from("gms_official_monthly")
    .delete()
    .eq("marketplace", "amazon")
    .eq("as_of_date", snapshotDate);
  if (monthlyErr && !isMissingGmsOfficialMonthlySchemaError(monthlyErr)) {
    throw new Error(getErrorMessage(monthlyErr));
  }
}

export async function syncAmazonGmsAvsFromWorkbook(
  file: File,
  snapshotDate: string,
  uploadId: string | null = null,
): Promise<{ synced: number; warning: string | null }> {
  const { parseAmazonGmsAvsFile } = await import("./parsers-gms");
  try {
    const { rows, errors } = await parseAmazonGmsAvsFile(file, snapshotDate);
    if (rows.length === 0) {
      await clearAmazonGmsAvsForSnapshotDate(snapshotDate);
      return { synced: 0, warning: "GMS_AVS tab not found or has no GMS rows." };
    }
    await ingestAmazonGmsAvsMayMtd({ rows, snapshotDate, uploadId });
    const warn =
      errors.length > 0 ? `${errors.length} GMS_AVS row warning(s) during parse.` : null;
    return { synced: rows.length, warning: warn };
  } catch (e: unknown) {
    return {
      synced: 0,
      warning: e instanceof Error ? e.message : "GMS_AVS parse failed.",
    };
  }
}

async function buildExpandedGmsPlanRows(rows: ParsedGmsPlanRow[]): Promise<
  Array<{
    marketplace: Marketplace;
    product_code: string;
    month_ym: string;
    planned_gms: number;
    target_gms: number;
  }>
> {
  const deduped = new Map<
    string,
    {
      marketplace: Marketplace;
      product_code: string;
      month_ym: string;
      planned_gms: number;
      target_gms: number;
    }
  >();

  for (const row of rows) {
    const skus = expandRowToChannelSkusSync(row);
    for (const sku of skus) {
      const key = `${skuKey(sku.marketplace, sku.product_code)}:${row.month_ym}`;
      deduped.set(key, {
        marketplace: sku.marketplace,
        product_code: sku.product_code,
        month_ym: row.month_ym,
        planned_gms: row.planned_gms,
        target_gms: row.target_gms,
      });
    }
  }

  return [...deduped.values()];
}

export async function ingestGmsPlanUpload({
  payload,
  fileName,
  uploadedBy,
}: {
  payload: ParsedGmsPlanPayload;
  fileName: string;
  uploadedBy: string;
}): Promise<string> {
  const expanded = await buildExpandedGmsPlanRows(payload.rows);

  if (expanded.length === 0) {
    throw new Error(
      "No GMS plan cells matched SKUs. Check ASIN/FSN columns and upload sellout masters first.",
    );
  }

  const uploadId = await insertGmsAuxUploadRow({
    marketplace: "amazon",
    file_name: fileName,
    uploaded_by: uploadedBy,
    snapshot_date: new Date().toISOString().slice(0, 10),
    status: "processing",
    upload_kind: "gms_plan",
    raw_row_count: payload.rows.length,
    valid_row_count: expanded.length,
    rejected_row_count: payload.errors.length,
    notes: "Amazon + Flipkart combined GMS plan",
  });

  try {
    await upsertInBatches(
    "gms_plan_monthly",
    expanded.map((r) => ({
      marketplace: r.marketplace,
      product_code: r.product_code,
      month_ym: r.month_ym,
      planned_gms: r.planned_gms,
      target_gms: r.target_gms,
      upload_id: uploadId,
    })),
    "marketplace,product_code,month_ym",
    );
  } catch (e: unknown) {
    const reason = getErrorMessage(e);
    await supabase
      .from("uploads")
      .update({
        status: "failed",
        notes: `GMS plan upload failed: ${reason}`,
      })
      .eq("id", uploadId);
    if (isMissingSchemaError(e, "gms_plan_monthly")) {
      throw new Error(
        "Table gms_plan_monthly is missing. Run supabase/run-gms-tracker.sql in Supabase SQL Editor, then upload again.",
        { cause: e },
      );
    }
    throw e;
  }

  await supabase
    .from("uploads")
    .update({
      status: "completed",
      notes: `GMS plan: ${payload.rows.length} sheet rows → ${expanded.length} cells (Amazon + Flipkart)`,
    })
    .eq("id", uploadId);

  await pruneOlderUploads(uploadId);
  return uploadId;
}

export type UnifiedProductGmsChannelSlice = {
  product_code: string;
  product: ProductMaster | null;
  bau_price: number;
  mtdGms: number;
  planCurrent: { planned: number; target: number };
};

export type UnifiedProductGmsHistory = {
  productName: string;
  asin: string;
  fsn: string;
  erpProductId: string | null;
  channelsActive: { amazon: boolean; flipkart: boolean };
  amazon: UnifiedProductGmsChannelSlice | null;
  flipkart: UnifiedProductGmsChannelSlice | null;
  sheetMonths: CategorySheetMonthlySellout;
  mtdGms: number;
  planCurrent: { planned: number; target: number };
  /** BAU from primary channel (Amazon when linked) for gap-units hint. */
  bau_price: number;
};

/**
 * Product-wise GMS with Amazon + Flipkart split — same monthly rollup as category GMS charts.
 */
export async function loadUnifiedProductGmsHistory(
  entryMarketplace: Marketplace,
  productCode: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<UnifiedProductGmsHistory> {
  const entry = await loadProductGmsHistory(entryMarketplace, productCode, catalogWorkspace);
  const peers = await getPeersForSelloutChannel(
    entryMarketplace,
    productCode,
    entry.product?.product_name ?? undefined,
    catalogWorkspace,
  );

  const amazonCode = String(peers.amazon?.product_code ?? "").trim().toUpperCase();
  const flipkartCode = String(peers.flipkart?.product_code ?? "").trim().toUpperCase();

  const uploadCtx = await getLatestUploadContextByMarketplace(catalogWorkspace);
  const channelsActive = {
    amazon: Boolean(uploadCtx.amazon?.id && amazonCode),
    flipkart: Boolean(uploadCtx.flipkart?.id && flipkartCode),
  };

  const sheetMonths = await loadCategoryGmsMonthlySelloutFromSkuCodes(
    amazonCode ? [amazonCode] : [],
    flipkartCode ? [flipkartCode] : [],
    catalogWorkspace,
    uploadCtx,
    channelsActive,
  );

  const [amazonDetail, flipkartDetail] = await Promise.all([
    amazonCode
      ? loadProductGmsHistory("amazon", amazonCode, catalogWorkspace)
      : Promise.resolve(null),
    flipkartCode
      ? loadProductGmsHistory("flipkart", flipkartCode, catalogWorkspace)
      : Promise.resolve(null),
  ]);

  /** Per-SKU MTD from ingested sheet (GMS_AVS May MTD / Flipkart sellout snapshot), not category rollup. */
  const mtdAmazon = channelsActive.amazon ? (amazonDetail?.mtdGms ?? 0) : 0;
  const mtdFlipkart = channelsActive.flipkart ? (flipkartDetail?.mtdGms ?? 0) : 0;

  const labelSource =
    peers.amazon?.product_name ??
    peers.flipkart?.product_name ??
    entry.product?.product_name ??
    productCode;
  const displayName = displayModelName(labelSource, amazonCode || flipkartCode || productCode);

  const slice = (
    code: string,
    detail: Awaited<ReturnType<typeof loadProductGmsHistory>> | null,
    mtd: number,
  ): UnifiedProductGmsChannelSlice | null => {
    if (!code || !detail) return null;
    return {
      product_code: code,
      product: detail.product,
      bau_price: detail.bau_price,
      mtdGms: mtd,
      planCurrent: detail.planCurrent,
    };
  };

  return {
    productName: displayName === "—" ? productCode : displayName,
    asin: amazonCode,
    fsn: flipkartCode,
    erpProductId: peers.erpProductId,
    channelsActive,
    amazon: slice(amazonCode, amazonDetail, mtdAmazon),
    flipkart: slice(flipkartCode, flipkartDetail, mtdFlipkart),
    sheetMonths,
    mtdGms: mtdAmazon + mtdFlipkart,
    planCurrent: {
      planned:
        (amazonDetail?.planCurrent.planned ?? 0) + (flipkartDetail?.planCurrent.planned ?? 0),
      target: (amazonDetail?.planCurrent.target ?? 0) + (flipkartDetail?.planCurrent.target ?? 0),
    },
    bau_price: amazonDetail?.bau_price ?? flipkartDetail?.bau_price ?? entry.bau_price ?? 0,
  };
}

/** Product-wise GMS opened from ERP product ID (same combined view as listing entry). */
export async function loadUnifiedProductGmsHistoryByErpId(
  erpProductId: string,
  catalogWorkspace: CatalogWorkspace = getActiveCatalogWorkspace(),
): Promise<UnifiedProductGmsHistory> {
  const ctx = await resolveProductContextByErpId(erpProductId, catalogWorkspace);
  if (!ctx) {
    throw new Error(
      `Product ID ${erpProductId} was not found. Re-upload HO stock or search by ASIN / FSN / model.`,
    );
  }
  const entryMarketplace: Marketplace | null = ctx.amazon
    ? "amazon"
    : ctx.flipkart
      ? "flipkart"
      : null;
  const entryCode = ctx.amazon?.product_code ?? ctx.flipkart?.product_code ?? "";
  if (!entryMarketplace || !entryCode) {
    throw new Error(`Product ID ${erpProductId} has no Amazon or Flipkart listing in this workspace.`);
  }
  return loadUnifiedProductGmsHistory(entryMarketplace, entryCode, catalogWorkspace);
}
