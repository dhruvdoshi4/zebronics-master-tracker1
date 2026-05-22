import {
  chunkArray,
  getFlipkartEolFsns,
  getLatestUploadContextByMarketplace,
  getProductCodesForCategoryHistoryRollup,
  pruneOlderUploads,
  productMatchesCategoryRollup,
} from "./data";
import { isDawgDataScope } from "./data-scope";
import type { DataScope } from "./types";
import { isDawgSheetCategory, productMatchesDawgScope } from "./dawg-scope";
import { invalidateProductIdMapCache } from "./product-id-map";
import type { ParsedHoStockPayload } from "./parsers-ho-stock";
import { splitFsnCell } from "./parsers-ho-stock";
import { fetchAllHoStockSnapshotRows } from "./ho-stock-snapshot-query";
import {
  catalogProductName,
  displayModelName,
  looksLikeProductSku,
} from "./product-display";
import { computeNetworkDocDays, computeQcomNetworkDocDays, type ChannelStockDemand } from "./metrics";
import {
  loadQcomChannelMetricsContext,
  resolveHoStockCatalogKey,
} from "./qcom-network-doc";
import { supabase } from "./supabase";
import { normalizeKey } from "./utils";
import {
  TRACKED_SUB_CATEGORIES,
  QCOM_HO_STOCK_CATALOG_MARKETPLACE,
  type ComputedMetric,
  type Marketplace,
  type ProductMaster,
  type SubCategory,
  type SubCategoryFilter,
} from "./types";
export type HoStockCategoryRow = {
  row_key: string;
  model_name: string;
  asin: string;
  fsn: string;
  listing_label: string;
  ho_units: number;
  gurgaon_units: number;
  total_units: number;
  amazon_inventory_units: number;
  flipkart_inventory_units: number;
  amazon_drr_units: number;
  flipkart_drr_units: number;
  qcom_inventory_units: number;
  qcom_drr_units: number;
  /** True when HO row ASIN/FSN maps to channel sellout catalogue. */
  qcom_channel_linked: boolean;
  doc_days: number | null;
  matched_marketplace: Marketplace | "both" | null;
};

export type HoStockCategorySummary = {
  snapshotDate: string | null;
  uploadId: string | null;
  fileName: string | null;
  rowCount: number;
  eolExcludedCount: number;
  hoTotal: number;
  gurgaonTotal: number;
  stockTotal: number;
  rows: HoStockCategoryRow[];
};

export type HoStockQcomCategoryOption = {
  category: string;
  subCategories: string[];
};

type HoStockDbRow = {
  row_key: string;
  asin: string;
  fsn: string;
  erp_product_id: string;
  model_name: string;
  ho_units: number;
  gurgaon_units: number;
  total_units: number;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Unknown error";
}

function isMissingSchemaError(error: unknown, token: string): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes(token.toLowerCase()) && msg.includes("does not exist");
}

export async function getLatestHoStockUpload(
  dataScope: DataScope = "default",
): Promise<{
  id: string;
  snapshot_date: string | null;
  file_name: string;
} | null> {
  const { data, error } = await supabase
    .from("uploads")
    .select("id, snapshot_date, file_name")
    .eq("upload_kind", "ho_stock")
    .eq("data_scope", dataScope)
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error, "upload_kind") || isMissingSchemaError(error, "ho_stock_snapshot")) {
      return null;
    }
    throw new Error(getErrorMessage(error));
  }
  return data as { id: string; snapshot_date: string | null; file_name: string } | null;
}

export type HoStockSearchRow = {
  row_key: string;
  erp_product_id: string;
  model_name: string;
  asin: string;
  fsn: string;
  ho_units: number;
  gurgaon_units: number;
  total_units: number;
  amazon_inventory_units: number;
  flipkart_inventory_units: number;
  amazon_drr_units: number;
  flipkart_drr_units: number;
  qcom_inventory_units: number;
  qcom_drr_units: number;
  qcom_channel_linked: boolean;
  doc_days: number | null;
};

type ChannelMetricSlice = ChannelStockDemand;

function metricsRowsToMap(rows: ComputedMetric[]): Map<string, ChannelMetricSlice> {
  const map = new Map<string, ChannelMetricSlice>();
  for (const row of rows) {
    const code = String(row.product_code ?? "")
      .trim()
      .toUpperCase();
    if (!code || map.has(code)) continue;
    map.set(code, {
      inventory_units: Number(row.inventory_units ?? 0),
      drr_units: Number(row.drr_units ?? 0),
    });
  }
  return map;
}

/** Latest completed sellout upload per channel; falls back to newest as-of date. */
async function loadLatestChannelMetricMaps(
  dataScope: DataScope = "default",
): Promise<{
  amazon: Map<string, ChannelMetricSlice>;
  flipkart: Map<string, ChannelMetricSlice>;
}> {
  const uploadCtx = await getLatestUploadContextByMarketplace(dataScope);

  async function loadMap(
    marketplace: "amazon" | "flipkart",
  ): Promise<Map<string, ChannelMetricSlice>> {
    const ctx = uploadCtx[marketplace];
    const select = "product_code, inventory_units, drr_units, as_of_date, upload_id";

    if (ctx?.id) {
      const { data, error } = await supabase
        .from("computed_metrics")
        .select(select)
        .eq("marketplace", marketplace)
        .eq("upload_id", ctx.id);
      if (error) throw new Error(getErrorMessage(error));
      const fromUpload = metricsRowsToMap((data ?? []) as ComputedMetric[]);
      if (fromUpload.size > 0) return fromUpload;
    }

    const { data, error } = await supabase
      .from("computed_metrics")
      .select(select)
      .eq("marketplace", marketplace)
      .order("as_of_date", { ascending: false });
    if (error) throw new Error(getErrorMessage(error));
    return metricsRowsToMap((data ?? []) as ComputedMetric[]);
  }

  const [amazon, flipkart] = await Promise.all([
    loadMap("amazon"),
    loadMap("flipkart"),
  ]);
  return { amazon, flipkart };
}

function flipkartChannelTotals(
  fsnCell: string,
  flipkart: Map<string, ChannelMetricSlice>,
): ChannelMetricSlice {
  let inventory_units = 0;
  let drr_units = 0;
  for (const code of splitFsnCell(fsnCell)) {
    const metric = flipkart.get(code);
    if (!metric) continue;
    inventory_units += metric.inventory_units;
    drr_units += metric.drr_units;
  }
  return { inventory_units, drr_units };
}

function enrichHoStockRow<
  T extends {
    asin: string;
    fsn: string;
    ho_units: number;
    gurgaon_units: number;
  },
>(
  row: T,
  maps: { amazon: Map<string, ChannelMetricSlice>; flipkart: Map<string, ChannelMetricSlice> },
): T & {
  amazon_inventory_units: number;
  flipkart_inventory_units: number;
  amazon_drr_units: number;
  flipkart_drr_units: number;
  qcom_inventory_units: number;
  qcom_drr_units: number;
  qcom_channel_linked: boolean;
  doc_days: number | null;
} {
  const asin = String(row.asin ?? "").trim().toUpperCase();
  const hasAmazon = asin.length > 0;
  const hasFlipkart = splitFsnCell(row.fsn).length > 0;
  const amazonSlice = hasAmazon
    ? maps.amazon.get(asin) ?? { inventory_units: 0, drr_units: 0 }
    : null;
  const flipkartSlice = hasFlipkart ? flipkartChannelTotals(row.fsn, maps.flipkart) : null;
  const doc_days = computeNetworkDocDays({
    ho_units: row.ho_units,
    gurgaon_units: row.gurgaon_units,
    amazon: amazonSlice,
    flipkart: flipkartSlice,
  });
  return {
    ...row,
    amazon_inventory_units: amazonSlice?.inventory_units ?? 0,
    flipkart_inventory_units: flipkartSlice?.inventory_units ?? 0,
    amazon_drr_units: amazonSlice?.drr_units ?? 0,
    flipkart_drr_units: flipkartSlice?.drr_units ?? 0,
    qcom_inventory_units: 0,
    qcom_drr_units: 0,
    qcom_channel_linked: false,
    doc_days,
  };
}

function enrichHoStockRowQcom<
  T extends {
    asin: string;
    fsn: string;
    model_name: string;
    ho_units: number;
    gurgaon_units: number;
  },
>(
  row: T,
  ctx: Awaited<ReturnType<typeof loadQcomChannelMetricsContext>>,
): T & {
  amazon_inventory_units: number;
  flipkart_inventory_units: number;
  amazon_drr_units: number;
  flipkart_drr_units: number;
  qcom_inventory_units: number;
  qcom_drr_units: number;
  qcom_channel_linked: boolean;
  doc_days: number | null;
} {
  const catalogKey = resolveHoStockCatalogKey(row, ctx.resolver);
  const channels = catalogKey
    ? (ctx.byAsin.get(catalogKey) ?? { inventory_units: 0, drr_units: 0 })
    : { inventory_units: 0, drr_units: 0 };
  const doc_days = computeQcomNetworkDocDays({
    ho_units: row.ho_units,
    gurgaon_units: row.gurgaon_units,
    channels,
  });
  return {
    ...row,
    amazon_inventory_units: 0,
    flipkart_inventory_units: 0,
    amazon_drr_units: 0,
    flipkart_drr_units: 0,
    qcom_inventory_units: channels.inventory_units,
    qcom_drr_units: channels.drr_units,
    qcom_channel_linked: catalogKey !== null,
    doc_days,
  };
}

function mapHoStockSearchRowBase(raw: HoStockDbRow) {
  const asin = String(raw.asin ?? "").trim().toUpperCase();
  const fsn = String(raw.fsn ?? "").trim();
  const erpProductId = String(raw.erp_product_id ?? "").trim();
  const sheetModelName = String(raw.model_name ?? "").trim();

  return {
    row_key: String(raw.row_key ?? "").trim() || `${asin}|${fsn}|${erpProductId}`,
    erp_product_id: erpProductId,
    model_name: resolveHoStockModelName({
      asin,
      fsn,
      erpProductId,
      sheetModelName,
    }),
    asin,
    fsn,
    ho_units: Number(raw.ho_units ?? 0),
    gurgaon_units: Number(raw.gurgaon_units ?? 0),
    total_units: Number(raw.total_units ?? 0),
  };
}

function mapHoStockSearchRowFromDb(
  raw: HoStockDbRow,
  opts: {
    qcomMetricsCtx: Awaited<ReturnType<typeof loadQcomChannelMetricsContext>> | null;
    metricMaps: {
      amazon: Map<string, ChannelMetricSlice>;
      flipkart: Map<string, ChannelMetricSlice>;
    } | null;
  },
): HoStockSearchRow {
  const base = mapHoStockSearchRowBase(raw);
  if (opts.qcomMetricsCtx) return enrichHoStockRowQcom(base, opts.qcomMetricsCtx);
  return enrichHoStockRow(base, opts.metricMaps!);
}

/** Search all rows in the latest HO stock upload by model, ASIN, FSN, or Product ID. */
export async function searchHoStockProducts(
  query: string,
  limit = 25,
  options?: { qcomNetworkDoc?: boolean; dataScope?: DataScope },
): Promise<HoStockSearchRow[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const dataScope = options?.dataScope ?? "default";
  const upload = await getLatestHoStockUpload(dataScope);
  if (!upload) return [];

  const useQcom = options?.qcomNetworkDoc === true;
  const [metricMaps, qcomMetricsCtx] = await Promise.all([
    useQcom ? null : loadLatestChannelMetricMaps(dataScope),
    useQcom ? loadQcomChannelMetricsContext() : null,
  ]);

  const select =
    "erp_product_id, model_name, asin, fsn, ho_units, gurgaon_units, total_units";
  const seen = new Set<string>();
  const results: HoStockSearchRow[] = [];

  const push = (row: HoStockSearchRow) => {
    const key =
      row.erp_product_id ||
      `${row.asin}|${row.fsn}|${row.model_name}`.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push(row);
  };

  if (/^\d+$/.test(trimmed)) {
    const { data, error } = await supabase
      .from("ho_stock_snapshot")
      .select(select)
      .eq("upload_id", upload.id)
      .eq("erp_product_id", trimmed)
      .limit(5);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of (data ?? []) as HoStockDbRow[]) {
      push(mapHoStockSearchRowFromDb(row, { qcomMetricsCtx, metricMaps }));
    }
  }

  if (/^B0[A-Z0-9]{8}$/i.test(trimmed)) {
    const { data, error } = await supabase
      .from("ho_stock_snapshot")
      .select(select)
      .eq("upload_id", upload.id)
      .eq("asin", trimmed.toUpperCase())
      .limit(5);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of (data ?? []) as HoStockDbRow[]) {
      push(mapHoStockSearchRowFromDb(row, { qcomMetricsCtx, metricMaps }));
    }
  }

  if (looksLikeFlipkartFsn(trimmed)) {
    const { data, error } = await supabase
      .from("ho_stock_snapshot")
      .select(select)
      .eq("upload_id", upload.id)
      .ilike("fsn", `%${trimmed.toUpperCase()}%`)
      .limit(8);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of (data ?? []) as HoStockDbRow[]) {
      const fsns = splitFsnCell(row.fsn);
      if (fsns.some((f) => f.includes(trimmed.toUpperCase()))) {
        push(mapHoStockSearchRowFromDb(row, { qcomMetricsCtx, metricMaps }));
      }
    }
  }

  const safe = trimmed.replace(/[%_,]/g, "");
  if (safe.length >= 2 && results.length < limit) {
    const { data, error } = await supabase
      .from("ho_stock_snapshot")
      .select(select)
      .eq("upload_id", upload.id)
      .or(
        `model_name.ilike.%${safe}%,asin.ilike.%${safe}%,fsn.ilike.%${safe}%,erp_product_id.ilike.%${safe}%`,
      )
      .order("model_name", { ascending: true })
      .limit(limit);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of (data ?? []) as HoStockDbRow[]) {
      push(mapHoStockSearchRowFromDb(row, { qcomMetricsCtx, metricMaps }));
      if (results.length >= limit) break;
    }
  }

  return results.slice(0, limit);
}

function looksLikeFlipkartFsn(value: string): boolean {
  const v = value.trim();
  return /^[A-Z0-9]{12,20}$/i.test(v) && !/^B0/i.test(v);
}

/** Catalogue model label — never show raw FSN/ASIN from the HO stock sheet or master. */
function resolveHoStockModelName({
  asin,
  fsn,
  erpProductId,
  sheetModelName,
  nameByAmazonAsin,
  nameByFlipkartFsn,
}: {
  asin: string;
  fsn: string;
  erpProductId: string;
  sheetModelName: string;
  nameByAmazonAsin?: Map<string, string>;
  nameByFlipkartFsn?: Map<string, string>;
}): string {
  const normalizedAsin = asin.trim().toUpperCase();
  const fsnCodes = splitFsnCell(fsn);

  if (normalizedAsin && nameByAmazonAsin) {
    const fromMaster = displayModelName(nameByAmazonAsin.get(normalizedAsin), normalizedAsin);
    if (fromMaster !== "—") return fromMaster;
  }
  if (normalizedAsin) {
    const fromAsin = displayModelName(sheetModelName, normalizedAsin);
    if (fromAsin !== "—") return fromAsin;
  }

  for (const code of fsnCodes) {
    if (nameByFlipkartFsn) {
      const fromMaster = displayModelName(nameByFlipkartFsn.get(code), code);
      if (fromMaster !== "—") return fromMaster;
    }
    const fromFsn = displayModelName(sheetModelName, code);
    if (fromFsn !== "—") return fromFsn;
  }

  const erpId = erpProductId.trim();
  if (erpId) {
    const fromErp = displayModelName(sheetModelName, erpId);
    if (fromErp !== "—") return fromErp;
  }

  const sheetOnly = catalogProductName(sheetModelName);
  if (sheetOnly) return sheetOnly;

  return "—";
}

type CategoryListingSets = {
  amazonAsins: Set<string>;
  flipkartFsns: Set<string>;
  nameByAmazonAsin: Map<string, string>;
  nameByFlipkartFsn: Map<string, string>;
  normalizedListingNames: Set<string>;
};

/** True only when an FSN on the row was Remarks = EOL on the Flipkart sellout master. */
function hoStockRowHasExplicitFlipkartEol(
  fsnCell: string,
  explicitEolFsns: Set<string>,
): boolean {
  if (explicitEolFsns.size === 0) return false;
  const fsns = splitFsnCell(fsnCell);
  if (fsns.length === 0) return false;
  return fsns.some((fsn) => explicitEolFsns.has(fsn));
}

function inferListingMarketplace(
  asin: string,
  fsnCell: string,
): Marketplace | "both" | null {
  const fsns = splitFsnCell(fsnCell);
  if (asin && fsns.length > 0) return "both";
  if (asin) return "amazon";
  if (fsns.length > 0) return "flipkart";
  return null;
}

async function loadCategoryListingSetsForSubCategory(
  subCategory: SubCategory,
): Promise<CategoryListingSets> {
  const [amazonCodes, flipkartCodes] = await Promise.all([
    getProductCodesForCategoryHistoryRollup("amazon", subCategory),
    getProductCodesForCategoryHistoryRollup("flipkart", subCategory),
  ]);

  const amazonAsins = new Set(amazonCodes.map((c) => c.trim().toUpperCase()));
  const flipkartFsns = new Set(flipkartCodes.map((c) => c.trim().toUpperCase()));

  const nameByAmazonAsin = new Map<string, string>();
  const nameByFlipkartFsn = new Map<string, string>();
  const normalizedListingNames = new Set<string>();

  for (const marketplace of ["amazon", "flipkart"] as const) {
    const codes = marketplace === "amazon" ? amazonCodes : flipkartCodes;
    for (const chunk of chunkArray(codes, 150)) {
      if (chunk.length === 0) continue;
      const { data, error } = await supabase
        .from("product_master")
        .select("product_code, product_name, category, sub_category")
        .eq("marketplace", marketplace)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of (data ?? []) as Pick<
        ProductMaster,
        "product_code" | "product_name" | "category" | "sub_category"
      >[]) {
        if (!productMatchesCategoryRollup(subCategory, row)) continue;
        const code = String(row.product_code).trim().toUpperCase();
        const name = displayModelName(row.product_name, code);
        if (name === "—") continue;
        if (marketplace === "amazon") nameByAmazonAsin.set(code, name);
        else nameByFlipkartFsn.set(code, name);
        const normalizedName = normalizeKey(name);
        if (normalizedName) normalizedListingNames.add(normalizedName);
      }
    }
  }

  return { amazonAsins, flipkartFsns, nameByAmazonAsin, nameByFlipkartFsn, normalizedListingNames };
}

function mergeCategoryListingSets(sets: CategoryListingSets[]): CategoryListingSets {
  const amazonAsins = new Set<string>();
  const flipkartFsns = new Set<string>();
  const nameByAmazonAsin = new Map<string, string>();
  const nameByFlipkartFsn = new Map<string, string>();
  const normalizedListingNames = new Set<string>();

  for (const part of sets) {
    for (const code of part.amazonAsins) amazonAsins.add(code);
    for (const code of part.flipkartFsns) flipkartFsns.add(code);
    for (const [code, name] of part.nameByAmazonAsin) nameByAmazonAsin.set(code, name);
    for (const [code, name] of part.nameByFlipkartFsn) nameByFlipkartFsn.set(code, name);
    for (const normalized of part.normalizedListingNames) normalizedListingNames.add(normalized);
  }

  return { amazonAsins, flipkartFsns, nameByAmazonAsin, nameByFlipkartFsn, normalizedListingNames };
}

async function loadCategoryListingSets(
  subCategory: SubCategoryFilter,
): Promise<CategoryListingSets> {
  if (subCategory === "all") {
    const parts = await Promise.all(
      TRACKED_SUB_CATEGORIES.map((sc) => loadCategoryListingSetsForSubCategory(sc)),
    );
    return mergeCategoryListingSets(parts);
  }
  return loadCategoryListingSetsForSubCategory(subCategory);
}

function normalizeCompare(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

type QcomCategoryListingSets = {
  amazonAsins: Set<string>;
  flipkartFsns: Set<string>;
  nameByAmazonAsin: Map<string, string>;
  nameByFlipkartFsn: Map<string, string>;
};

function isAmazonAsinCode(code: string): boolean {
  return /^B0[A-Z0-9]{8,}$/i.test(code.trim());
}

async function loadQcomCategoryListingSets(
  category: string,
  subCategory: string | "all",
): Promise<QcomCategoryListingSets> {
  const normalizedCategory = normalizeCompare(category);
  const includeAllCategories =
    normalizedCategory === "all" || normalizedCategory === "";
  const normalizedSub = normalizeCompare(subCategory === "all" ? "" : subCategory);
  const sets: QcomCategoryListingSets = {
    amazonAsins: new Set<string>(),
    flipkartFsns: new Set<string>(),
    nameByAmazonAsin: new Map<string, string>(),
    nameByFlipkartFsn: new Map<string, string>(),
  };

  const { data, error } = await supabase
    .from("product_master")
    .select("product_code, product_name, category, sub_category")
    .eq("marketplace", QCOM_HO_STOCK_CATALOG_MARKETPLACE);
  if (error) throw new Error(getErrorMessage(error));

  for (const row of (data ?? []) as Pick<
    ProductMaster,
    "product_code" | "product_name" | "category" | "sub_category"
  >[]) {
    if (!includeAllCategories && normalizeCompare(row.category) !== normalizedCategory) {
      continue;
    }
    if (normalizedSub && normalizeCompare(row.sub_category) !== normalizedSub) continue;
    const code = String(row.product_code ?? "").trim().toUpperCase();
    const displayName = displayModelName(row.product_name, code);
    const labelForRow =
      displayName !== "—" ? displayName : String(row.product_name ?? "").trim() || code;

    if (isAmazonAsinCode(code)) {
      sets.amazonAsins.add(code);
      if (labelForRow) sets.nameByAmazonAsin.set(code, labelForRow);
    } else if (looksLikeProductSku(code)) {
      sets.flipkartFsns.add(code);
      if (labelForRow) sets.nameByFlipkartFsn.set(code, labelForRow);
    }
  }

  return sets;
}

/** Qcom HO Stock: ASIN match first; if the row has no ASIN, match FSN; rows with neither are skipped. */
function rowMatchesQcomCategory(
  row: HoStockDbRow,
  sets: QcomCategoryListingSets,
): { match: boolean; marketplace: Marketplace | "both" | null } {
  const asin = String(row.asin ?? "").trim().toUpperCase();
  const fsns = splitFsnCell(row.fsn);

  if (!asin && fsns.length === 0) {
    return { match: false, marketplace: null };
  }

  if (asin) {
    if (sets.amazonAsins.has(asin)) {
      return { match: true, marketplace: inferListingMarketplace(asin, row.fsn) };
    }
    return { match: false, marketplace: null };
  }

  const fsnHit = fsns.find((fsn) => sets.flipkartFsns.has(fsn));
  if (fsnHit) {
    return { match: true, marketplace: "flipkart" };
  }
  return { match: false, marketplace: null };
}

function rowMatchesCategory(
  row: HoStockDbRow,
  amazonAsins: Set<string>,
  flipkartFsns: Set<string>,
  normalizedListingNames: Set<string>,
): { match: boolean; marketplace: Marketplace | "both" | null } {
  const asin = String(row.asin ?? "").trim().toUpperCase();
  const fsns = splitFsnCell(row.fsn);
  const asinHit = asin.length > 0 && amazonAsins.has(asin);
  const fsnHit = fsns.some((f) => flipkartFsns.has(f));
  if (asinHit && fsnHit) return { match: true, marketplace: "both" };
  if (asinHit) return { match: true, marketplace: "amazon" };
  if (fsnHit) return { match: true, marketplace: "flipkart" };
  const normalizedModel = normalizeKey(String(row.model_name ?? ""));
  if (normalizedModel) {
    for (const listingName of normalizedListingNames) {
      if (
        normalizedModel === listingName ||
        normalizedModel.includes(listingName) ||
        listingName.includes(normalizedModel)
      ) {
        return { match: true, marketplace: inferListingMarketplace(asin, row.fsn) };
      }
    }
  }
  return { match: false, marketplace: null };
}

function listingLabel(asin: string, fsn: string): string {
  const parts: string[] = [];
  if (asin) parts.push(`ASIN ${asin}`);
  if (fsn) parts.push(`FSN ${fsn}`);
  return parts.join(" · ") || "—";
}

async function loadDawgCategoryListingSets(
  category: string,
  subCategory: string | "all",
): Promise<CategoryListingSets> {
  const uploadCtx = await getLatestUploadContextByMarketplace("dawg");
  const amazonAsins = new Set<string>();
  const flipkartFsns = new Set<string>();
  const nameByAmazonAsin = new Map<string, string>();
  const nameByFlipkartFsn = new Map<string, string>();
  const normalizedListingNames = new Set<string>();

  const normalizedCategory = category.trim().toLowerCase();
  const includeAllCategories =
    normalizedCategory === "all" || normalizedCategory === "";
  const normalizedSub = subCategory === "all" ? "" : subCategory.trim().toLowerCase();

  for (const marketplace of ["amazon", "flipkart"] as const) {
    const upload = uploadCtx[marketplace];
    if (!upload) continue;

    const { data, error } = await supabase
      .from("computed_metrics")
      .select("product_code")
      .eq("marketplace", marketplace)
      .eq("upload_id", upload.id);
    if (error) throw new Error(getErrorMessage(error));
    const codes = (data ?? []).map((r) =>
      String((r as { product_code: string }).product_code).trim().toUpperCase(),
    );
    if (codes.length === 0) continue;

    for (const chunk of chunkArray(codes, 150)) {
      const { data: masterRows, error: masterErr } = await supabase
        .from("product_master")
        .select("product_code, product_name, category, sub_category")
        .eq("marketplace", marketplace)
        .in("product_code", chunk);
      if (masterErr) throw new Error(getErrorMessage(masterErr));
      for (const row of (masterRows ?? []) as Pick<
        ProductMaster,
        "product_code" | "product_name" | "category" | "sub_category"
      >[]) {
        if (!productMatchesDawgScope(row)) continue;
        const cat = String(row.category ?? "").trim();
        if (!includeAllCategories && cat.toLowerCase() !== normalizedCategory) continue;
        const sub = String(row.sub_category ?? "").trim();
        if (normalizedSub && sub.toLowerCase() !== normalizedSub) continue;
        const code = String(row.product_code).trim().toUpperCase();
        const name = displayModelName(row.product_name, code);
        if (name === "—") continue;
        if (marketplace === "amazon") {
          amazonAsins.add(code);
          nameByAmazonAsin.set(code, name);
        } else {
          flipkartFsns.add(code);
          nameByFlipkartFsn.set(code, name);
        }
        const normalizedName = normalizeKey(name);
        if (normalizedName) normalizedListingNames.add(normalizedName);
      }
    }
  }

  return { amazonAsins, flipkartFsns, nameByAmazonAsin, nameByFlipkartFsn, normalizedListingNames };
}

export async function listDawgHoStockCategories(): Promise<HoStockQcomCategoryOption[]> {
  const uploadCtx = await getLatestUploadContextByMarketplace("dawg");
  const byCategory = new Map<string, Set<string>>();

  for (const marketplace of ["amazon", "flipkart"] as const) {
    const upload = uploadCtx[marketplace];
    if (!upload) continue;
    const { data, error } = await supabase
      .from("product_master")
      .select("product_code, category, sub_category")
      .eq("marketplace", marketplace);
    if (error) throw new Error(getErrorMessage(error));

    const { data: metricRows, error: metricErr } = await supabase
      .from("computed_metrics")
      .select("product_code")
      .eq("marketplace", marketplace)
      .eq("upload_id", upload.id);
    if (metricErr) throw new Error(getErrorMessage(metricErr));
    const activeCodes = new Set(
      (metricRows ?? []).map((r) =>
        String((r as { product_code: string }).product_code).trim().toUpperCase(),
      ),
    );

    for (const row of (data ?? []) as Pick<ProductMaster, "product_code" | "category" | "sub_category">[]) {
      const code = String(row.product_code ?? "").trim().toUpperCase();
      if (!activeCodes.has(code) || !productMatchesDawgScope(row)) continue;
      const category = String(row.category ?? "").trim();
      if (!category || !isDawgSheetCategory(category)) continue;
      const sub = String(row.sub_category ?? "").trim();
      if (!byCategory.has(category)) byCategory.set(category, new Set<string>());
      if (sub) byCategory.get(category)!.add(sub);
    }
  }

  return [...byCategory.entries()]
    .map(([category, subSet]) => ({
      category,
      subCategories: [...subSet].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

export async function loadHoStockDawgCategoryReport(
  category: string,
  subCategory: string | "all",
): Promise<HoStockCategorySummary> {
  const upload = await getLatestHoStockUpload("dawg");
  if (!upload) {
    return {
      snapshotDate: null,
      uploadId: null,
      fileName: null,
      rowCount: 0,
      eolExcludedCount: 0,
      hoTotal: 0,
      gurgaonTotal: 0,
      stockTotal: 0,
      rows: [],
    };
  }

  const data = (await fetchAllHoStockSnapshotRows(
    upload.id,
    "row_key, asin, fsn, erp_product_id, model_name, ho_units, gurgaon_units, total_units",
  )) as HoStockDbRow[];

  const includeAll = category.trim().toLowerCase() === "all";
  const listingSets = await loadDawgCategoryListingSets(
    includeAll ? "all" : category,
    subCategory,
  );
  const metricMaps = await loadLatestChannelMetricMaps("dawg");
  const { nameByAmazonAsin, nameByFlipkartFsn } = listingSets;

  const rows: HoStockCategoryRow[] = [];
  for (const raw of data) {
    const asin = String(raw.asin ?? "").trim().toUpperCase();
    const fsn = String(raw.fsn ?? "").trim();
    const { match, marketplace: matched } = rowMatchesCategory(
      raw,
      listingSets.amazonAsins,
      listingSets.flipkartFsns,
      listingSets.normalizedListingNames,
    );
    if (!match) continue;

    const erpProductId = String(raw.erp_product_id ?? "").trim();
    const base = {
      row_key: String(raw.row_key ?? "").trim() || `${asin}|${fsn}|${erpProductId}`,
      model_name: resolveHoStockModelName({
        asin,
        fsn,
        erpProductId,
        sheetModelName: String(raw.model_name ?? "").trim(),
        nameByAmazonAsin,
        nameByFlipkartFsn,
      }),
      asin,
      fsn,
      listing_label: listingLabel(asin, fsn),
      ho_units: Number(raw.ho_units ?? 0),
      gurgaon_units: Number(raw.gurgaon_units ?? 0),
      total_units: Number(raw.total_units ?? 0),
      matched_marketplace: matched,
    };
    rows.push(enrichHoStockRow(base, metricMaps));
  }

  return {
    snapshotDate: upload.snapshot_date,
    uploadId: upload.id,
    fileName: upload.file_name,
    rowCount: rows.length,
    eolExcludedCount: 0,
    hoTotal: rows.reduce((s, r) => s + r.ho_units, 0),
    gurgaonTotal: rows.reduce((s, r) => s + r.gurgaon_units, 0),
    stockTotal: rows.reduce((s, r) => s + r.total_units, 0),
    rows,
  };
}

export async function loadHoStockCategoryReport(
  subCategory: SubCategoryFilter,
  dataScope: DataScope = "default",
): Promise<HoStockCategorySummary> {
  const upload = await getLatestHoStockUpload(dataScope);
  if (!upload) {
    return {
      snapshotDate: null,
      uploadId: null,
      fileName: null,
      rowCount: 0,
      eolExcludedCount: 0,
      hoTotal: 0,
      gurgaonTotal: 0,
      stockTotal: 0,
      rows: [],
    };
  }

  let data: HoStockDbRow[];
  try {
    data = (await fetchAllHoStockSnapshotRows(
      upload.id,
      "row_key, asin, fsn, erp_product_id, model_name, ho_units, gurgaon_units, total_units",
    )) as HoStockDbRow[];
  } catch (error) {
    if (isMissingSchemaError(error, "ho_stock_snapshot")) {
      throw new Error(
        "HO stock table missing. Run supabase/run-ho-stock.sql in Supabase SQL Editor, then upload again.",
      );
    }
    throw new Error(getErrorMessage(error));
  }

  const includeAllHoStockRows = subCategory === "all";

  const [listingSets, metricMaps, explicitEolFsns] = await Promise.all([
    loadCategoryListingSets(subCategory),
    loadLatestChannelMetricMaps(dataScope),
    isDawgDataScope(dataScope) ? Promise.resolve(new Set<string>()) : getFlipkartEolFsns(),
  ]);

  const { nameByAmazonAsin, nameByFlipkartFsn } = listingSets;

  const rows: HoStockCategoryRow[] = [];
  let eolExcludedCount = 0;
  for (const raw of data) {
    const asin = String(raw.asin ?? "").trim().toUpperCase();
    const fsn = String(raw.fsn ?? "").trim();

    let marketplace: Marketplace | "both" | null;
    if (includeAllHoStockRows) {
      marketplace = inferListingMarketplace(asin, fsn);
    } else {
      const { match, marketplace: matched } = rowMatchesCategory(
        raw,
        listingSets.amazonAsins,
        listingSets.flipkartFsns,
        listingSets.normalizedListingNames,
      );
      if (!match) continue;
      marketplace = matched;
    }

    if (hoStockRowHasExplicitFlipkartEol(fsn, explicitEolFsns)) {
      eolExcludedCount += 1;
      continue;
    }
    const erpProductId = String(raw.erp_product_id ?? "").trim();

    const base = {
      row_key: String(raw.row_key ?? "").trim() || `${asin}|${fsn}|${erpProductId}`,
      model_name: resolveHoStockModelName({
        asin,
        fsn,
        erpProductId,
        sheetModelName: String(raw.model_name ?? "").trim(),
        nameByAmazonAsin,
        nameByFlipkartFsn,
      }),
      asin,
      fsn,
      listing_label: listingLabel(asin, fsn),
      ho_units: Number(raw.ho_units ?? 0),
      gurgaon_units: Number(raw.gurgaon_units ?? 0),
      total_units: Number(raw.total_units ?? 0),
      matched_marketplace: marketplace,
    };
    rows.push(enrichHoStockRow(base, metricMaps));
  }

  const hoTotal = rows.reduce((s, r) => s + r.ho_units, 0);
  const gurgaonTotal = rows.reduce((s, r) => s + r.gurgaon_units, 0);
  const stockTotal = rows.reduce((s, r) => s + r.total_units, 0);

  return {
    snapshotDate: upload.snapshot_date,
    uploadId: upload.id,
    fileName: upload.file_name,
    rowCount: rows.length,
    eolExcludedCount,
    hoTotal,
    gurgaonTotal,
    stockTotal,
    rows,
  };
}

export async function listHoStockQcomCategories(): Promise<HoStockQcomCategoryOption[]> {
  const { data, error } = await supabase
    .from("product_master")
    .select("category, sub_category")
    .eq("marketplace", QCOM_HO_STOCK_CATALOG_MARKETPLACE);
  if (error) throw new Error(getErrorMessage(error));

  const byCategory = new Map<string, Set<string>>();
  for (const row of (data ?? []) as Pick<ProductMaster, "category" | "sub_category">[]) {
    const category = String(row.category ?? "").trim();
    if (!category) continue;
    const sub = String(row.sub_category ?? "").trim();
    if (!byCategory.has(category)) byCategory.set(category, new Set<string>());
    if (sub) byCategory.get(category)!.add(sub);
  }

  return [...byCategory.entries()]
    .map(([category, subSet]) => ({
      category,
      subCategories: [...subSet].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

export async function loadHoStockQcomCategoryReport(
  category: string,
  subCategory: string | "all",
): Promise<HoStockCategorySummary> {
  const upload = await getLatestHoStockUpload();
  if (!upload) {
    return {
      snapshotDate: null,
      uploadId: null,
      fileName: null,
      rowCount: 0,
      eolExcludedCount: 0,
      hoTotal: 0,
      gurgaonTotal: 0,
      stockTotal: 0,
      rows: [],
    };
  }

  const data = (await fetchAllHoStockSnapshotRows(
    upload.id,
    "row_key, asin, fsn, erp_product_id, model_name, ho_units, gurgaon_units, total_units",
  )) as HoStockDbRow[];

  const [listingSets, explicitEolFsns, qcomMetricsCtx] = await Promise.all([
    loadQcomCategoryListingSets(category, subCategory),
    getFlipkartEolFsns(),
    loadQcomChannelMetricsContext(),
  ]);

  const rows: HoStockCategoryRow[] = [];
  let eolExcludedCount = 0;
  for (const raw of data) {
    const asin = String(raw.asin ?? "").trim().toUpperCase();
    const fsn = String(raw.fsn ?? "").trim();
    const { match, marketplace } = rowMatchesQcomCategory(raw, listingSets);
    if (!match) continue;
    if (hoStockRowHasExplicitFlipkartEol(fsn, explicitEolFsns)) {
      eolExcludedCount += 1;
      continue;
    }
    const erpProductId = String(raw.erp_product_id ?? "").trim();
    const base = {
      row_key: String(raw.row_key ?? "").trim() || `${asin}|${fsn}|${erpProductId}`,
      model_name: resolveHoStockModelName({
        asin,
        fsn,
        erpProductId,
        sheetModelName: String(raw.model_name ?? "").trim(),
        nameByAmazonAsin: listingSets.nameByAmazonAsin,
        nameByFlipkartFsn: listingSets.nameByFlipkartFsn,
      }),
      asin,
      fsn,
      listing_label: listingLabel(asin, fsn),
      ho_units: Number(raw.ho_units ?? 0),
      gurgaon_units: Number(raw.gurgaon_units ?? 0),
      total_units: Number(raw.total_units ?? 0),
      matched_marketplace: marketplace,
    };
    rows.push(enrichHoStockRowQcom(base, qcomMetricsCtx));
  }

  return {
    snapshotDate: upload.snapshot_date,
    uploadId: upload.id,
    fileName: upload.file_name,
    rowCount: rows.length,
    eolExcludedCount,
    hoTotal: rows.reduce((s, r) => s + r.ho_units, 0),
    gurgaonTotal: rows.reduce((s, r) => s + r.gurgaon_units, 0),
    stockTotal: rows.reduce((s, r) => s + r.total_units, 0),
    rows,
  };
}

async function upsertInBatches(table: string, rows: unknown[]) {
  const batchSize = 400;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: "upload_id,row_key" });
    if (error) throw new Error(getErrorMessage(error));
  }
}

export async function ingestHoStockUpload({
  payload,
  fileName,
  uploadedBy,
  snapshotDate,
  dataScope = "default",
}: {
  payload: ParsedHoStockPayload;
  fileName: string;
  uploadedBy: string;
  snapshotDate: string;
  dataScope?: DataScope;
}): Promise<string> {
  const { data: uploadRow, error: uploadErr } = await supabase
    .from("uploads")
    .insert({
      marketplace: "amazon",
      file_name: fileName,
      uploaded_by: uploadedBy,
      snapshot_date: snapshotDate,
      status: "processing",
      upload_kind: "ho_stock",
      data_scope: dataScope,
      raw_row_count: payload.rows.length,
      valid_row_count: payload.rows.length,
      rejected_row_count: payload.errors.length,
      notes: `HO stock — ${payload.sheetName}`,
    })
    .select("id")
    .single();

  if (uploadErr) {
    const uploadMsg = getErrorMessage(uploadErr).toLowerCase();
    if (
      uploadMsg.includes("uploads_upload_kind_check") ||
      (uploadMsg.includes("upload_kind") && uploadMsg.includes("check constraint"))
    ) {
      throw new Error(
        "Database does not allow HO stock uploads yet. Run supabase/run-ho-stock.sql in the Supabase SQL Editor, then retry.",
      );
    }
    if (isMissingSchemaError(uploadErr, "ho_stock_snapshot")) {
      throw new Error(
        "HO stock tables missing. Run supabase/run-ho-stock.sql in Supabase SQL Editor, then retry.",
      );
    }
    throw new Error(getErrorMessage(uploadErr));
  }

  const uploadId = String(uploadRow!.id);

  try {
    await upsertInBatches(
      "ho_stock_snapshot",
      payload.rows.map((row) => ({
        upload_id: uploadId,
        row_key: row.row_key,
        asin: row.asin,
        fsn: row.fsn,
        erp_product_id: row.erp_product_id,
        model_name: row.model_name,
        blocked_units: row.blocked_units,
        ho_units: row.ho_units,
        gurgaon_units: row.gurgaon_units,
        total_units: row.total_units,
      })),
    );
  } catch (e) {
    await supabase.from("uploads").delete().eq("id", uploadId);
    throw e;
  }

  await supabase
    .from("uploads")
    .update({
      status: "completed",
      notes: `HO stock: ${payload.rows.length} SKUs from ${payload.sheetName}`,
    })
    .eq("id", uploadId);

  invalidateProductIdMapCache();
  await pruneOlderUploads(uploadId);
  return uploadId;
}
