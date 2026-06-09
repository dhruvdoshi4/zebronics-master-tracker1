import type { CatalogWorkspace } from "./catalog-workspace";
import { getLatestUploadContextByMarketplace } from "./data";
import { rowBelongsToManagerDashboard } from "./manager-dashboard-scope";
import type { ParsedProductPricingPayload, ParsedProductPricingRow } from "./parsers-pricing";
import {
  computeProductPricingChannel,
  normalizePricingInputs,
  roundPricingInr,
} from "./pricing";
import {
  indexPricingScopeDefaults,
  resolvePricingScopeForProduct,
  type PricingScopeDefaultRecord,
  type PricingScopeLevel,
} from "./pricing-scope";
import { supabase } from "./supabase";
import type { LegacyMarketplace, ProductMaster } from "./types";
import { isLegacyMarketplace } from "./types";

export type ProductPricingRecord = {
  marketplace: LegacyMarketplace;
  product_code: string;
  catalog_workspace: string | null;
  bau_sp: number;
  bau_margin_pct: number;
  event_sp: number;
  event_margin_pct: number;
  is_flat_price: boolean;
  top_up_ibd: number;
  net_real_factor: number | null;
  coupon_value: number | null;
  coupon_support_pct: number | null;
  upload_id: string | null;
  updated_at: string;
};

export type ProductPricingView = ProductPricingRecord & {
  basic_sp: number;
  event_basic: number;
  basic_support_pu: number;
  base_ibd: number;
  top_up_ibd_support: number;
  nep: number;
  net_realisation: number;
  coupon_deduction: number;
  /** Effective resolved values (after scope cascade). */
  resolved_net_real_factor: number;
  resolved_coupon_value: number;
  resolved_coupon_support_pct: number;
};

export type { PricingScopeDefaultRecord, PricingScopeLevel } from "./pricing-scope";

const PRICING_SELECT_COLS =
  "marketplace, product_code, catalog_workspace, bau_sp, bau_margin_pct, event_sp, event_margin_pct, is_flat_price, top_up_ibd, net_real_factor, coupon_value, coupon_support_pct, upload_id, updated_at";

export type ProductMasterPricingRow = ProductMaster & {
  pricing: ProductPricingView;
  drr_units: number;
  atp_units: number;
  ho_stock_units: number;
  sellout_as_of?: string | null;
  ho_stock_as_of?: string | null;
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

function pricingKey(marketplace: LegacyMarketplace, productCode: string): string {
  return `${marketplace}:${productCode}`;
}

export function enrichProductPricingView(
  record: ProductPricingRecord,
  product: Pick<ProductMaster, "category" | "sub_category">,
  scopeDefaults: Map<string, PricingScopeDefaultRecord>,
  catalogWorkspace: CatalogWorkspace,
): ProductPricingView {
  const resolved = resolvePricingScopeForProduct(
    product,
    record.marketplace,
    {
      net_real_factor: record.net_real_factor,
      coupon_value: record.coupon_value,
      coupon_support_pct: record.coupon_support_pct,
    },
    scopeDefaults,
    catalogWorkspace,
  );
  const computed = computeProductPricingChannel(
    record.marketplace,
    {
      bau_sp: record.bau_sp,
      bau_margin_pct: record.bau_margin_pct,
      event_sp: record.event_sp,
      event_margin_pct: record.event_margin_pct,
      is_flat_price: record.is_flat_price,
      top_up_ibd: record.top_up_ibd,
    },
    {
      net_real_factor: resolved.net_real_factor,
      coupon_value: resolved.coupon_value,
      coupon_support_pct: resolved.coupon_support_pct,
    },
  );
  return {
    ...record,
    ...computed,
    resolved_net_real_factor: resolved.net_real_factor,
    resolved_coupon_value: resolved.coupon_value,
    resolved_coupon_support_pct: resolved.coupon_support_pct,
  };
}

export async function getPricingScopeDefaults(
  catalogWorkspace: CatalogWorkspace,
): Promise<PricingScopeDefaultRecord[]> {
  const { data, error } = await supabase
    .from("pricing_scope_defaults")
    .select(
      "catalog_workspace, marketplace, scope_level, scope_key, net_real_factor, coupon_value, coupon_support_pct, updated_at",
    )
    .eq("catalog_workspace", catalogWorkspace);

  if (error) {
    if (isMissingSchemaError(error, "pricing_scope_defaults")) return [];
    throw new Error(getErrorMessage(error));
  }
  return (data ?? []) as PricingScopeDefaultRecord[];
}

export type PricingScopeDefaultsPatch = {
  net_real_factor?: number | null;
  coupon_support_pct?: number | null;
};

export async function savePricingScopeDefaults({
  catalogWorkspace,
  marketplace,
  scopeLevel,
  scopeKey,
  patch,
}: {
  catalogWorkspace: CatalogWorkspace;
  marketplace: LegacyMarketplace | "all";
  scopeLevel: PricingScopeLevel;
  scopeKey: string;
  patch: PricingScopeDefaultsPatch;
}): Promise<PricingScopeDefaultRecord> {
  const row = {
    catalog_workspace: catalogWorkspace,
    marketplace,
    scope_level: scopeLevel,
    scope_key: scopeKey,
    net_real_factor: patch.net_real_factor ?? null,
    coupon_value: null,
    coupon_support_pct: patch.coupon_support_pct ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("pricing_scope_defaults")
    .upsert(row, {
      onConflict: "catalog_workspace,marketplace,scope_level,scope_key",
    })
    .select(
      "catalog_workspace, marketplace, scope_level, scope_key, net_real_factor, coupon_value, coupon_support_pct, updated_at",
    )
    .single();

  if (error) {
    if (isMissingSchemaError(error, "pricing_scope_defaults")) {
      throw new Error(
        "Table pricing_scope_defaults is missing. Run supabase/run-product-pricing.sql in Supabase SQL Editor.",
      );
    }
    throw new Error(getErrorMessage(error));
  }
  return data as PricingScopeDefaultRecord;
}

export { indexPricingScopeDefaults, resolvePricingScopeForProduct };

export async function getProductPricingForCodes(
  marketplace: LegacyMarketplace,
  codes: string[],
  productsByCode: Map<string, Pick<ProductMaster, "category" | "sub_category">>,
  scopeDefaults: Map<string, PricingScopeDefaultRecord>,
  catalogWorkspace: CatalogWorkspace,
): Promise<Map<string, ProductPricingView>> {
  const map = new Map<string, ProductPricingView>();
  if (codes.length === 0) return map;

  const unique = [...new Set(codes.filter(Boolean))];
  const { data, error } = await supabase
    .from("product_pricing")
    .select(PRICING_SELECT_COLS)
    .eq("marketplace", marketplace)
    .in("product_code", unique);

  if (error) {
    if (isMissingSchemaError(error, "product_pricing")) return map;
    throw new Error(getErrorMessage(error));
  }

  for (const row of (data ?? []) as ProductPricingRecord[]) {
    if (!isLegacyMarketplace(row.marketplace)) continue;
    const product = productsByCode.get(row.product_code) ?? {
      category: null,
      sub_category: null,
    };
    map.set(
      row.product_code,
      enrichProductPricingView(row, product, scopeDefaults, catalogWorkspace),
    );
  }
  return map;
}

function productInUploadScope(
  product: Pick<
    ProductMaster,
    "marketplace" | "product_code" | "category" | "sub_category" | "product_name" | "catalog_workspace"
  >,
  catalogWorkspace: CatalogWorkspace,
): boolean {
  if (!isLegacyMarketplace(product.marketplace)) return false;
  return rowBelongsToManagerDashboard(product, {
    catalogWorkspace,
    marketplace: product.marketplace,
  });
}

function buildPricingUpsertRows(
  sheetRow: ParsedProductPricingRow,
  products: Array<
    Pick<
      ProductMaster,
      | "marketplace"
      | "product_code"
      | "category"
      | "sub_category"
      | "product_name"
      | "catalog_workspace"
    >
  >,
  catalogWorkspace: CatalogWorkspace,
  uploadId: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const exclusivity = sheetRow.exclusivity;

  for (const product of products) {
    if (!productInUploadScope(product, catalogWorkspace)) continue;
    if (exclusivity === "amazon" && product.marketplace !== "amazon") continue;
    if (exclusivity === "flipkart" && product.marketplace !== "flipkart") continue;

    const isAmazon = product.marketplace === "amazon";
    const asinMatch = sheetRow.asin && product.product_code === sheetRow.asin.trim();
    const fsnMatch =
      sheetRow.fsn && product.product_code === sheetRow.fsn.trim().toUpperCase();
    if (!asinMatch && !fsnMatch) continue;

    const normalized = normalizePricingInputs({
      bau_sp: sheetRow.bau_sp,
      bau_margin_pct: isAmazon ? sheetRow.bau_margin_amazon : sheetRow.bau_margin_flipkart,
      event_sp: sheetRow.event_sp,
      event_margin_pct: isAmazon
        ? sheetRow.event_margin_amazon
        : sheetRow.event_margin_flipkart,
      is_flat_price: sheetRow.is_flat_price,
      top_up_ibd: sheetRow.top_up_ibd,
    });

    out.push({
      marketplace: product.marketplace,
      product_code: product.product_code,
      catalog_workspace: catalogWorkspace,
      bau_sp: roundPricingInr(normalized.bau_sp),
      bau_margin_pct: normalized.bau_margin_pct,
      event_sp: roundPricingInr(normalized.event_sp),
      event_margin_pct: normalized.event_margin_pct,
      is_flat_price: normalized.is_flat_price,
      top_up_ibd: roundPricingInr(normalized.top_up_ibd),
      upload_id: uploadId,
      updated_at: new Date().toISOString(),
    });
  }

  return out;
}

async function insertPricingUploadRow({
  fileName,
  uploadedBy,
  catalogWorkspace,
  rawRowCount,
  validRowCount,
}: {
  fileName: string;
  uploadedBy: string;
  catalogWorkspace: CatalogWorkspace;
  rawRowCount: number;
  validRowCount: number;
}): Promise<string> {
  const row: Record<string, unknown> = {
    marketplace: "amazon",
    file_name: fileName,
    uploaded_by: uploadedBy,
    snapshot_date: new Date().toISOString().slice(0, 10),
    status: "processing",
    upload_kind: "bau",
    catalog_workspace: catalogWorkspace,
    raw_row_count: rawRowCount,
    valid_row_count: validRowCount,
    rejected_row_count: 0,
    notes: `Product pricing BAU (${catalogWorkspace})`,
  };

  let { data, error } = await supabase.from("uploads").insert(row).select("id").single();
  if (error) {
    const { catalog_workspace: _cw, ...withoutWs } = row;
    void _cw;
    const retry = await supabase.from("uploads").insert(withoutWs).select("id").single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw new Error(getErrorMessage(error));
  return String(data!.id);
}

async function loadProductsForPricingRows(
  rows: ParsedProductPricingRow[],
): Promise<
  Array<
    Pick<
      ProductMaster,
      | "marketplace"
      | "product_code"
      | "category"
      | "sub_category"
      | "product_name"
      | "catalog_workspace"
    >
  >
> {
  const asins = [...new Set(rows.map((r) => r.asin?.trim()).filter(Boolean) as string[])];
  const fsns = [
    ...new Set(rows.map((r) => r.fsn?.trim().toUpperCase()).filter(Boolean) as string[]),
  ];
  const names = [...new Set(rows.map((r) => r.product_name.trim()).filter(Boolean))];

  const products: Array<
    Pick<
      ProductMaster,
      | "marketplace"
      | "product_code"
      | "category"
      | "sub_category"
      | "product_name"
      | "catalog_workspace"
    >
  > = [];

  const selectCols =
    "marketplace, product_code, category, sub_category, product_name, catalog_workspace";

  if (asins.length > 0) {
    const { data, error } = await supabase
      .from("product_master")
      .select(selectCols)
      .eq("marketplace", "amazon")
      .in("product_code", asins);
    if (error) throw new Error(getErrorMessage(error));
    products.push(...((data ?? []) as typeof products));
  }

  if (fsns.length > 0) {
    const { data, error } = await supabase
      .from("product_master")
      .select(selectCols)
      .eq("marketplace", "flipkart")
      .in("product_code", fsns);
    if (error) throw new Error(getErrorMessage(error));
    products.push(...((data ?? []) as typeof products));
  }

  const missingNames = names.filter(
    (name) => !products.some((p) => p.product_name?.trim() === name),
  );
  if (missingNames.length > 0) {
    const { data, error } = await supabase
      .from("product_master")
      .select(selectCols)
      .in("product_name", missingNames.slice(0, 80));
    if (error) throw new Error(getErrorMessage(error));
    for (const raw of data ?? []) {
      const p = raw as (typeof products)[number];
      if (!isLegacyMarketplace(p.marketplace)) continue;
      const mp: LegacyMarketplace = p.marketplace;
      if (
        !products.some((x) => {
          if (!isLegacyMarketplace(x.marketplace)) return false;
          return (
            pricingKey(x.marketplace, x.product_code) === pricingKey(mp, p.product_code)
          );
        })
      ) {
        products.push(p);
      }
    }
  }

  return products.filter((p) => isLegacyMarketplace(p.marketplace));
}

/**
 * Ingest manager-scoped BAU pricing. SKUs in file are overwritten; SKUs not in file are untouched.
 * Does not affect GMS benchmark (`product_bau_benchmark`) — that stays on existing ingestBauUpload.
 */
export async function ingestProductPricingUpload({
  payload,
  fileName,
  uploadedBy,
  catalogWorkspace,
}: {
  payload: ParsedProductPricingPayload;
  fileName: string;
  uploadedBy: string;
  catalogWorkspace: CatalogWorkspace;
}): Promise<{ uploadId: string; skuCount: number }> {
  if (payload.rows.length === 0) {
    throw new Error("No pricing rows found in BAU sheet.");
  }

  const products = await loadProductsForPricingRows(payload.rows);
  const uploadId = await insertPricingUploadRow({
    fileName,
    uploadedBy,
    catalogWorkspace,
    rawRowCount: payload.rows.length,
    validRowCount: 0,
  });

  const deduped = new Map<string, Record<string, unknown>>();
  for (const sheetRow of payload.rows) {
    const matches = products.filter((p) => {
      const asinMatch = sheetRow.asin && p.product_code === sheetRow.asin.trim();
      const fsnMatch =
        sheetRow.fsn && p.product_code === sheetRow.fsn.trim().toUpperCase();
      const nameMatch =
        sheetRow.product_name &&
        p.product_name?.trim() === sheetRow.product_name.trim();
      return Boolean(asinMatch || fsnMatch || nameMatch);
    });

    for (const upsert of buildPricingUpsertRows(sheetRow, matches, catalogWorkspace, uploadId)) {
      deduped.set(
        pricingKey(upsert.marketplace as LegacyMarketplace, String(upsert.product_code)),
        upsert,
      );
    }
  }

  const expanded = [...deduped.values()];
  if (expanded.length === 0) {
    await supabase
      .from("uploads")
      .update({
        status: "failed",
        notes: "No in-scope SKUs matched Product Master. Upload sellout first.",
      })
      .eq("id", uploadId);
    throw new Error(
      "No in-scope SKUs matched. Upload sellout for this workspace first, then re-upload BAU pricing.",
    );
  }

  try {
    const { upsertSupabaseParallel } = await import("./xlsx-fast");
    await upsertSupabaseParallel("product_pricing", expanded, "marketplace,product_code", {
      batchSize: 500,
      concurrency: 4,
    });
  } catch (e: unknown) {
    await supabase
      .from("uploads")
      .update({
        status: "failed",
        notes: `Pricing upload failed: ${getErrorMessage(e)}`,
      })
      .eq("id", uploadId);
    if (isMissingSchemaError(e, "product_pricing")) {
      throw new Error(
        "Table product_pricing is missing. Run supabase/run-product-pricing.sql in Supabase SQL Editor, then upload again.",
        { cause: e },
      );
    }
    throw e;
  }

  await supabase
    .from("uploads")
    .update({
      status: "completed",
      valid_row_count: expanded.length,
      notes: `Pricing: ${payload.rows.length} sheet rows → ${expanded.length} SKU rows (${catalogWorkspace})`,
    })
    .eq("id", uploadId);

  return { uploadId, skuCount: expanded.length };
}

export type ProductPricingEditablePatch = {
  bau_sp?: number;
  bau_margin_pct?: number;
  event_sp?: number;
  event_margin_pct?: number;
  is_flat_price?: boolean;
  top_up_ibd?: number;
  /** null clears SKU override → inherit scope default. */
  net_real_factor?: number | null;
  coupon_value?: number | null;
  coupon_support_pct?: number | null;
};

export async function saveProductPricingEdit({
  marketplace,
  productCode,
  patch,
  catalogWorkspace,
  product,
}: {
  marketplace: LegacyMarketplace;
  productCode: string;
  patch: ProductPricingEditablePatch;
  catalogWorkspace: CatalogWorkspace;
  product: Pick<
    ProductMaster,
    "category" | "sub_category" | "product_name" | "catalog_workspace" | "marketplace" | "product_code"
  >;
}): Promise<ProductPricingView> {
  if (!productInUploadScope(product, catalogWorkspace)) {
    throw new Error("This SKU is outside your catalog workspace.");
  }

  const { data: existing, error: readErr } = await supabase
    .from("product_pricing")
    .select(PRICING_SELECT_COLS)
    .eq("marketplace", marketplace)
    .eq("product_code", productCode)
    .maybeSingle();

  if (readErr && !isMissingSchemaError(readErr, "product_pricing")) {
    throw new Error(getErrorMessage(readErr));
  }

  const base: ProductPricingRecord = (existing as ProductPricingRecord | null) ?? {
    marketplace,
    product_code: productCode,
    catalog_workspace: catalogWorkspace,
    bau_sp: 0,
    bau_margin_pct: 0,
    event_sp: 0,
    event_margin_pct: 0,
    is_flat_price: false,
    top_up_ibd: 0,
    net_real_factor: null,
    coupon_value: null,
    coupon_support_pct: null,
    upload_id: null,
    updated_at: new Date().toISOString(),
  };

  const normalized = normalizePricingInputs({
    bau_sp: patch.bau_sp !== undefined ? roundPricingInr(patch.bau_sp) : base.bau_sp,
    bau_margin_pct:
      patch.bau_margin_pct !== undefined ? patch.bau_margin_pct : base.bau_margin_pct,
    event_sp: patch.event_sp !== undefined ? roundPricingInr(patch.event_sp) : base.event_sp,
    event_margin_pct:
      patch.event_margin_pct !== undefined ? patch.event_margin_pct : base.event_margin_pct,
    is_flat_price: patch.is_flat_price !== undefined ? patch.is_flat_price : base.is_flat_price,
    top_up_ibd:
      patch.top_up_ibd !== undefined ? roundPricingInr(patch.top_up_ibd) : base.top_up_ibd,
  });

  const next: ProductPricingRecord = {
    ...base,
    catalog_workspace: catalogWorkspace,
    ...normalized,
    net_real_factor:
      patch.net_real_factor !== undefined ? patch.net_real_factor : base.net_real_factor,
    coupon_value: patch.coupon_value !== undefined ? patch.coupon_value : base.coupon_value,
    coupon_support_pct:
      patch.coupon_support_pct !== undefined
        ? patch.coupon_support_pct
        : base.coupon_support_pct,
    updated_at: new Date().toISOString(),
  };

  const { error: writeErr } = await supabase.from("product_pricing").upsert(
    {
      marketplace: next.marketplace,
      product_code: next.product_code,
      catalog_workspace: next.catalog_workspace,
      bau_sp: next.bau_sp,
      bau_margin_pct: next.bau_margin_pct,
      event_sp: next.event_sp,
      event_margin_pct: next.event_margin_pct,
      is_flat_price: next.is_flat_price,
      top_up_ibd: next.top_up_ibd,
      net_real_factor: next.net_real_factor,
      coupon_value: next.coupon_value,
      coupon_support_pct: next.coupon_support_pct,
      updated_at: next.updated_at,
    },
    { onConflict: "marketplace,product_code" },
  );

  if (writeErr) {
    if (isMissingSchemaError(writeErr, "product_pricing")) {
      throw new Error(
        "Table product_pricing is missing. Run supabase/run-product-pricing.sql in Supabase SQL Editor.",
      );
    }
    throw new Error(getErrorMessage(writeErr));
  }

  const scopeRows = await getPricingScopeDefaults(catalogWorkspace);
  const scopeMap = indexPricingScopeDefaults(scopeRows);
  return enrichProductPricingView(next, product, scopeMap, catalogWorkspace);
}

export type PricingSupplementalMetrics = {
  drr_units: number;
  atp_units: number;
  ho_stock_units: number;
  sellout_as_of: string | null;
  ho_stock_as_of: string | null;
};

/** DRR + ATP from latest sellout upload for workspace; HO from latest stock report. */
export async function getPricingSupplementalMetrics(
  marketplace: LegacyMarketplace,
  products: Array<Pick<ProductMaster, "product_code" | "product_name">>,
  catalogWorkspace: CatalogWorkspace,
): Promise<Map<string, PricingSupplementalMetrics>> {
  const map = new Map<string, PricingSupplementalMetrics>();
  if (products.length === 0) return map;

  const codes = products.map((p) => p.product_code);
  const metricsByCode = new Map<string, { drr: number; atp: number }>();
  let selloutAsOf: string | null = null;

  const uploadCtx = await getLatestUploadContextByMarketplace(catalogWorkspace);
  const channelCtx = marketplace === "amazon" ? uploadCtx.amazon : uploadCtx.flipkart;
  selloutAsOf = channelCtx?.snapshotDate ?? null;

  if (channelCtx?.id) {
    for (let i = 0; i < codes.length; i += 100) {
      const chunk = codes.slice(i, i + 100);
      const { data, error } = await supabase
        .from("computed_metrics")
        .select("product_code, drr_units, inventory_units")
        .eq("marketplace", marketplace)
        .eq("upload_id", channelCtx.id)
        .in("product_code", chunk);
      if (error) {
        if (!isMissingSchemaError(error, "computed_metrics")) {
          throw new Error(getErrorMessage(error));
        }
        continue;
      }
      for (const row of data ?? []) {
        const code = String((row as { product_code: string }).product_code);
        metricsByCode.set(code, {
          drr: Number((row as { drr_units?: number }).drr_units ?? 0),
          atp: Number((row as { inventory_units?: number }).inventory_units ?? 0),
        });
      }
    }
  }

  const hoByKey = new Map<string, number>();
  let hoStockAsOf: string | null = null;
  try {
    const { getLatestHoStockUpload } = await import("./data-ho-stock");
    const upload = await getLatestHoStockUpload();
    hoStockAsOf = upload?.snapshot_date ?? null;
    if (upload) {
      const { data: hoRows, error: hoErr } = await supabase
        .from("ho_stock_snapshot")
        .select("asin, fsn, ho_units")
        .eq("upload_id", upload.id);
      if (!hoErr) {
        for (const row of hoRows ?? []) {
          const asin = String((row as { asin?: string }).asin ?? "").trim().toUpperCase();
          const fsn = String((row as { fsn?: string }).fsn ?? "").trim().toUpperCase();
          const ho = Number((row as { ho_units?: number }).ho_units ?? 0);
          if (asin) hoByKey.set(`amazon:${asin}`, ho);
          if (fsn) hoByKey.set(`flipkart:${fsn}`, ho);
        }
      }
    }
  } catch {
    // HO stock optional
  }

  for (const product of products) {
    const m = metricsByCode.get(product.product_code) ?? { drr: 0, atp: 0 };
    const hoKey = `${marketplace}:${product.product_code}`;
    map.set(product.product_code, {
      drr_units: m.drr,
      atp_units: m.atp,
      ho_stock_units: hoByKey.get(hoKey) ?? 0,
      sellout_as_of: selloutAsOf,
      ho_stock_as_of: hoStockAsOf,
    });
  }

  return map;
}
