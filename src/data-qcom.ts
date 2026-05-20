import { ingestParsedUpload, type IngestProgressUpdate } from "./data";
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Upload failed.";
}

export type { IngestProgressUpdate };

const PARSE_PERCENT = 8;
const CHANNEL_PERCENT = 72;
const CONSOLIDATED_PERCENT = 10;

function reportQcomUploadProgress(
  onProgress: ((update: IngestProgressUpdate) => void) | undefined,
  message: string,
  percent: number,
) {
  onProgress?.({
    message,
    percent: Math.min(100, Math.max(0, Math.round(percent))),
  });
}

export async function ingestQcomMasterUpload({
  file,
  fileName,
  uploadedBy,
  snapshotDate,
  onProgress,
}: {
  file: File;
  fileName: string;
  uploadedBy: string;
  snapshotDate: string;
  onProgress?: (update: IngestProgressUpdate) => void;
}): Promise<{ bundles: QcomParseBundle[]; uploadIds: string[] }> {
  reportQcomUploadProgress(onProgress, "Reading workbook…", 2);

  const { channelBundles, consolidatedCatalog } = await parseQcomMasterFile(
    file,
    snapshotDate,
  );

  reportQcomUploadProgress(onProgress, "Workbook parsed.", PARSE_PERCENT);

  const uploadIds: string[] = [];
  const channelTotal = channelBundles.length;

  await Promise.all(
    channelBundles.map(async (bundle, index) => {
      const channelLabel = marketplaceLabel(bundle.marketplace);
      const span = CHANNEL_PERCENT / Math.max(channelTotal, 1);
      const startPercent = PARSE_PERCENT + index * span;

      reportQcomUploadProgress(
        onProgress,
        `Uploading ${channelLabel} (${index + 1}/${channelTotal})…`,
        startPercent,
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
        onProgress: (step) => {
          reportQcomUploadProgress(
            onProgress,
            `${channelLabel}: ${step.message}`,
            startPercent + span * 0.15,
          );
        },
      });

      uploadIds.push(uploadId);
      reportQcomUploadProgress(
        onProgress,
        `${channelLabel} complete.`,
        startPercent + span,
      );
    }),
  );

  if (consolidatedCatalog && consolidatedCatalog.payload.products.length > 0) {
    reportQcomUploadProgress(
      onProgress,
      "Saving Consolidated catalogue (HO Stock)…",
      PARSE_PERCENT + CHANNEL_PERCENT,
    );

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
      onProgress: (step) => {
        reportQcomUploadProgress(
          onProgress,
          `Consolidated: ${step.message}`,
          PARSE_PERCENT + CHANNEL_PERCENT + CONSOLIDATED_PERCENT * 0.5,
        );
      },
    });
    uploadIds.push(uploadId);
  }

  reportQcomUploadProgress(onProgress, "Upload complete.", 100);

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

function normalizeQcomStoredCode(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return "";
  return /^B0[A-Z0-9]{8,}$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

/** Resolve listing ID or ASIN to canonical product_code stored in DB (usually ASIN). */
export async function resolveQcomCanonicalProductCode(
  marketplace: QcomMarketplace,
  code: string,
): Promise<string | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  if (/^B0[A-Z0-9]{8,}$/i.test(trimmed)) return trimmed.toUpperCase();

  const stored = normalizeQcomStoredCode(trimmed);
  const { data: byCode, error: codeErr } = await supabase
    .from("product_master")
    .select("product_code")
    .eq("marketplace", marketplace)
    .eq("product_code", stored)
    .maybeSingle();
  if (codeErr) throw new Error(getErrorMessage(codeErr));
  if (byCode) return String((byCode as { product_code: string }).product_code).trim();

  const { data: byListing, error: listingErr } = await supabase
    .from("product_master")
    .select("product_code")
    .eq("marketplace", marketplace)
    .eq("listing_code", trimmed)
    .maybeSingle();
  if (listingErr) throw new Error(getErrorMessage(listingErr));
  if (byListing) return String((byListing as { product_code: string }).product_code).trim();

  return null;
}

/** Load product_master for sellout — ASIN, listing code, or partial model name. */
export async function fetchQcomProductMaster(
  marketplace: QcomMarketplace,
  code: string,
): Promise<ProductMaster | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const canonical = await resolveQcomCanonicalProductCode(marketplace, trimmed);
  if (canonical) {
    const { data, error } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", marketplace)
      .eq("product_code", normalizeQcomStoredCode(canonical))
      .maybeSingle();
    if (error) throw new Error(getErrorMessage(error));
    if (data) return data as ProductMaster;
  }

  const pattern = `%${trimmed}%`;
  const { data: byName, error: nameErr } = await supabase
    .from("product_master")
    .select("*")
    .eq("marketplace", marketplace)
    .or(`product_name.ilike.${pattern},product_code.ilike.${pattern},listing_code.ilike.${pattern}`)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (nameErr) throw new Error(getErrorMessage(nameErr));
  return (byName ?? null) as ProductMaster | null;
}

export async function getLatestQcomMetricForProduct(
  marketplace: QcomMarketplace,
  productCode: string,
): Promise<ComputedMetric | null> {
  const master = await fetchQcomProductMaster(marketplace, productCode);
  const storedCode = normalizeQcomStoredCode(master?.product_code ?? productCode);
  if (!storedCode) return null;

  const uploadId = await getLatestQcomUploadId(marketplace);
  let query = supabase
    .from("computed_metrics")
    .select("*")
    .eq("marketplace", marketplace)
    .eq("product_code", storedCode)
    .order("as_of_date", { ascending: false })
    .limit(1);
  if (uploadId) {
    query = query.eq("upload_id", uploadId);
  }
  const { data, error } = await query;
  if (error) throw new Error(getErrorMessage(error));
  return ((data ?? [])[0] ?? null) as ComputedMetric | null;
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
          .select("sale_date, units_sold")
          .eq("marketplace", marketplace)
          .eq("upload_id", uploadId)
          .in("product_code", chunk)
          .range(from, from + pageSize - 1);
        if (error) throw new Error(getErrorMessage(error));
        const batch = data ?? [];
        for (const row of batch) {
          const r = row as { sale_date: string; units_sold: unknown };
          const ym = String(r.sale_date).slice(0, 7);
          const units = Number(r.units_sold ?? 0);
          if (units <= 0) continue;
          target.set(ym, (target.get(ym) ?? 0) + units);
          bumpCombined(ym, units);
        }
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
      const prevCombined = monthlyCombined.get(ym) ?? 0;
      const prevChannel = channelMap.get(ym) ?? 0;
      channelMap.set(ym, perMonth);
      monthlyCombined.set(ym, prevCombined - prevChannel + perMonth);
    }
    monthlyByChannel[marketplace] = channelMap;
  }

  return { ...maps, monthlyByChannel, monthlyCombined };
}

export function isMarketplaceChannel(m: Marketplace): boolean {
  return isQcomMarketplace(m) || m === "amazon" || m === "flipkart";
}

async function fetchQcomDailySalesForStoredCode(
  marketplace: QcomMarketplace,
  storedCode: string,
  uploadId: string | null,
): Promise<DailySale[]> {
  const normalized = normalizeQcomStoredCode(storedCode);
  if (!normalized) return [];

  const rows: DailySale[] = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    let query = supabase
      .from("daily_sales")
      .select("marketplace, product_code, sale_date, units_sold")
      .eq("marketplace", marketplace)
      .eq("product_code", normalized)
      .order("sale_date", { ascending: true })
      .range(from, from + pageSize - 1);

    if (uploadId) {
      query = query.eq("upload_id", uploadId);
    }

    const { data, error } = await query;
    if (error) throw new Error(getErrorMessage(error));
    const batch = (data ?? []) as DailySale[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

/** Paginated daily sellout for sellout/growth charts (QCom has hundreds of day columns). */
export async function getQcomProductDailySellout(
  marketplace: QcomMarketplace,
  productCode: string,
): Promise<DailySale[]> {
  const trimmed = productCode.trim();
  if (!trimmed) return [];

  const uploadId = await getLatestQcomUploadId(marketplace);
  const master = await fetchQcomProductMaster(marketplace, trimmed);
  const codesToTry = [
    master?.product_code,
    /^B0[A-Z0-9]{8,}$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed,
    master?.listing_code ?? null,
  ].filter((value): value is string => Boolean(String(value ?? "").trim()));

  const seen = new Set<string>();
  for (const code of codesToTry) {
    const key = normalizeQcomStoredCode(code);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const rows = await fetchQcomDailySalesForStoredCode(marketplace, key, uploadId);
    if (rows.length > 0) return rows;
  }

  return [];
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
  const master = await fetchQcomProductMaster(marketplace, code);
  if (!master) return null;
  return {
    product: {
      product_code: master.product_code,
      product_name: master.product_name,
    },
  };
}
