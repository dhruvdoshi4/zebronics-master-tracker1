import {
  applyOngoingMtdToMaps,
  applyPriorFySoToMonthlyMaps,
  mergeCategorySheetMonthlySellout,
  previousMonthYmFromSnapshot,
  priorFyMonthYms,
  type CategoryOngoingMonthMtd,
  type CategorySheetMonthlySellout,
} from "./category-sellout-insights";
import { effectiveBauPrice, gmsFromBauAndSo, buildGmsGapSuggestion } from "./gms";
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
import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  isAnalysisCategoryAll,
  isAnalysisSubCategoryAll,
} from "./analysis-category-paths";
import {
  chunkArray,
  getLatestUploadContextByMarketplace,
  getProductCodesForCategoryAnalysis,
  getProductCodesForCategoryHistoryRollup,
  listDistinctRishabhSheetSubCategories,
  listDistinctRithikaSheetSubCategories,
  pruneOlderUploads,
  productMatchesCategoryRollup,
  productMatchesSubCategoryForWorkspace,
  type WorkspaceSubCategory,
} from "./data";
import type { DataScope } from "./types";
import { getActiveDataScope } from "./workspace-data-scope";
import type {
  ParsedAmazonGmsAvsRow,
  ParsedBauPayload,
  ParsedBauRow,
  ParsedGmsPlanPayload,
  ParsedGmsPlanRow,
} from "./parsers-gms";

type ChannelSkuRef = { marketplace: Marketplace; product_code: string };
type GmsDailySnapshotRow = {
  marketplace: Marketplace;
  product_code: string;
  as_of_date: string;
  upload_id: string | null;
  so_units_mtd: number;
  bau_price_used: number;
  event_price_used?: number;
  price_source?: "bau" | "event" | "official_may_mtd";
  gms_inr_mtd: number;
};
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

async function loadFrozenMtdGmsByCodes(
  marketplace: Marketplace,
  asOfDate: string,
  uploadId: string | null,
  codes: string[],
  priceMap: Map<string, PricePair>,
): Promise<Map<string, number>> {
  const gmsByCode = new Map<string, number>();
  if (codes.length === 0) return gmsByCode;

  const missing = new Set(codes);
  let snapshotTableAvailable = true;

  for (const chunk of chunkArray(codes, 150)) {
    const { data, error } = await supabase
      .from("gms_daily_snapshot")
      .select("product_code, gms_inr_mtd")
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
    for (const row of (data ?? []) as Array<{ product_code: string; gms_inr_mtd: unknown }>) {
      const code = String(row.product_code);
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
      let gms = 0;
      let source: "bau" | "event" | "official_may_mtd" = "bau";
      if (marketplace === "amazon") {
        source = "official_may_mtd";
        gms = 0;
      } else {
        const day = new Date(asOfDate).getDay();
        const weekendPricing = day === 5 || day === 6 || day === 0;
        const effectivePrice = weekendPricing ? (price.event > 0 ? price.event : price.bau) : price.bau;
        source = weekendPricing && price.event > 0 ? "event" : "bau";
        gms = effectivePrice > 0 && drr > 0 ? (effectivePrice * drr) / 1.18 : 0;
      }
      gmsByCode.set(code, gms);
      rowsToInsert.push({
        marketplace,
        product_code: code,
        as_of_date: asOfDate,
        upload_id: uploadId,
        so_units_mtd: units,
        bau_price_used: price.bau,
        event_price_used: price.event,
        price_source: source,
        gms_inr_mtd: gms,
      });
    }
  }

  if (snapshotTableAvailable && rowsToInsert.length > 0) {
    const { error: writeErr } = await supabase
      .from("gms_daily_snapshot")
      .upsert(rowsToInsert, {
        onConflict: "marketplace,product_code,as_of_date",
        ignoreDuplicates: true,
      });
    if (writeErr && !isMissingGmsDailySnapshotSchemaError(writeErr)) {
      // Best-effort persistence: reads still work even if snapshot write is blocked by RLS.
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
): Map<string, number> {
  const monthly = new Map<string, number>();
  for (const [code, months] of skuSo) {
    const bau = priceMap.get(code)?.bau ?? 0;
    for (const [ym, units] of months) {
      monthly.set(ym, (monthly.get(ym) ?? 0) + gmsFromBauAndSo(bau, units));
    }
  }
  return monthly;
}

async function loadGmsMtdForChannel(
  channel: GmsCategoryChannelContext,
): Promise<number> {
  const { marketplace, codes, snapshotDate, uploadId, priceMap } = channel;
  if (!snapshotDate || !uploadId) return 0;
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
      const bau = priceMap.get(row.product_code)?.bau ?? 0;
      total += gmsFromBauAndSo(bau, Number(row.prior_fy_so_units ?? 0));
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
  if (!uploadId || codes.length === 0) return 0;
  const skuSo = await loadSkuMonthlySo(marketplace, codes, uploadId);
  const monthly = rollupGmsFromSkuSo(skuSo, priceMap);
  const fyMonths = priorFyMonthYms(snapshotDate);
  return fyMonths.reduce((sum, ym) => sum + (monthly.get(ym) ?? 0), 0);
}

/** Flipkart **Apr** column → GMS when Event SO month rows were not ingested into daily_sales. */
async function loadPreviousMonthGmsForChannel(
  channel: GmsCategoryChannelContext,
): Promise<number> {
  const { marketplace, codes, snapshotDate, uploadId, priceMap } = channel;
  if (!snapshotDate || !uploadId) return 0;
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
      const bau = priceMap.get(row.product_code)?.bau ?? 0;
      total += gmsFromBauAndSo(bau, Number(row.apr_so_units ?? 0));
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
  if (subCategory === "all") {
    const tracked =
      catalogWorkspace === CATALOG_WORKSPACE_RITHIKA
        ? await listDistinctRithikaSheetSubCategories(catalogWorkspace)
        : catalogWorkspace === CATALOG_WORKSPACE_HOME_AUDIO
          ? await listDistinctRishabhSheetSubCategories(catalogWorkspace)
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
  const uploadCtx = await getLatestUploadContextByMarketplace(catalogWorkspace);
  const channelsActive = {
    amazon: uploadCtx.amazon != null,
    flipkart: uploadCtx.flipkart != null,
  };

  const [codesAmazon, codesFlipkart] = await Promise.all([
    channelsActive.amazon
      ? getProductCodesForCategoryHistoryRollup("amazon", subCategory, catalogWorkspace)
      : Promise.resolve([] as string[]),
    channelsActive.flipkart
      ? getProductCodesForCategoryHistoryRollup("flipkart", subCategory, catalogWorkspace)
      : Promise.resolve([] as string[]),
  ]);

  return loadCategoryGmsMonthlySelloutFromSkuCodes(
    codesAmazon,
    codesFlipkart,
    catalogWorkspace,
    uploadCtx,
    channelsActive,
  );
}

/** GMS category roll-up for sheet Category + Sub category (same selection as analysis / dashboards). */
export async function loadCategoryGmsMonthlySelloutBySheetSelection(
  category: string,
  subCategory: string,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
  dataScope: DataScope = getActiveDataScope(),
): Promise<CategorySheetMonthlySellout> {
  const cat = category.trim() || ANALYSIS_CATEGORY_ALL;
  const sub = subCategory.trim() || ANALYSIS_SUB_CATEGORY_ALL;

  if (isAnalysisCategoryAll(cat) && isAnalysisSubCategoryAll(sub)) {
    return loadCategoryGmsMonthlySellout("all", catalogWorkspace);
  }

  const uploadCtx = await getLatestUploadContextByMarketplace(
    dataScope === "dawg" ? "dawg" : catalogWorkspace,
  );
  const channelsActive = {
    amazon: uploadCtx.amazon != null,
    flipkart: uploadCtx.flipkart != null,
  };

  const [codesAmazon, codesFlipkart] = await Promise.all([
    channelsActive.amazon
      ? getProductCodesForCategoryAnalysis(
          "amazon",
          cat,
          sub,
          catalogWorkspace,
          dataScope,
        )
      : Promise.resolve([] as string[]),
    channelsActive.flipkart
      ? getProductCodesForCategoryAnalysis(
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
  );
}

async function loadCategoryGmsMonthlySelloutFromSkuCodes(
  codesAmazon: string[],
  codesFlipkart: string[],
  _catalogWorkspace: CatalogWorkspace,
  uploadCtx: Awaited<ReturnType<typeof getLatestUploadContextByMarketplace>>,
  channelsActive: { amazon: boolean; flipkart: boolean },
): Promise<CategorySheetMonthlySellout> {
  const [bauAmazon, bauFlipkart, soAmazon, soFlipkart] = await Promise.all([
    channelsActive.amazon ? getBauMapsForCodes("amazon", codesAmazon) : Promise.resolve(new Map()),
    channelsActive.flipkart ? getBauMapsForCodes("flipkart", codesFlipkart) : Promise.resolve(new Map()),
    channelsActive.amazon
      ? loadSkuMonthlySo("amazon", codesAmazon, uploadCtx.amazon?.id ?? null)
      : Promise.resolve(new Map()),
    channelsActive.flipkart
      ? loadSkuMonthlySo("flipkart", codesFlipkart, uploadCtx.flipkart?.id ?? null)
      : Promise.resolve(new Map()),
  ]);
  const channelContext: { amazon: GmsCategoryChannelContext; flipkart: GmsCategoryChannelContext } = {
    amazon: {
      marketplace: "amazon",
      codes: codesAmazon,
      priceMap: bauAmazon,
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

  const monthlyAmazon = rollupGmsFromSkuSo(soAmazon, bauAmazon);
  const monthlyFlipkart = rollupGmsFromSkuSo(soFlipkart, bauFlipkart);
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
    const [prevAmazonGms, prevFlipkartGms] = await Promise.all([
      channelsActive.amazon
        ? loadPreviousMonthGmsForChannel(channelContext.amazon)
        : Promise.resolve(0),
      channelsActive.flipkart
        ? loadPreviousMonthGmsForChannel(channelContext.flipkart)
        : Promise.resolve(0),
    ]);
    applyPreviousMonthGmsWhenMissing(
      monthlyAmazon,
      monthlyFlipkart,
      monthlyCombined,
      channelsActive,
      prevYm,
      prevAmazonGms,
      prevFlipkartGms,
    );

    const [priorFyAmazonGms, priorFyFlipkartGms] = await Promise.all([
      channelsActive.amazon
        ? loadPriorFySoGmsForChannel(channelContext.amazon)
        : Promise.resolve(0),
      channelsActive.flipkart
        ? loadPriorFySoGmsForChannel(channelContext.flipkart)
        : Promise.resolve(0),
    ]);

    const withPriorFy = applyPriorFySoToMonthlyMaps(
      {
        skuCountAmazon: codesAmazon.length,
        skuCountFlipkart: codesFlipkart.length,
        skuCount: codesAmazon.length + codesFlipkart.length,
        channelsActive,
        monthlyAmazon,
        monthlyFlipkart,
        monthlyCombined,
        ongoingMonthMtd: null,
        previousMonthSo: null,
      },
      reportSnapshot,
      { amazon: priorFyAmazonGms, flipkart: priorFyFlipkartGms },
    );
    for (const [ym, v] of withPriorFy.monthlyAmazon) monthlyAmazon.set(ym, v);
    for (const [ym, v] of withPriorFy.monthlyFlipkart) monthlyFlipkart.set(ym, v);
    for (const [ym, v] of withPriorFy.monthlyCombined) monthlyCombined.set(ym, v);
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
      const [amazon, flipkart] = await Promise.all([
        channelsActive.amazon ? loadGmsMtdForChannel(channelContext.amazon) : Promise.resolve(0),
        channelsActive.flipkart ? loadGmsMtdForChannel(channelContext.flipkart) : Promise.resolve(0),
      ]);
      ongoingMonthMtd = { monthYm: nowYm, amazon, flipkart };
    }
  }

  const base: CategorySheetMonthlySellout = {
    skuCountAmazon: codesAmazon.length,
    skuCountFlipkart: codesFlipkart.length,
    skuCount: codesAmazon.length + codesFlipkart.length,
    channelsActive,
    monthlyAmazon,
    monthlyFlipkart,
    monthlyCombined,
    ongoingMonthMtd,
    previousMonthSo: null,
    reportSnapshotDate,
  };
  return applyOngoingMtdToMaps(base);
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
    const tracked =
      catalogWorkspace === CATALOG_WORKSPACE_RITHIKA
        ? await listDistinctRithikaSheetSubCategories(catalogWorkspace)
        : catalogWorkspace === CATALOG_WORKSPACE_HOME_AUDIO
          ? await listDistinctRishabhSheetSubCategories(catalogWorkspace)
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

  if (isAnalysisCategoryAll(cat) && isAnalysisSubCategoryAll(sub)) {
    return getGmsProductRows(marketplace, "all", catalogWorkspace);
  }

  const codes = await getProductCodesForCategoryAnalysis(
    marketplace,
    cat,
    sub,
    catalogWorkspace,
    dataScope,
  );
  return getGmsProductRowsForCodes(marketplace, codes, catalogWorkspace);
}

async function getGmsProductRowsForOne(
  marketplace: Marketplace,
  subCategory: SubCategory | string,
  catalogWorkspace: CatalogWorkspace,
): Promise<GmsProductRow[]> {
  const codes = await getProductCodesForCategoryHistoryRollup(
    marketplace,
    subCategory,
    catalogWorkspace,
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
    return productMatchesCategoryRollup(subCategoryFilter as SubCategory, p);
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
  const frozenMtdMap = await loadFrozenMtdGmsByCodes(
    marketplace,
    ctx.snapshotDate,
    ctx.id,
    codes,
    bauMap,
  );
  for (const code of codes) mtdMap.set(code, frozenMtdMap.get(code) ?? 0);

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
  const bau = bauMap.get(productCode)?.bau ?? 0;

  const soByMonth = ctx
    ? (await loadSkuMonthlySo(marketplace, [productCode], ctx.id)).get(productCode) ?? new Map()
    : new Map<string, number>();

  const nowYm = new Date().toISOString().slice(0, 7);
  let mtdGms = 0;
  if (ctx) {
    const frozen = await loadFrozenMtdGmsByCodes(
      marketplace,
      ctx.snapshotDate,
      ctx.id,
      [productCode],
      bauMap,
    );
    mtdGms = frozen.get(productCode) ?? 0;
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
  }

  const months: ProductGmsMonthPoint[] = [...soByMonth.entries()]
    .map(([month_ym, so_units]) => ({
      month_ym,
      so_units,
      gms_inr: gmsFromBauAndSo(bau, so_units),
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
  const upserts = rows.map((row) => ({
    marketplace: "amazon" as const,
    product_code: row.asin.trim(),
    as_of_date: snapshotDate,
    upload_id: uploadId,
    so_units_mtd: 0,
    bau_price_used: 0,
    event_price_used: 0,
    price_source: "official_may_mtd" as const,
    gms_inr_mtd: Math.max(0, Number(row.may_mtd_gms ?? 0)),
  }));
  const { error } = await supabase.from("gms_daily_snapshot").upsert(upserts, {
    onConflict: "marketplace,product_code,as_of_date",
  });
  if (error) {
    if (isMissingGmsDailySnapshotSchemaError(error)) {
      throw new Error(
        "Table gms_daily_snapshot is missing. Run supabase/run-gms-tracker.sql in Supabase SQL Editor, then retry.",
      );
    }
    throw new Error(getErrorMessage(error));
  }
  return upserts.length;
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
