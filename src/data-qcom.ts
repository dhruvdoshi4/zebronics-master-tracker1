import { ingestParsedUpload, pruneOlderUploads, purgeMarketplaceSelloutHistory } from "./data";
import { displayModelName, looksLikeProductSku } from "./product-display";
import { loadProductIdMap, lookupErpProductId } from "./product-id-map";
import { marketplaceLabel } from "./marketplace-labels";
import {
  emptyQcomChannelUnits,
  getCurrentFyStart,
  previousMonthYmFromSnapshot,
  type QcomCategorySheetMonthlySellout,
} from "./qcom-category-sellout-insights";
import { parseQcomMasterFile, type QcomParseBundle } from "./parsers-qcom";
import { supabase } from "./supabase";
import type {
  ComputedMetric,
  DailySale,
  Marketplace,
  ProductMaster,
  QcomMarketplace,
} from "./types";
import {
  QCOM_HO_STOCK_CATALOG_MARKETPLACE,
  QCOM_MARKETPLACES,
  isQcomMarketplace,
} from "./types";
import { normalizeKey } from "./utils";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Upload failed.";
}

export async function ingestQcomMasterUpload({
  file,
  fileName,
  uploadedBy,
  snapshotDate,
}: {
  file: File;
  fileName: string;
  uploadedBy: string;
  snapshotDate: string;
}): Promise<{ bundles: QcomParseBundle[]; uploadIds: string[] }> {
  const { channelBundles, consolidatedCatalog } = await parseQcomMasterFile(file, snapshotDate);
  const uploadIds: string[] = [];

  const marketplacesInFile = [...new Set(channelBundles.map((b) => b.marketplace))];
  console.log("[qcom upload] purging sellout history for", marketplacesInFile.join(", "));
  for (const marketplace of marketplacesInFile) {
    await purgeMarketplaceSelloutHistory(marketplace);
  }

  for (const bundle of channelBundles) {
    console.log(
      `[qcom upload] ingesting ${bundle.marketplace}: ${bundle.payload.products.length} products, ${bundle.payload.dailySales.length} sellout rows`,
    );
    const uploadId = await ingestParsedUpload({
      payload: {
        ...bundle.payload,
        products: bundle.payload.products.map((p) => ({
          ...p,
          product_name: p.product_name,
          sub_category: p.sub_category ?? "",
          category: p.category ?? "",
          brand: p.brand ?? "",
          listing_code: p.listing_code ?? null,
        })),
      },
      marketplace: bundle.marketplace,
      fileName: `${fileName} · ${bundle.sheetName}`,
      uploadedBy,
      snapshotDate,
      skipPurge: true,
      deferPrune: true,
    });
    uploadIds.push(uploadId);
  }

  if (consolidatedCatalog && consolidatedCatalog.payload.products.length > 0) {
    const { error: clearError } = await supabase
      .from("product_master")
      .delete()
      .eq("marketplace", QCOM_HO_STOCK_CATALOG_MARKETPLACE);
    if (clearError) throw new Error(getErrorMessage(clearError));

    const uploadId = await ingestParsedUpload({
      payload: {
        ...consolidatedCatalog.payload,
        products: consolidatedCatalog.payload.products.map((p) => ({
          ...p,
          sub_category: p.sub_category ?? "",
          category: p.category ?? "",
          brand: p.brand ?? "",
        })),
      },
      marketplace: QCOM_HO_STOCK_CATALOG_MARKETPLACE,
      fileName: `${fileName} · ${consolidatedCatalog.sheetName}`,
      uploadedBy,
      snapshotDate,
    });
    uploadIds.push(uploadId);
  }

  for (const uploadId of uploadIds) {
    await pruneOlderUploads(uploadId);
  }

  return { bundles: channelBundles, uploadIds };
}

export async function listQcomCategories(): Promise<string[]> {
  const categories = new Set<string>();
  for (const marketplace of QCOM_MARKETPLACES) {
    const { data, error } = await supabase
      .from("product_master")
      .select("category")
      .eq("marketplace", marketplace)
      .not("category", "is", null);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of data ?? []) {
      const c = String((row as { category?: string }).category ?? "").trim();
      if (c) categories.add(c);
    }
  }
  return [...categories].sort((a, b) => a.localeCompare(b));
}

/** Resolve listing ID or ASIN to canonical product_code stored in DB (usually ASIN). */
export async function resolveQcomCanonicalProductCode(
  marketplace: QcomMarketplace,
  code: string,
): Promise<string | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  if (/^B0[A-Z0-9]{8,}$/i.test(trimmed)) return trimmed.toUpperCase();

  const { data, error } = await supabase
    .from("product_master")
    .select("product_code, listing_code")
    .eq("marketplace", marketplace)
    .or(`product_code.eq.${trimmed},listing_code.eq.${trimmed}`)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(getErrorMessage(error));
  if (!data) return trimmed;
  const row = data as { product_code: string; listing_code: string | null };
  return row.product_code?.trim() || null;
}

export async function searchQcomProducts(query: string, limit = 20) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const pattern = `%${trimmed}%`;
  const results: Array<{
    erpProductId: string | null;
    productCode: string;
    productName: string;
    category: string | null;
    marketplace: QcomMarketplace;
    listingCode: string | null;
  }> = [];

  const idMap = await loadProductIdMap();

  for (const marketplace of QCOM_MARKETPLACES) {
    const { data, error } = await supabase
      .from("product_master")
      .select("product_code, product_name, category, listing_code")
      .eq("marketplace", marketplace)
      .or(
        `product_code.ilike.${pattern},product_name.ilike.${pattern},category.ilike.${pattern},listing_code.ilike.${pattern}`,
      )
      .limit(limit);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of data ?? []) {
      const r = row as {
        product_code: string;
        product_name: string;
        category: string | null;
        listing_code: string | null;
      };
      let erpProductId: string | null = null;
      if (idMap && /^B0/i.test(r.product_code)) {
        erpProductId = lookupErpProductId(idMap, "amazon", r.product_code);
      }
      results.push({
        erpProductId,
        productCode: r.product_code,
        productName: r.product_name,
        category: r.category,
        marketplace,
        listingCode: r.listing_code,
      });
    }
  }

  return results.slice(0, limit);
}

function cleanAsinCode(code: string): string | null {
  const v = code.trim().toUpperCase();
  return /^B0[A-Z0-9]{8,}$/i.test(v) ? v : null;
}

type QcomSearchRow = {
  erpProductId: string | null;
  productCode: string;
  productName: string;
  category: string | null;
  marketplace: QcomMarketplace;
  listingCode: string | null;
};

export type UnifiedQcomProductSuggestion = {
  key: string;
  modelName: string;
  asin: string | null;
  erpProductId: string | null;
  category: string | null;
  channels: QcomMarketplace[];
  /** ASIN when linked; otherwise the listing id on the default channel. */
  canonicalProductCode: string;
  defaultMarketplace: QcomMarketplace;
  subtitle: string;
};

const QCOM_CHANNEL_ORDER: readonly QcomMarketplace[] = [
  "zepto",
  "blinkit",
  "instamart",
  "bigbasket",
];

function pickDefaultMarketplace(channels: QcomMarketplace[]): QcomMarketplace {
  for (const ch of QCOM_CHANNEL_ORDER) {
    if (channels.includes(ch)) return ch;
  }
  return channels[0] ?? "zepto";
}

function buildQcomSubtitle(row: {
  asin: string | null;
  erpProductId: string | null;
  channels: QcomMarketplace[];
}): string {
  const parts: string[] = [];
  if (row.erpProductId) parts.push(`ID ${row.erpProductId}`);
  if (row.asin) parts.push(`ASIN ${row.asin}`);
  if (row.channels.length) {
    parts.push(row.channels.map((ch) => marketplaceLabel(ch)).join(" · "));
  }
  return parts.join(" · ");
}

/** One row per ASIN / model — same pattern as marketplace Product Lookup. */
export async function searchUnifiedQcomProducts(
  query: string,
  limit = 10,
): Promise<UnifiedQcomProductSuggestion[]> {
  const rawHits = await searchQcomProducts(query, 40);
  const byKey = new Map<string, UnifiedQcomProductSuggestion>();
  const modelNameToAsinKey = new Map<string, string>();

  const mergeHit = (hit: QcomSearchRow) => {
    const asin = cleanAsinCode(hit.productCode);
    const modelName = displayModelName(hit.productName, hit.productCode);
    const normModel = normalizeKey(modelName);
    const normCat = normalizeKey(hit.category ?? "");

    let key: string;
    if (asin) {
      key = `asin:${asin}`;
      if (normModel) modelNameToAsinKey.set(`${normModel}::${normCat}`, key);
    } else if (normModel) {
      const linked = modelNameToAsinKey.get(`${normModel}::${normCat}`);
      key = linked ?? `solo:${hit.marketplace}:${hit.productCode}`;
    } else {
      key = `solo:${hit.marketplace}:${hit.productCode}`;
    }

    const existing = byKey.get(key);
    if (!existing) {
      const channels = [hit.marketplace];
      const row: UnifiedQcomProductSuggestion = {
        key,
        modelName: modelName === "—" ? hit.productName.trim() || hit.productCode : modelName,
        asin,
        erpProductId: hit.erpProductId,
        category: hit.category,
        channels,
        canonicalProductCode: asin ?? hit.productCode,
        defaultMarketplace: hit.marketplace,
        subtitle: "",
      };
      row.subtitle = buildQcomSubtitle(row);
      byKey.set(key, row);
      return;
    }

    if (!existing.channels.includes(hit.marketplace)) {
      existing.channels.push(hit.marketplace);
      existing.channels.sort(
        (a, b) =>
          QCOM_CHANNEL_ORDER.indexOf(a) - QCOM_CHANNEL_ORDER.indexOf(b),
      );
    }
    if (asin && !existing.asin) {
      existing.asin = asin;
      existing.canonicalProductCode = asin;
    }
    if (hit.erpProductId && !existing.erpProductId) {
      existing.erpProductId = hit.erpProductId;
    }
    if (hit.category && !existing.category) existing.category = hit.category;
    const nextName = displayModelName(hit.productName, hit.productCode);
    if (nextName !== "—" && nextName.length > existing.modelName.length) {
      existing.modelName = nextName;
    }
    existing.defaultMarketplace = pickDefaultMarketplace(existing.channels);
    existing.subtitle = buildQcomSubtitle(existing);
  };

  for (const hit of rawHits) {
    mergeHit(hit);
  }

  // Second pass: fold unlinked solo rows into ASIN groups with the same model name.
  for (const [key, row] of [...byKey.entries()]) {
    if (!key.startsWith("solo:")) continue;
    const normModel = normalizeKey(row.modelName);
    const normCat = normalizeKey(row.category ?? "");
    const asinKey = modelNameToAsinKey.get(`${normModel}::${normCat}`);
    if (!asinKey || asinKey === key) continue;
    const target = byKey.get(asinKey);
    if (!target) continue;
    for (const ch of row.channels) {
      if (!target.channels.includes(ch)) target.channels.push(ch);
    }
    target.channels.sort(
      (a, b) => QCOM_CHANNEL_ORDER.indexOf(a) - QCOM_CHANNEL_ORDER.indexOf(b),
    );
    target.defaultMarketplace = pickDefaultMarketplace(target.channels);
    target.subtitle = buildQcomSubtitle(target);
    byKey.delete(key);
  }

  return [...byKey.values()]
    .sort((a, b) => a.modelName.localeCompare(b.modelName))
    .slice(0, limit);
}

export async function findUnifiedQcomProduct(
  query: string,
): Promise<UnifiedQcomProductSuggestion | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const asin = cleanAsinCode(trimmed);
  if (asin) {
    const rows = await searchUnifiedQcomProducts(asin, 5);
    return rows.find((r) => r.asin === asin) ?? rows[0] ?? null;
  }

  const rows = await searchUnifiedQcomProducts(trimmed, 12);
  const norm = normalizeKey(trimmed);
  const exact = rows.find((r) => normalizeKey(r.modelName) === norm);
  if (exact) return exact;

  return rows[0] ?? null;
}

export type QcomCategoryChannelTotals = {
  zepto: number;
  blinkit: number;
  bigbasket: number;
  instamart: number;
};

async function getLatestQcomUploadId(
  marketplace: QcomMarketplace,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("uploads")
    .select("id")
    .eq("marketplace", marketplace)
    .eq("upload_kind", "sellout")
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(getErrorMessage(error));
  return (data as { id: string } | null)?.id ?? null;
}

export async function loadQcomCategoryMonthlyTotals(
  category: string,
): Promise<Map<string, QcomCategoryChannelTotals>> {
  const monthMap = new Map<string, QcomCategoryChannelTotals>();
  const cat = category.trim();
  if (!cat) return monthMap;

  const bump = (monthYm: string, marketplace: QcomMarketplace, units: number) => {
    if (units <= 0) return;
    const entry = monthMap.get(monthYm) ?? {
      zepto: 0,
      blinkit: 0,
      bigbasket: 0,
      instamart: 0,
    };
    entry[marketplace] += units;
    monthMap.set(monthYm, entry);
  };

  for (const marketplace of QCOM_MARKETPLACES) {
    const uploadId = await getLatestQcomUploadId(marketplace);
    if (!uploadId) continue;

    let loadedFromTable = false;
    const { data: monthlyRows, error: mErr } = await supabase
      .from("category_monthly_sellout")
      .select("month_ym, units_sold")
      .eq("marketplace", marketplace)
      .eq("upload_id", uploadId)
      .eq("sub_category", cat);
    if (!mErr && monthlyRows?.length) {
      loadedFromTable = true;
      for (const row of monthlyRows) {
        const r = row as { month_ym: string; units_sold: number };
        bump(String(r.month_ym), marketplace, Number(r.units_sold ?? 0));
      }
    }

    if (loadedFromTable) continue;

    const { data: products, error: pErr } = await supabase
      .from("product_master")
      .select("product_code")
      .eq("marketplace", marketplace)
      .eq("category", cat);
    if (pErr) throw new Error(getErrorMessage(pErr));
    const codes = (products ?? []).map((p) => (p as { product_code: string }).product_code);
    if (codes.length === 0) continue;

    for (const chunk of chunkCodes(codes)) {
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data: sales, error: sErr } = await supabase
          .from("daily_sales")
          .select("sale_date, units_sold")
          .eq("marketplace", marketplace)
          .eq("upload_id", uploadId)
          .in("product_code", chunk)
          .range(from, from + pageSize - 1);
        if (sErr) throw new Error(getErrorMessage(sErr));
        const batch = sales ?? [];
        for (const row of batch) {
          const sale = row as { sale_date: string; units_sold: number };
          bump(sale.sale_date.slice(0, 7), marketplace, Number(sale.units_sold ?? 0));
        }
        if (batch.length < pageSize) break;
        from += pageSize;
      }
    }
  }

  return monthMap;
}

function chunkCodes(codes: string[], size = 100): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < codes.length; i += size) {
    out.push(codes.slice(i, i + size));
  }
  return out;
}

function isMissingCategoryMonthlyTableError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes("category_monthly_sellout") && msg.includes("does not exist");
}

function priorFyMonthYms(referenceIsoDate: string): string[] {
  const reportFyStart = getCurrentFyStart(new Date(`${referenceIsoDate}T12:00:00`));
  const priorStart = reportFyStart - 1;
  const months: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const date = new Date(priorStart, 3 + i, 1);
    months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export type QcomUploadContext = Record<
  QcomMarketplace,
  { id: string; snapshotDate: string } | null
>;

export async function getLatestQcomUploadContext(): Promise<QcomUploadContext> {
  const ctx = {} as QcomUploadContext;
  for (const marketplace of QCOM_MARKETPLACES) {
    const uploadId = await getLatestQcomUploadId(marketplace);
    if (!uploadId) {
      ctx[marketplace] = null;
      continue;
    }
    const { data, error } = await supabase
      .from("uploads")
      .select("id, snapshot_date")
      .eq("id", uploadId)
      .maybeSingle();
    if (error) throw new Error(getErrorMessage(error));
    const row = data as { id: string; snapshot_date: string } | null;
    ctx[marketplace] = row
      ? { id: row.id, snapshotDate: String(row.snapshot_date) }
      : null;
  }
  return ctx;
}

export async function getLatestQcomUploadSheetCoverage(): Promise<
  Record<QcomMarketplace, string | null>
> {
  const ctx = await getLatestQcomUploadContext();
  const out = {} as Record<QcomMarketplace, string | null>;
  for (const ch of QCOM_MARKETPLACES) {
    out[ch] = ctx[ch]?.snapshotDate ?? null;
  }
  return out;
}

/**
 * Category analysis roll-up (same shape as marketplace monitors/projectors charts).
 */
export async function loadQcomCategorySheetMonthlySellout(
  category: string,
): Promise<QcomCategorySheetMonthlySellout> {
  const cat = category.trim();
  const uploadCtx = await getLatestQcomUploadContext();
  const channelsActive = Object.fromEntries(
    QCOM_MARKETPLACES.map((ch) => [ch, uploadCtx[ch] != null]),
  ) as Record<QcomMarketplace, boolean>;

  const monthlyByChannel = Object.fromEntries(
    QCOM_MARKETPLACES.map((ch) => [ch, new Map<string, number>()]),
  ) as Record<QcomMarketplace, Map<string, number>>;
  const monthlyCombined = new Map<string, number>();
  const skuCountByChannel = emptyQcomChannelUnits();

  const bumpCombined = (ym: string, units: number) => {
    monthlyCombined.set(ym, (monthlyCombined.get(ym) ?? 0) + units);
  };

  async function loadFromCategoryMonthlyTable(
    marketplace: QcomMarketplace,
    uploadId: string,
    target: Map<string, number>,
  ): Promise<boolean> {
    const { data, error } = await supabase
      .from("category_monthly_sellout")
      .select("month_ym, units_sold")
      .eq("marketplace", marketplace)
      .eq("upload_id", uploadId)
      .eq("sub_category", cat);
    if (error) {
      if (isMissingCategoryMonthlyTableError(error)) return false;
      throw new Error(getErrorMessage(error));
    }
    if (!data?.length) return false;
    for (const row of data) {
      const r = row as { month_ym: string; units_sold: unknown };
      const ym = String(r.month_ym);
      const units = Number(r.units_sold ?? 0);
      target.set(ym, units);
      bumpCombined(ym, units);
    }
    return true;
  }

  async function sumDailyByMonth(
    marketplace: QcomMarketplace,
    codes: string[],
    uploadId: string,
    target: Map<string, number>,
  ) {
    if (codes.length === 0) return;
    for (const chunk of chunkCodes(codes)) {
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("daily_sales")
          .select("product_code, sale_date, units_sold")
          .eq("marketplace", marketplace)
          .eq("upload_id", uploadId)
          .in("product_code", chunk)
          .range(from, from + pageSize - 1);
        if (error) throw new Error(getErrorMessage(error));
        const batch = data ?? [];
        const byProduct = new Map<string, DailySale[]>();
        for (const row of batch) {
          const r = row as {
            product_code: string;
            sale_date: string;
            units_sold: unknown;
          };
          const code = String(r.product_code);
          const list = byProduct.get(code) ?? [];
          list.push({
            marketplace,
            product_code: code,
            sale_date: String(r.sale_date),
            units_sold: Number(r.units_sold ?? 0),
          });
          byProduct.set(code, list);
        }
        for (const productRows of byProduct.values()) {
          for (const [ym, units] of aggregateQcomSelloutByMonth(productRows)) {
            if (units <= 0) continue;
            target.set(ym, (target.get(ym) ?? 0) + units);
            bumpCombined(ym, units);
          }
        }
        // Each product_code counted once per month (no double ASIN+PVID).
        if (batch.length < pageSize) break;
        from += pageSize;
      }
    }
  }

  for (const marketplace of QCOM_MARKETPLACES) {
    const upload = uploadCtx[marketplace];
    if (!upload) continue;

    const { data: products, error: pErr } = await supabase
      .from("product_master")
      .select("product_code")
      .eq("marketplace", marketplace)
      .eq("category", cat);
    if (pErr) throw new Error(getErrorMessage(pErr));
    const codes = (products ?? []).map((p) => (p as { product_code: string }).product_code);
    skuCountByChannel[marketplace] = codes.length;

    const target = monthlyByChannel[marketplace];
    const fromTable = await loadFromCategoryMonthlyTable(marketplace, upload.id, target);
    if (!fromTable) {
      await sumDailyByMonth(marketplace, codes, upload.id, target);
    }
  }

  const [ongoingMonthMtd, previousMonthSo] = await Promise.all([
    loadQcomCategoryOngoingMonthMtd(cat, uploadCtx, channelsActive),
    loadQcomCategoryPreviousMonthSo(cat, uploadCtx, channelsActive),
  ]);

  let result: QcomCategorySheetMonthlySellout = {
    skuCountByChannel,
    skuCount: QCOM_MARKETPLACES.reduce((s, ch) => s + skuCountByChannel[ch], 0),
    channelsActive,
    monthlyByChannel,
    monthlyCombined,
    ongoingMonthMtd,
    previousMonthSo,
  };

  result = await applyPriorFySoToQcomMaps(result, uploadCtx, cat);
  return result;
}

async function loadQcomCategoryOngoingMonthMtd(
  category: string,
  uploadCtx: QcomUploadContext,
  channelsActive: Record<QcomMarketplace, boolean>,
): Promise<QcomCategorySheetMonthlySellout["ongoingMonthMtd"]> {
  const nowYm = new Date().toISOString().slice(0, 7);

  async function sumMtd(
    marketplace: QcomMarketplace,
    snapshotDate: string | null,
    uploadId: string | null,
  ): Promise<number> {
    if (!snapshotDate || !uploadId) return 0;
    const { data: products, error: pErr } = await supabase
      .from("product_master")
      .select("product_code")
      .eq("marketplace", marketplace)
      .eq("category", category);
    if (pErr) throw new Error(getErrorMessage(pErr));
    const codes = (products ?? []).map((p) => (p as { product_code: string }).product_code);
    let total = 0;
    for (const chunk of chunkCodes(codes, 150)) {
      if (chunk.length === 0) continue;
      const { data, error } = await supabase
        .from("computed_metrics")
        .select("may_mtd_units")
        .eq("marketplace", marketplace)
        .eq("as_of_date", snapshotDate)
        .eq("upload_id", uploadId)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of (data ?? []) as Pick<ComputedMetric, "may_mtd_units">[]) {
        total += Number(row.may_mtd_units ?? 0);
      }
    }
    return total;
  }

  const snapshotDates = QCOM_MARKETPLACES.map((ch) =>
    channelsActive[ch] ? uploadCtx[ch]?.snapshotDate : null,
  ).filter(Boolean) as string[];
  if (snapshotDates.length === 0) return null;

  const reportYm = snapshotDates.sort((a, b) => b.localeCompare(a))[0].slice(0, 7);
  if (reportYm !== nowYm) return null;

  const channels = emptyQcomChannelUnits();
  await Promise.all(
    QCOM_MARKETPLACES.map(async (ch) => {
      if (!channelsActive[ch]) return;
      channels[ch] = await sumMtd(ch, uploadCtx[ch]?.snapshotDate ?? null, uploadCtx[ch]?.id ?? null);
    }),
  );

  const total = QCOM_MARKETPLACES.reduce((s, ch) => s + channels[ch], 0);
  if (total <= 0) return null;
  return { monthYm: nowYm, channels };
}

async function loadQcomCategoryPreviousMonthSo(
  category: string,
  uploadCtx: QcomUploadContext,
  channelsActive: Record<QcomMarketplace, boolean>,
): Promise<QcomCategorySheetMonthlySellout["previousMonthSo"]> {
  async function sumAprSo(
    marketplace: QcomMarketplace,
    snapshotDate: string | null,
    uploadId: string | null,
  ): Promise<number> {
    if (!snapshotDate || !uploadId) return 0;
    const { data: products, error: pErr } = await supabase
      .from("product_master")
      .select("product_code")
      .eq("marketplace", marketplace)
      .eq("category", category);
    if (pErr) throw new Error(getErrorMessage(pErr));
    const codes = (products ?? []).map((p) => (p as { product_code: string }).product_code);
    let total = 0;
    for (const chunk of chunkCodes(codes, 150)) {
      if (chunk.length === 0) continue;
      const { data, error } = await supabase
        .from("computed_metrics")
        .select("apr_so_units")
        .eq("marketplace", marketplace)
        .eq("as_of_date", snapshotDate)
        .eq("upload_id", uploadId)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of (data ?? []) as Pick<ComputedMetric, "apr_so_units">[]) {
        total += Number(row.apr_so_units ?? 0);
      }
    }
    return total;
  }

  const snapshotDates = QCOM_MARKETPLACES.map((ch) =>
    channelsActive[ch] ? uploadCtx[ch]?.snapshotDate : null,
  ).filter(Boolean) as string[];
  if (snapshotDates.length === 0) return null;

  const reportSnapshot = snapshotDates.sort((a, b) => b.localeCompare(a))[0];
  const monthYm = previousMonthYmFromSnapshot(reportSnapshot);

  const channels = emptyQcomChannelUnits();
  await Promise.all(
    QCOM_MARKETPLACES.map(async (ch) => {
      if (!channelsActive[ch]) return;
      channels[ch] = await sumAprSo(
        ch,
        uploadCtx[ch]?.snapshotDate ?? null,
        uploadCtx[ch]?.id ?? null,
      );
    }),
  );

  if (QCOM_MARKETPLACES.every((ch) => channels[ch] === 0)) return null;
  return { monthYm, channels };
}

async function applyPriorFySoToQcomMaps(
  maps: QcomCategorySheetMonthlySellout,
  uploadCtx: QcomUploadContext,
  category: string,
): Promise<QcomCategorySheetMonthlySellout> {
  const snapshotDates = QCOM_MARKETPLACES.map((ch) => uploadCtx[ch]?.snapshotDate).filter(
    Boolean,
  ) as string[];
  if (snapshotDates.length === 0) return maps;

  const referenceDate = snapshotDates.sort((a, b) => b.localeCompare(a))[0];
  const fyMonths = priorFyMonthYms(referenceDate);
  const monthlyByChannel = { ...maps.monthlyByChannel } as Record<
    QcomMarketplace,
    Map<string, number>
  >;
  const monthlyCombined = new Map(maps.monthlyCombined);

  for (const marketplace of QCOM_MARKETPLACES) {
    if (!maps.channelsActive[marketplace]) continue;
    const upload = uploadCtx[marketplace];
    if (!upload) continue;

    const { data: products, error: pErr } = await supabase
      .from("product_master")
      .select("product_code")
      .eq("marketplace", marketplace)
      .eq("category", category);
    if (pErr) throw new Error(getErrorMessage(pErr));
    const codes = (products ?? []).map((p) => (p as { product_code: string }).product_code);

    let priorFyTotal = 0;
    for (const chunk of chunkCodes(codes, 150)) {
      if (chunk.length === 0) continue;
      const { data, error } = await supabase
        .from("computed_metrics")
        .select("prior_fy_so_units")
        .eq("marketplace", marketplace)
        .eq("as_of_date", upload.snapshotDate)
        .eq("upload_id", upload.id)
        .in("product_code", chunk);
      if (error) throw new Error(getErrorMessage(error));
      for (const row of (data ?? []) as Pick<ComputedMetric, "prior_fy_so_units">[]) {
        priorFyTotal += Number(row.prior_fy_so_units ?? 0);
      }
    }
    if (priorFyTotal <= 0) continue;

    const channelMap = new Map(monthlyByChannel[marketplace]);
    const existing = fyMonths.reduce((sum, ym) => sum + (channelMap.get(ym) ?? 0), 0);
    if (existing >= priorFyTotal * 0.99) continue;

    const perMonth = priorFyTotal / 12;
    for (const ym of fyMonths) {
      const prevChannel = channelMap.get(ym) ?? 0;
      if (prevChannel > 0) continue;
      const prevCombined = monthlyCombined.get(ym) ?? 0;
      channelMap.set(ym, perMonth);
      monthlyCombined.set(ym, prevCombined + perMonth);
    }
    monthlyByChannel[marketplace] = channelMap;
  }

  return { ...maps, monthlyByChannel, monthlyCombined };
}

export function isMarketplaceChannel(m: Marketplace): boolean {
  return isQcomMarketplace(m) || m === "amazon" || m === "flipkart";
}

function monthUnitsFromSaleRows(list: DailySale[]): number {
  const sheetAnchors = list.filter((r) => /-01$/.test(r.sale_date));
  if (sheetAnchors.length > 0) {
    return Math.max(0, ...sheetAnchors.map((r) => Number(r.units_sold ?? 0)));
  }
  return list.reduce((sum, r) => sum + Number(r.units_sold ?? 0), 0);
}

/**
 * Zepto masters store month totals in Apr-26 / Mar-26 columns (saved as sale_date YYYY-MM-01).
 * Older uploads also have per-day rows — summing both doubles the month. Prefer -01 anchors.
 */
export function aggregateQcomSelloutByMonth(rows: DailySale[]): Map<string, number> {
  const byMonth = new Map<string, DailySale[]>();
  for (const row of rows) {
    const ym = row.sale_date.slice(0, 7);
    const list = byMonth.get(ym) ?? [];
    list.push(row);
    byMonth.set(ym, list);
  }

  const out = new Map<string, number>();
  for (const [ym, list] of byMonth) {
    out.set(ym, monthUnitsFromSaleRows(list));
  }
  return out;
}

/**
 * Same SKU can exist twice (ASIN + old Zepto PVID). Take the best month total per code, not a sum.
 */
export function aggregateQcomSelloutByMonthBestOfCodes(rows: DailySale[]): Map<string, number> {
  const byCode = new Map<string, DailySale[]>();
  for (const row of rows) {
    const list = byCode.get(row.product_code) ?? [];
    list.push(row);
    byCode.set(row.product_code, list);
  }

  const out = new Map<string, number>();
  for (const codeRows of byCode.values()) {
    const perCode = aggregateQcomSelloutByMonth(codeRows);
    for (const [ym, units] of perCode) {
      out.set(ym, Math.max(out.get(ym) ?? 0, units));
    }
  }
  return out;
}

/** All product_code / listing_code values that may hold sellout for one catalogue item. */
export async function collectQcomProductCodes(
  marketplace: QcomMarketplace,
  code: string,
): Promise<string[]> {
  const trimmed = code.trim();
  if (!trimmed) return [];

  const codes = new Set<string>([trimmed]);
  const asinFromInput = cleanAsinCode(trimmed);
  if (asinFromInput) codes.add(asinFromInput);

  const canonical = await resolveQcomCanonicalProductCode(marketplace, trimmed);
  if (canonical) codes.add(canonical);

  const orParts = new Set<string>([
    `product_code.eq.${trimmed}`,
    `listing_code.eq.${trimmed}`,
  ]);
  if (canonical && canonical !== trimmed) {
    orParts.add(`product_code.eq.${canonical}`);
  }

  const { data: masterRows, error: masterErr } = await supabase
    .from("product_master")
    .select("product_code, listing_code, product_name")
    .eq("marketplace", marketplace)
    .or([...orParts].join(","));
  if (masterErr) throw new Error(getErrorMessage(masterErr));

  const catalogueNames = new Set<string>();
  for (const row of masterRows ?? []) {
    const r = row as {
      product_code: string;
      listing_code: string | null;
      product_name: string;
    };
    if (r.product_code?.trim()) codes.add(r.product_code.trim());
    if (r.listing_code?.trim()) codes.add(r.listing_code.trim());
    const name = String(r.product_name ?? "").trim();
    if (name && !looksLikeProductSku(name)) catalogueNames.add(name);
  }

  for (const name of catalogueNames) {
    const { data: siblings, error: sibErr } = await supabase
      .from("product_master")
      .select("product_code, listing_code")
      .eq("marketplace", marketplace)
      .eq("product_name", name);
    if (sibErr) throw new Error(getErrorMessage(sibErr));
    for (const row of siblings ?? []) {
      const r = row as { product_code: string; listing_code: string | null };
      if (r.product_code?.trim()) codes.add(r.product_code.trim());
      if (r.listing_code?.trim()) codes.add(r.listing_code.trim());
    }
  }

  return [...codes];
}

function mergeDailySalesByDate(rows: DailySale[]): DailySale[] {
  const map = new Map<string, DailySale>();
  for (const row of rows) {
    const key = row.sale_date;
    const prev = map.get(key);
    if (prev) {
      map.set(key, {
        ...prev,
        units_sold: Number(prev.units_sold ?? 0) + Number(row.units_sold ?? 0),
      });
    } else {
      map.set(key, { ...row });
    }
  }
  return [...map.values()].sort((a, b) => a.sale_date.localeCompare(b.sale_date));
}

async function fetchQcomDailySelloutForCodes(
  marketplace: QcomMarketplace,
  codes: string[],
  uploadId: string | null,
): Promise<DailySale[]> {
  if (codes.length === 0) return [];

  const merged: DailySale[] = [];
  const pageSize = 1000;

  for (const chunk of chunkCodes(codes, 80)) {
    let from = 0;
    while (true) {
      let query = supabase
        .from("daily_sales")
        .select("marketplace, product_code, sale_date, units_sold")
        .eq("marketplace", marketplace)
        .in("product_code", chunk)
        .order("sale_date", { ascending: true })
        .range(from, from + pageSize - 1);

      if (uploadId) {
        query = query.eq("upload_id", uploadId);
      }

      const { data, error } = await query;
      if (error) throw new Error(getErrorMessage(error));
      const batch = (data ?? []) as DailySale[];
      merged.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
  }

  return mergeDailySalesByDate(merged);
}

async function fetchQcomLatestMetricForCodes(
  marketplace: QcomMarketplace,
  codes: string[],
  uploadId: string | null,
): Promise<ComputedMetric | null> {
  if (codes.length === 0) return null;

  let query = supabase
    .from("computed_metrics")
    .select("*")
    .eq("marketplace", marketplace)
    .in("product_code", codes)
    .order("as_of_date", { ascending: false })
    .limit(1);

  if (uploadId) {
    query = query.eq("upload_id", uploadId);
  }

  const { data, error } = await query;
  if (error) throw new Error(getErrorMessage(error));
  return ((data ?? [])[0] ?? null) as ComputedMetric | null;
}

/** Resolve catalogue row + sellout (handles ASIN vs legacy listing-only product_code). */
export async function getQcomProductMaster(
  marketplace: QcomMarketplace,
  code: string,
): Promise<ProductMaster | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const codes = await collectQcomProductCodes(marketplace, trimmed);
  const { data, error } = await supabase
    .from("product_master")
    .select("*")
    .eq("marketplace", marketplace)
    .in("product_code", codes.length ? codes : [trimmed]);
  if (error) throw new Error(getErrorMessage(error));

  const rows = (data ?? []) as ProductMaster[];
  if (rows.length === 0) {
    const { data: byListing, error: listErr } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", marketplace)
      .eq("listing_code", trimmed)
      .maybeSingle();
    if (listErr) throw new Error(getErrorMessage(listErr));
    return (byListing ?? null) as ProductMaster | null;
  }

  const asinRow = rows.find((r) => cleanAsinCode(r.product_code));
  if (asinRow) return asinRow;

  return rows.sort(
    (a, b) =>
      displayModelName(b.product_name, b.product_code).length -
      displayModelName(a.product_name, a.product_code).length,
  )[0];
}

export type QcomProductSelloutContext = {
  product: ProductMaster;
  canonicalProductCode: string;
  latestMetric: ComputedMetric | null;
  dailySales: DailySale[];
};

export async function loadQcomProductSelloutContext(
  marketplace: QcomMarketplace,
  code: string,
): Promise<QcomProductSelloutContext | null> {
  const product = await getQcomProductMaster(marketplace, code);
  if (!product) return null;

  const codes = await collectQcomProductCodes(marketplace, code);
  const canonical =
    cleanAsinCode(product.product_code) ?? product.product_code.trim();
  const selloutCodes = codes.length > 0 ? codes : [code.trim()];

  const uploadId = await getLatestQcomUploadId(marketplace);

  let [latestMetric, dailySales] = await Promise.all([
    fetchQcomLatestMetricForCodes(marketplace, selloutCodes, uploadId),
    fetchQcomDailySelloutForCodes(marketplace, selloutCodes, uploadId),
  ]);

  if (uploadId && dailySales.length === 0 && selloutCodes.length > 0) {
    dailySales = await fetchQcomDailySelloutForCodes(marketplace, selloutCodes, null);
  }
  if (uploadId && !latestMetric && selloutCodes.length > 0) {
    latestMetric = await fetchQcomLatestMetricForCodes(marketplace, selloutCodes, null);
  }

  dailySales = dedupeQcomDailySalesForCharts(dailySales, canonical);

  return {
    product,
    canonicalProductCode: canonical,
    latestMetric,
    dailySales,
  };
}

/** Paginated daily sellout for sellout/growth charts (QCom has hundreds of day columns). */
function scoreSheetMonthAnchorRows(codeRows: DailySale[]): number {
  return codeRows
    .filter((r) => /-01$/.test(r.sale_date))
    .reduce((sum, r) => sum + Number(r.units_sold ?? 0), 0);
}

/** Pick the product_code row set that matches Excel month columns (ASIN vs legacy PVID duplicate). */
export function dedupeQcomDailySalesForCharts(
  rows: DailySale[],
  preferredProductCode: string,
): DailySale[] {
  if (rows.length === 0) return rows;
  const preferred = preferredProductCode.trim();
  const byCode = new Map<string, DailySale[]>();
  for (const row of rows) {
    const list = byCode.get(row.product_code) ?? [];
    list.push(row);
    byCode.set(row.product_code, list);
  }

  if (byCode.size <= 1) {
    return rows;
  }

  let bestCode = preferred;
  let bestScore = scoreSheetMonthAnchorRows(byCode.get(preferred) ?? []);
  for (const [code, codeRows] of byCode) {
    const score = scoreSheetMonthAnchorRows(codeRows);
    if (score > bestScore) {
      bestScore = score;
      bestCode = code;
    }
  }

  return byCode.get(bestCode) ?? rows;
}

export async function getQcomProductDailySellout(
  marketplace: QcomMarketplace,
  productCode: string,
): Promise<DailySale[]> {
  const codes = await collectQcomProductCodes(marketplace, productCode);
  const canonical =
    cleanAsinCode(productCode) ??
    (await resolveQcomCanonicalProductCode(marketplace, productCode)) ??
    productCode.trim();
  const selloutCodes = codes.length > 0 ? codes : [productCode.trim()];
  const uploadId = await getLatestQcomUploadId(marketplace);
  let rows = await fetchQcomDailySelloutForCodes(marketplace, selloutCodes, uploadId);
  if (uploadId && rows.length === 0 && selloutCodes.length > 0) {
    rows = await fetchQcomDailySelloutForCodes(marketplace, selloutCodes, null);
  }
  return dedupeQcomDailySalesForCharts(rows, canonical);
}

export async function searchQcomSelloutSuggestions(
  marketplace: QcomMarketplace,
  query: string,
  limit = 12,
) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const pattern = `%${trimmed}%`;
  const { data, error } = await supabase
    .from("product_master")
    .select("product_code, product_name")
    .eq("marketplace", marketplace)
    .or(
      `product_code.ilike.${pattern},product_name.ilike.${pattern},listing_code.ilike.${pattern}`,
    )
    .limit(limit);
  if (error) throw new Error(getErrorMessage(error));

  return (data ?? []).map((row) => {
    const r = row as { product_code: string; product_name: string };
    return { productCode: r.product_code, productName: r.product_name };
  });
}

export async function findQcomProductWithMetrics(
  marketplace: QcomMarketplace,
  code: string,
): Promise<{ product: { product_code: string; product_name: string } } | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const canonical = await resolveQcomCanonicalProductCode(marketplace, trimmed);
  const lookupCode = canonical ?? trimmed;

  const { data: product, error: pErr } = await supabase
    .from("product_master")
    .select("product_code, product_name")
    .eq("marketplace", marketplace)
    .eq("product_code", lookupCode)
    .maybeSingle();
  if (pErr) throw new Error(getErrorMessage(pErr));
  if (product) {
    return { product: product as { product_code: string; product_name: string } };
  }

  const { data: byListing, error: lErr } = await supabase
    .from("product_master")
    .select("product_code, product_name")
    .eq("marketplace", marketplace)
    .eq("listing_code", trimmed)
    .maybeSingle();
  if (lErr) throw new Error(getErrorMessage(lErr));
  if (byListing) {
    return { product: byListing as { product_code: string; product_name: string } };
  }

  const { data: byName, error: nErr } = await supabase
    .from("product_master")
    .select("product_code, product_name")
    .eq("marketplace", marketplace)
    .ilike("product_name", trimmed)
    .limit(1)
    .maybeSingle();
  if (nErr) throw new Error(getErrorMessage(nErr));
  if (!byName) return null;
  return { product: byName as { product_code: string; product_name: string } };
}
