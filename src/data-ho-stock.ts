import {
  chunkArray,
  getFlipkartEolFsns,
  getLatestUploadContextByMarketplace,
  getProductCodesForCategoryHistoryRollup,
  pruneOlderUploads,
  productMatchesCategoryRollup,
} from "./data";
import { invalidateProductIdMapCache } from "./product-id-map";
import type { ParsedHoStockPayload } from "./parsers-ho-stock";
import { splitFsnCell } from "./parsers-ho-stock";
import { fetchAllHoStockSnapshotRows } from "./ho-stock-snapshot-query";
import { catalogProductName, displayModelName } from "./product-display";
import { computeNetworkDocDays, type ChannelStockDemand } from "./metrics";
import { supabase } from "./supabase";
import {
  TRACKED_SUB_CATEGORIES,
  type ComputedMetric,
  type Marketplace,
  type ProductMaster,
  type SubCategory,
  type SubCategoryFilter,
} from "./types";
export type HoStockCategoryRow = {
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

export async function getLatestHoStockUpload(): Promise<{
  id: string;
  snapshot_date: string | null;
  file_name: string;
} | null> {
  const { data, error } = await supabase
    .from("uploads")
    .select("id, snapshot_date, file_name")
    .eq("upload_kind", "ho_stock")
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
async function loadLatestChannelMetricMaps(): Promise<{
  amazon: Map<string, ChannelMetricSlice>;
  flipkart: Map<string, ChannelMetricSlice>;
}> {
  const uploadCtx = await getLatestUploadContextByMarketplace();

  async function loadMap(marketplace: Marketplace): Promise<Map<string, ChannelMetricSlice>> {
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
    doc_days,
  };
}

function mapHoStockSearchRow(
  raw: HoStockDbRow,
  maps: { amazon: Map<string, ChannelMetricSlice>; flipkart: Map<string, ChannelMetricSlice> },
): HoStockSearchRow {
  const asin = String(raw.asin ?? "").trim().toUpperCase();
  const fsn = String(raw.fsn ?? "").trim();
  const erpProductId = String(raw.erp_product_id ?? "").trim();
  const sheetModelName = String(raw.model_name ?? "").trim();

  return enrichHoStockRow(
    {
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
    },
    maps,
  );
}

/** Search all rows in the latest HO stock upload by model, ASIN, FSN, or Product ID. */
export async function searchHoStockProducts(
  query: string,
  limit = 25,
): Promise<HoStockSearchRow[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const upload = await getLatestHoStockUpload();
  if (!upload) return [];

  const metricMaps = await loadLatestChannelMetricMaps();

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
    for (const row of (data ?? []) as HoStockDbRow[]) push(mapHoStockSearchRow(row, metricMaps));
  }

  if (/^B0[A-Z0-9]{8}$/i.test(trimmed)) {
    const { data, error } = await supabase
      .from("ho_stock_snapshot")
      .select(select)
      .eq("upload_id", upload.id)
      .eq("asin", trimmed.toUpperCase())
      .limit(5);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of (data ?? []) as HoStockDbRow[]) push(mapHoStockSearchRow(row, metricMaps));
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
        push(mapHoStockSearchRow(row, metricMaps));
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
      push(mapHoStockSearchRow(row, metricMaps));
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
      }
    }
  }

  return { amazonAsins, flipkartFsns, nameByAmazonAsin, nameByFlipkartFsn };
}

function mergeCategoryListingSets(sets: CategoryListingSets[]): CategoryListingSets {
  const amazonAsins = new Set<string>();
  const flipkartFsns = new Set<string>();
  const nameByAmazonAsin = new Map<string, string>();
  const nameByFlipkartFsn = new Map<string, string>();

  for (const part of sets) {
    for (const code of part.amazonAsins) amazonAsins.add(code);
    for (const code of part.flipkartFsns) flipkartFsns.add(code);
    for (const [code, name] of part.nameByAmazonAsin) nameByAmazonAsin.set(code, name);
    for (const [code, name] of part.nameByFlipkartFsn) nameByFlipkartFsn.set(code, name);
  }

  return { amazonAsins, flipkartFsns, nameByAmazonAsin, nameByFlipkartFsn };
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

function rowMatchesCategory(
  row: HoStockDbRow,
  amazonAsins: Set<string>,
  flipkartFsns: Set<string>,
): { match: boolean; marketplace: Marketplace | "both" | null } {
  const asin = String(row.asin ?? "").trim().toUpperCase();
  const fsns = splitFsnCell(row.fsn);
  const asinHit = asin.length > 0 && amazonAsins.has(asin);
  const fsnHit = fsns.some((f) => flipkartFsns.has(f));
  if (asinHit && fsnHit) return { match: true, marketplace: "both" };
  if (asinHit) return { match: true, marketplace: "amazon" };
  if (fsnHit) return { match: true, marketplace: "flipkart" };
  return { match: false, marketplace: null };
}

function listingLabel(asin: string, fsn: string): string {
  const parts: string[] = [];
  if (asin) parts.push(`ASIN ${asin}`);
  if (fsn) parts.push(`FSN ${fsn}`);
  return parts.join(" · ") || "—";
}

export async function loadHoStockCategoryReport(
  subCategory: SubCategoryFilter,
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
    loadCategoryListingSets(subCategory),
    loadLatestChannelMetricMaps(),
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

  rows.sort((a, b) => {
    const docA = a.doc_days ?? -1;
    const docB = b.doc_days ?? -1;
    if (docB !== docA) return docB - docA;
    return a.model_name.localeCompare(b.model_name, "en-IN");
  });

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
