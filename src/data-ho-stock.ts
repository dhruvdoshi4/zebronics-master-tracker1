import {
  chunkArray,
  getProductCodesForCategoryHistoryRollup,
  pruneOlderUploads,
  productMatchesCategoryRollup,
} from "./data";
import { invalidateProductIdMapCache } from "./product-id-map";
import type { ParsedHoStockPayload } from "./parsers-ho-stock";
import { splitFsnCell } from "./parsers-ho-stock";
import { fetchAllHoStockSnapshotRows } from "./ho-stock-snapshot-query";
import { supabase } from "./supabase";
import type { Marketplace, ProductMaster, SubCategory } from "./types";

export type HoStockCategoryRow = {
  model_name: string;
  asin: string;
  fsn: string;
  listing_label: string;
  ho_units: number;
  gurgaon_units: number;
  total_units: number;
  matched_marketplace: Marketplace | "both" | null;
};

export type HoStockCategorySummary = {
  snapshotDate: string | null;
  uploadId: string | null;
  fileName: string | null;
  rowCount: number;
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
};

function mapHoStockSearchRow(raw: HoStockDbRow): HoStockSearchRow {
  return {
    erp_product_id: String(raw.erp_product_id ?? "").trim(),
    model_name: String(raw.model_name ?? "").trim(),
    asin: String(raw.asin ?? "").trim().toUpperCase(),
    fsn: String(raw.fsn ?? "").trim(),
    ho_units: Number(raw.ho_units ?? 0),
    gurgaon_units: Number(raw.gurgaon_units ?? 0),
    total_units: Number(raw.total_units ?? 0),
  };
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
    for (const row of (data ?? []) as HoStockDbRow[]) push(mapHoStockSearchRow(row));
  }

  if (/^B0[A-Z0-9]{8}$/i.test(trimmed)) {
    const { data, error } = await supabase
      .from("ho_stock_snapshot")
      .select(select)
      .eq("upload_id", upload.id)
      .eq("asin", trimmed.toUpperCase())
      .limit(5);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of (data ?? []) as HoStockDbRow[]) push(mapHoStockSearchRow(row));
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
        push(mapHoStockSearchRow(row));
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
      push(mapHoStockSearchRow(row));
      if (results.length >= limit) break;
    }
  }

  return results.slice(0, limit);
}

function looksLikeFlipkartFsn(value: string): boolean {
  const v = value.trim();
  return /^[A-Z0-9]{12,20}$/i.test(v) && !/^B0/i.test(v);
}

async function loadCategoryListingSets(subCategory: SubCategory): Promise<{
  amazonAsins: Set<string>;
  flipkartFsns: Set<string>;
  nameByAmazonAsin: Map<string, string>;
  nameByFlipkartFsn: Map<string, string>;
}> {
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
        const name = row.product_name?.trim() ?? "";
        if (marketplace === "amazon") nameByAmazonAsin.set(code, name);
        else nameByFlipkartFsn.set(code, name);
      }
    }
  }

  return { amazonAsins, flipkartFsns, nameByAmazonAsin, nameByFlipkartFsn };
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
  subCategory: SubCategory,
): Promise<HoStockCategorySummary> {
  const upload = await getLatestHoStockUpload();
  if (!upload) {
    return {
      snapshotDate: null,
      uploadId: null,
      fileName: null,
      rowCount: 0,
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

  const { amazonAsins, flipkartFsns, nameByAmazonAsin, nameByFlipkartFsn } =
    await loadCategoryListingSets(subCategory);

  const rows: HoStockCategoryRow[] = [];
  for (const raw of data) {
    const { match, marketplace } = rowMatchesCategory(raw, amazonAsins, flipkartFsns);
    if (!match) continue;

    const asin = String(raw.asin ?? "").trim().toUpperCase();
    const fsn = String(raw.fsn ?? "").trim();
    const masterName =
      (asin && nameByAmazonAsin.get(asin)) ||
      splitFsnCell(fsn).map((f) => nameByFlipkartFsn.get(f)).find(Boolean) ||
      "";

    rows.push({
      model_name: masterName || raw.model_name,
      asin,
      fsn,
      listing_label: listingLabel(asin, fsn),
      ho_units: Number(raw.ho_units ?? 0),
      gurgaon_units: Number(raw.gurgaon_units ?? 0),
      total_units: Number(raw.total_units ?? 0),
      matched_marketplace: marketplace,
    });
  }

  rows.sort((a, b) => {
    if (b.total_units !== a.total_units) return b.total_units - a.total_units;
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
