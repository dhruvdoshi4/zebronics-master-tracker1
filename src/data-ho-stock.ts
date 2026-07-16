import {
  CATALOG_WORKSPACE_MONITOR,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_HOME_AUDIO,
  CATALOG_WORKSPACE_RITHIKA,
  CATALOG_WORKSPACE_PRAVIN,
  type CatalogWorkspace,
} from "./catalog-workspace";
import { KARAN_TRACKED_SUB_CATEGORIES } from "./karan-category-scope";
import { PRAVIN_TOP_CATEGORIES } from "./pravin-category-scope";
import { RISHABH_TOP_CATEGORIES } from "./rishabh-category-scope";
import {
  buildAdminGlobalLookupScopeFilter,
  getAdminGlobalSelloutProductCodeSet,
} from "./admin-dashboard-data";
import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  isAnalysisCategoryAll,
  isAnalysisSubCategoryAll,
} from "./analysis-category-paths";
import {
  chunkArray,
  getFlipkartEolFsns,
  getLatestUploadContextByMarketplace,
  getProductCodesForCategoryHistoryRollup,
  listDistinctRithikaSheetSubCategories,
  pruneOlderUploads,
  productMatchesSubCategoryForWorkspace,
  type UploadContextScope,
  type WorkspaceSubCategory,
  type WorkspaceSubCategoryFilter,
} from "./data";
import { isDawgSheetCategory, productMatchesDawgScope } from "./dawg-scope";
import { syncErpProductLinksFromHoStockRows } from "./erp-product-link";
import { invalidateProductIdMapCache } from "./product-id-map";
import type { ParsedHoStockPayload } from "./parsers-ho-stock";
import { splitFsnCell } from "./parsers-ho-stock";
import { fetchAllHoStockSnapshotRows } from "./ho-stock-snapshot-query";
import {
  catalogProductName,
  displayModelName,
  looksLikeProductSku,
} from "./product-display";
import { computeCombinedNetworkDocDays } from "./metrics";
import {
  computeNetworkDocFromSlices,
  loadCompanyWideHoStockChannelMetricMaps,
  loadHoStockChannelMetricMaps,
  resolveChannelSlices,
  type HoStockChannelMaps,
} from "./ho-stock-channel-metrics";
import { getLatestGlobalHoStockUpload } from "./ho-stock-snapshot-query";
import {
  fetchAllQcomProductMasterRows,
  loadQcomChannelMetricsContext,
  resolveHoStockCatalogKey,
} from "./qcom-network-doc";
import { supabase } from "./supabase";
import { normalizeKey } from "./utils";
import {
  TRACKED_SUB_CATEGORIES,
  QCOM_HO_STOCK_CATALOG_MARKETPLACE,
  type DataScope,
  type Marketplace,
  type ProductMaster,
} from "./types";
export type HoStockCategoryRow = {
  row_key: string;
  erp_product_id: string;
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

export { getLatestGlobalHoStockUpload } from "./ho-stock-snapshot-query";

/** @deprecated Use {@link getLatestGlobalHoStockUpload} — HO stock is not workspace-scoped. */
export async function getLatestHoStockUpload(
  _dataScope?: DataScope,
): Promise<{
  id: string;
  snapshot_date: string | null;
  file_name: string;
} | null> {
  return getLatestGlobalHoStockUpload();
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

type ChannelMetricSlice = HoStockChannelMaps["amazon"] extends Map<string, infer V>
  ? V
  : never;

function enrichHoStockRow<
  T extends {
    asin: string;
    fsn: string;
    ho_units: number;
    gurgaon_units: number;
  },
>(
  row: T,
  maps: HoStockChannelMaps,
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
  const { amazon, flipkart } = resolveChannelSlices(maps, asin, row.fsn);
  const doc_days = computeNetworkDocFromSlices({
    ho_units: row.ho_units,
    gurgaon_units: row.gurgaon_units,
    amazon,
    flipkart,
  });
  return {
    ...row,
    amazon_inventory_units: amazon?.inventory_units ?? 0,
    flipkart_inventory_units: flipkart?.inventory_units ?? 0,
    amazon_drr_units: amazon?.drr_units ?? 0,
    flipkart_drr_units: flipkart?.drr_units ?? 0,
    qcom_inventory_units: 0,
    qcom_drr_units: 0,
    qcom_channel_linked: false,
    doc_days,
  };
}

export type HoStockQcomEnrichmentContext = {
  qcom: Awaited<ReturnType<typeof loadQcomChannelMetricsContext>>;
  ecom: HoStockChannelMaps;
};

/** Amazon + Flipkart (all workspaces) + QCom cumulative DRR for admin / network HO Stock. */
export async function loadHoStockFullNetworkEnrichmentContext(): Promise<HoStockQcomEnrichmentContext> {
  const [qcom, ecom] = await Promise.all([
    loadQcomChannelMetricsContext(),
    loadCompanyWideHoStockChannelMetricMaps(),
  ]);
  return { qcom, ecom };
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
  ctx: HoStockQcomEnrichmentContext,
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
  const catalogKey = resolveHoStockCatalogKey(row, ctx.qcom.resolver);
  const qcomSlice =
    catalogKey !== null
      ? (ctx.qcom.byAsin.get(catalogKey) ?? { inventory_units: 0, drr_units: 0 })
      : null;
  const { amazon, flipkart } = resolveChannelSlices(ctx.ecom, row.asin, row.fsn);
  const doc_days = computeCombinedNetworkDocDays({
    ho_units: row.ho_units,
    gurgaon_units: row.gurgaon_units,
    amazon,
    flipkart,
    qcom: qcomSlice,
  });
  return {
    ...row,
    amazon_inventory_units: amazon?.inventory_units ?? 0,
    flipkart_inventory_units: flipkart?.inventory_units ?? 0,
    amazon_drr_units: amazon?.drr_units ?? 0,
    flipkart_drr_units: flipkart?.drr_units ?? 0,
    qcom_inventory_units: qcomSlice?.inventory_units ?? 0,
    qcom_drr_units: qcomSlice?.drr_units ?? 0,
    qcom_channel_linked: catalogKey !== null && ctx.qcom.byAsin.has(catalogKey),
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
    qcomMetricsCtx: HoStockQcomEnrichmentContext | null;
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
  options?: {
    qcomNetworkDoc?: boolean;
    /** Admin global HO Stock — company-wide Amazon/Flipkart + QCom DRR. */
    adminGlobalNetworkDoc?: boolean;
    dataScope?: DataScope;
    catalogWorkspace?: CatalogWorkspace;
  },
): Promise<HoStockSearchRow[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const dataScope = options?.dataScope ?? "default";
  const upload = await getLatestGlobalHoStockUpload();
  if (!upload) return [];

  const useFullNetworkMetrics =
    options?.qcomNetworkDoc === true || options?.adminGlobalNetworkDoc === true;
  const metricScope: UploadContextScope =
    dataScope === "dawg"
      ? "dawg"
      : (options?.catalogWorkspace ?? CATALOG_WORKSPACE_MONITOR);
  const [metricMaps, qcomMetricsCtx] = await Promise.all([
    useFullNetworkMetrics ? null : loadHoStockChannelMetricMaps(metricScope),
    useFullNetworkMetrics ? loadHoStockFullNetworkEnrichmentContext() : null,
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
  subCategory: WorkspaceSubCategory | string,
  catalogWorkspace: CatalogWorkspace,
): Promise<CategoryListingSets> {
  const [amazonCodes, flipkartCodes] = await Promise.all([
    getProductCodesForCategoryHistoryRollup("amazon", subCategory, catalogWorkspace, {
      allowTopCategory: true,
    }),
    getProductCodesForCategoryHistoryRollup("flipkart", subCategory, catalogWorkspace, {
      allowTopCategory: true,
    }),
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
        if (
          !productMatchesSubCategoryForWorkspace(
            subCategory,
            row,
            marketplace,
            catalogWorkspace,
            { allowTopCategory: true },
          )
        ) {
          continue;
        }
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
  subCategory: WorkspaceSubCategoryFilter,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
): Promise<CategoryListingSets> {
  if (subCategory === "all") {
    const tracked =
      catalogWorkspace === CATALOG_WORKSPACE_RITHIKA
        ? await listDistinctRithikaSheetSubCategories(catalogWorkspace)
        : catalogWorkspace === CATALOG_WORKSPACE_HOME_AUDIO
          ? [...RISHABH_TOP_CATEGORIES]
          : catalogWorkspace === CATALOG_WORKSPACE_PERSONAL_AUDIO
            ? [...KARAN_TRACKED_SUB_CATEGORIES]
            : catalogWorkspace === CATALOG_WORKSPACE_PRAVIN
              ? [...PRAVIN_TOP_CATEGORIES]
              : [...TRACKED_SUB_CATEGORIES];
    const parts = await Promise.all(
      tracked.map((sc) => loadCategoryListingSetsForSubCategory(sc, catalogWorkspace)),
    );
    return mergeCategoryListingSets(parts);
  }
  return loadCategoryListingSetsForSubCategory(subCategory, catalogWorkspace);
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

  const rows = await fetchAllQcomProductMasterRows(
    QCOM_HO_STOCK_CATALOG_MARKETPLACE,
    "product_code, product_name, category, sub_category, listing_code",
  );

  for (const row of rows as Pick<
    ProductMaster,
    "product_code" | "product_name" | "category" | "sub_category" | "listing_code"
  >[]) {
    if (!includeAllCategories && normalizeCompare(row.category) !== normalizedCategory) {
      continue;
    }
    if (normalizedSub && normalizeCompare(row.sub_category) !== normalizedSub) continue;
    const code = String(row.product_code ?? "").trim().toUpperCase();
    const listingCode = String(row.listing_code ?? "").trim().toUpperCase();
    const displayName = displayModelName(row.product_name, code);
    const labelForRow =
      displayName !== "—" ? displayName : String(row.product_name ?? "").trim() || code;

    if (isAmazonAsinCode(code)) {
      sets.amazonAsins.add(code);
      if (labelForRow) sets.nameByAmazonAsin.set(code, labelForRow);
      if (listingCode && looksLikeFlipkartFsn(listingCode)) {
        sets.flipkartFsns.add(listingCode);
        if (labelForRow) sets.nameByFlipkartFsn.set(listingCode, labelForRow);
      }
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

  if (asin && sets.amazonAsins.has(asin)) {
    return { match: true, marketplace: inferListingMarketplace(asin, row.fsn) };
  }

  const fsnHit = fsns.find((fsn) => sets.flipkartFsns.has(fsn));
  if (fsnHit) {
    return {
      match: true,
      marketplace: asin ? inferListingMarketplace(asin, row.fsn) : "flipkart",
    };
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

export async function loadHoStockCategoryReport(
  subCategory: WorkspaceSubCategoryFilter,
  catalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
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
    loadCategoryListingSets(subCategory, catalogWorkspace),
    loadHoStockChannelMetricMaps(catalogWorkspace),
    getFlipkartEolFsns(),
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
      erp_product_id: erpProductId,
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

async function loadAdminGlobalCategoryListingSets(
  category: string,
  subCategory: string,
): Promise<CategoryListingSets> {
  const scopeFilter = buildAdminGlobalLookupScopeFilter(category, subCategory);
  const [amazonCodes, flipkartCodes] = await Promise.all([
    getAdminGlobalSelloutProductCodeSet("amazon"),
    getAdminGlobalSelloutProductCodeSet("flipkart"),
  ]);

  const amazonAsins = new Set<string>();
  const flipkartFsns = new Set<string>();
  const nameByAmazonAsin = new Map<string, string>();
  const nameByFlipkartFsn = new Map<string, string>();
  const normalizedListingNames = new Set<string>();

  async function scan(marketplace: "amazon" | "flipkart", codes: Set<string>) {
    for (const chunk of chunkArray([...codes], 150)) {
      if (chunk.length === 0) continue;
      const { data, error } = await supabase
        .from("product_master")
        .select("product_code, product_name, category, sub_category, catalog_workspace")
        .eq("marketplace", marketplace)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of (data ?? []) as Pick<
        ProductMaster,
        "product_code" | "product_name" | "category" | "sub_category" | "catalog_workspace"
      >[]) {
        if (!scopeFilter(row)) continue;
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

  await Promise.all([scan("amazon", amazonCodes), scan("flipkart", flipkartCodes)]);
  return { amazonAsins, flipkartFsns, nameByAmazonAsin, nameByFlipkartFsn, normalizedListingNames };
}

/** Admin global HO stock — all manager workspaces + category analysis selection. */
export async function loadAdminGlobalHoStockCategoryReport(
  category: string,
  subCategory: string,
): Promise<HoStockCategorySummary> {
  const cat = category.trim() || ANALYSIS_CATEGORY_ALL;
  const sub = subCategory.trim() || ANALYSIS_SUB_CATEGORY_ALL;

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

  const includeAllHoStockRows =
    isAnalysisCategoryAll(cat) && isAnalysisSubCategoryAll(sub);

  const [listingSets, networkMetricsCtx, explicitEolFsns] = await Promise.all([
    loadAdminGlobalCategoryListingSets(cat, sub),
    loadHoStockFullNetworkEnrichmentContext(),
    getFlipkartEolFsns(),
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
      erp_product_id: erpProductId,
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
    rows.push(enrichHoStockRowQcom(base, networkMetricsCtx));
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

export async function listHoStockQcomCategories(): Promise<HoStockQcomCategoryOption[]> {
  const rows = await fetchAllQcomProductMasterRows(
    QCOM_HO_STOCK_CATALOG_MARKETPLACE,
    "category, sub_category",
  );

  const byCategory = new Map<string, Set<string>>();
  for (const row of rows as Pick<ProductMaster, "category" | "sub_category">[]) {
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
    loadHoStockFullNetworkEnrichmentContext(),
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
      erp_product_id: erpProductId,
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
  const { upsertSupabaseParallel } = await import("./xlsx-fast");
  await upsertSupabaseParallel(table, rows, "upload_id,row_key", {
    batchSize: 800,
    concurrency: 5,
  });
}

export async function ingestHoStockUpload({
  payload,
  fileName,
  uploadedBy,
  snapshotDate,
}: {
  payload: ParsedHoStockPayload;
  fileName: string;
  uploadedBy: string;
  snapshotDate: string;
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
      data_scope: "default",
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

  await syncErpProductLinksFromHoStockRows(
    payload.rows.map((row) => ({
      asin: row.asin,
      fsn: row.fsn,
      erp_product_id: row.erp_product_id,
      model_name: row.model_name,
    })),
    uploadId,
  );

  invalidateProductIdMapCache();
  await pruneOlderUploads(uploadId);
  return uploadId;
}
