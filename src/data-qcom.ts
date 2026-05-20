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

export async function loadQcomCategoryMonthlyTotals(
  category: string,
): Promise<Map<string, QcomCategoryChannelTotals>> {
  const monthMap = new Map<string, QcomCategoryChannelTotals>();
  const cat = category.trim();
  if (!cat) return monthMap;

  for (const marketplace of QCOM_MARKETPLACES) {
    const { data: products, error: pErr } = await supabase
      .from("product_master")
      .select("product_code")
      .eq("marketplace", marketplace)
      .eq("category", cat);
    if (pErr) throw new Error(getErrorMessage(pErr));
    const codes = (products ?? []).map((p) => (p as { product_code: string }).product_code);
    if (codes.length === 0) continue;

    for (const chunk of chunkCodes(codes)) {
      const { data: sales, error: sErr } = await supabase
        .from("daily_sales")
        .select("sale_date, units_sold")
        .eq("marketplace", marketplace)
        .in("product_code", chunk);
      if (sErr) throw new Error(getErrorMessage(sErr));
      for (const row of sales ?? []) {
        const sale = row as { sale_date: string; units_sold: number };
        const monthYm = sale.sale_date.slice(0, 7);
        const entry = monthMap.get(monthYm) ?? {
          zepto: 0,
          blinkit: 0,
          bigbasket: 0,
          instamart: 0,
        };
        entry[marketplace] += Number(sale.units_sold ?? 0);
        monthMap.set(monthYm, entry);
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
