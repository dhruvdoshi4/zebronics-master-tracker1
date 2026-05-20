import { ingestParsedUpload } from "./data";
import { loadProductIdMap, lookupErpProductId } from "./product-id-map";
import { parseQcomMasterFile, type QcomParseBundle } from "./parsers-qcom";
import { supabase } from "./supabase";
import type { Marketplace, QcomMarketplace } from "./types";
import { QCOM_MARKETPLACES, isQcomMarketplace } from "./types";

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
  const bundles = await parseQcomMasterFile(file, snapshotDate);
  const uploadIds: string[] = [];

  for (const bundle of bundles) {
    const uploadId = await ingestParsedUpload({
      payload: {
        ...bundle.payload,
        products: bundle.payload.products.map((p) => ({
          ...p,
          product_name: p.product_name,
          sub_category: p.sub_category ?? "",
          category: p.category ?? "",
          brand: p.brand ?? "",
        })),
      },
      marketplace: bundle.marketplace,
      fileName: `${fileName} · ${bundle.sheetName}`,
      uploadedBy,
      snapshotDate,
    });
    uploadIds.push(uploadId);
  }

  return { bundles, uploadIds };
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
  }> = [];

  const idMap = await loadProductIdMap();

  for (const marketplace of QCOM_MARKETPLACES) {
    const { data, error } = await supabase
      .from("product_master")
      .select("product_code, product_name, category")
      .eq("marketplace", marketplace)
      .or(
        `product_code.ilike.${pattern},product_name.ilike.${pattern},category.ilike.${pattern}`,
      )
      .limit(limit);
    if (error) throw new Error(getErrorMessage(error));
    for (const row of data ?? []) {
      const r = row as {
        product_code: string;
        product_name: string;
        category: string | null;
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

export function isMarketplaceChannel(m: Marketplace): boolean {
  return isQcomMarketplace(m) || m === "amazon" || m === "flipkart";
}
