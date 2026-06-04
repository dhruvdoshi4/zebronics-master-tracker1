import { ADMIN_MANAGER_WORKSPACES } from "./admin-realm";
import {
  CATALOG_WORKSPACE_HOME_AUDIO,
  CATALOG_WORKSPACE_MONITOR,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_PRAVIN,
  CATALOG_WORKSPACE_RITHIKA,
  type CatalogWorkspace,
} from "./catalog-workspace";
import {
  isMonitorAccessorySheetCategory,
  isProjectorAccessorySheetCategory,
} from "./hari-dashboard-scope";
import { isCartridgeSheetCategory } from "./sellout-category-scope";
import { isPravinPowerBankSubCategory } from "./pravin-category-scope";
import {
  isPersonalAudioSheetCategory,
  isRishabhHomeAudioSheetCategory,
} from "./rishabh-category-scope";
import type {
  CategoryMonthlySelloutInput,
  LegacyMarketplace,
  MetricInput,
  ParsedUploadPayload,
} from "./types";
import { normalizeKey } from "./utils";

function mergeMetricInputs(existing: MetricInput, incoming: MetricInput): MetricInput {
  return {
    ...existing,
    inventory_units: Math.max(existing.inventory_units, incoming.inventory_units),
    total_so_units: Math.max(existing.total_so_units, incoming.total_so_units),
    may_mtd_units: existing.may_mtd_units + incoming.may_mtd_units,
    apr_so_units: existing.apr_so_units + incoming.apr_so_units,
    prior_year_mtd_units: Math.max(
      existing.prior_year_mtd_units ?? 0,
      incoming.prior_year_mtd_units ?? 0,
    ),
    prior_fy_so_units:
      (existing.prior_fy_so_units ?? 0) + (incoming.prior_fy_so_units ?? 0),
    current_fy_so_units:
      (existing.current_fy_so_units ?? 0) + (incoming.current_fy_so_units ?? 0),
    drr_units: incoming.drr_units || existing.drr_units,
    drr_28d_avg_units: incoming.drr_28d_avg_units || existing.drr_28d_avg_units,
    doc_days_excel: incoming.doc_days_excel ?? existing.doc_days_excel,
  };
}

function mergeCategoryMonthlyRows(
  a: CategoryMonthlySelloutInput,
  b: CategoryMonthlySelloutInput,
): CategoryMonthlySelloutInput {
  return {
    ...a,
    units_sold: a.units_sold + b.units_sold,
  };
}

function mergePravinPowerBankAmazonMonthTotals(
  base: Record<string, number> | undefined,
  extra: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!base && !extra) return undefined;
  const out: Record<string, number> = { ...(base ?? {}) };
  for (const [ym, units] of Object.entries(extra ?? {})) {
    out[ym] = (out[ym] ?? 0) + Number(units ?? 0);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mergePravinAmazonCocobluProductCodes(
  base: string[] | undefined,
  extra: string[] | undefined,
): string[] | undefined {
  const set = new Set([...(base ?? []), ...(extra ?? [])]);
  const out = [...set].map((c) => c.trim()).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

/** Merge Pravin Cocoblu / Click_tect parse into an existing manager payload (extra wins on product tags). */
export function mergeParsedUploadPayloads(
  base: ParsedUploadPayload | undefined,
  extra: ParsedUploadPayload,
): ParsedUploadPayload {
  if (!base) return extra;

  const productByCode = new Map(base.products.map((p) => [p.product_code, p]));
  for (const p of extra.products) {
    productByCode.set(p.product_code, p);
  }

  const metricByCode = new Map(base.metricInputs.map((m) => [m.product_code, m]));
  for (const m of extra.metricInputs) {
    const prev = metricByCode.get(m.product_code);
    metricByCode.set(m.product_code, prev ? mergeMetricInputs(prev, m) : m);
  }

  const dailyByKey = new Map(
    base.dailySales.map((d) => [`${d.product_code}\0${d.sale_date}`, d]),
  );
  for (const d of extra.dailySales) {
    const key = `${d.product_code}\0${d.sale_date}`;
    const prev = dailyByKey.get(key);
    if (prev) {
      dailyByKey.set(key, {
        ...prev,
        units_sold: prev.units_sold + d.units_sold,
      });
    } else {
      dailyByKey.set(key, d);
    }
  }

  const monthlyByKey = new Map(
    base.categoryMonthlySellout.map((r) => [
      `${r.sub_category}\0${r.month_ym}`,
      r,
    ]),
  );
  for (const r of extra.categoryMonthlySellout) {
    const key = `${r.sub_category}\0${r.month_ym}`;
    const prev = monthlyByKey.get(key);
    monthlyByKey.set(key, prev ? mergeCategoryMonthlyRows(prev, r) : r);
  }

  const products = [...productByCode.values()];
  return {
    products,
    metricInputs: [...metricByCode.values()],
    dailySales: [...dailyByKey.values()],
    categoryMonthlySellout: [...monthlyByKey.values()],
    errors: [...base.errors, ...extra.errors],
    rawCount: base.rawCount + extra.rawCount,
    validCount: base.validCount + extra.validCount,
    ignoredCount: base.ignoredCount + extra.ignoredCount,
    cartridgeRowCount: base.cartridgeRowCount + extra.cartridgeRowCount,
    flipkartEolModelNames: [
      ...new Set([...base.flipkartEolModelNames, ...extra.flipkartEolModelNames]),
    ],
    flipkartEolFsns: [...new Set([...base.flipkartEolFsns, ...extra.flipkartEolFsns])],
    channelLatestDaySellout:
      extra.channelLatestDaySellout ?? base.channelLatestDaySellout,
    sheetCategoryKpis: extra.sheetCategoryKpis ?? base.sheetCategoryKpis,
    pravinPowerBankAmazonMonthTotals: mergePravinPowerBankAmazonMonthTotals(
      base.pravinPowerBankAmazonMonthTotals,
      extra.pravinPowerBankAmazonMonthTotals,
    ),
    pravinAmazonCocobluProductCodes: mergePravinAmazonCocobluProductCodes(
      base.pravinAmazonCocobluProductCodes,
      extra.pravinAmazonCocobluProductCodes,
    ),
    pravinPowerBankAmazonSheetKpis:
      extra.pravinPowerBankAmazonSheetKpis ?? base.pravinPowerBankAmazonSheetKpis,
  };
}

export const ADMIN_CONSOLIDATED_AMAZON_UPLOAD_VALUE = "__consolidated_amazon__" as const;

export type AdminConsolidatedSelloutRow = {
  category: string;
  sub_category: string;
  product_name: string;
  kam?: string;
  brand?: string;
};

/** Rows that must not ingest into any Marketplace_Global manager workspace. */
export function isConsolidatedExcludedCategory(category: string | null | undefined): boolean {
  const c = normalizeKey(String(category ?? "").trim());
  if (!c) return true;
  if (c === "na" || c === "n a" || c === "#n/a" || c === "#na" || c === "n/a") return true;
  if (c === "laptop" || c === "laptops" || c.startsWith("laptop ")) return true;
  return false;
}

export function isConsolidatedDawgBrand(brand: string | null | undefined): boolean {
  const b = normalizeKey(String(brand ?? "").trim());
  if (!b) return false;
  return /\bdawg\b/.test(b) || b.includes("da wg");
}

/** Gaming - daWg category or Brand daWg — never routed to Hari/Karan/etc. */
export function isConsolidatedDawgRow(
  category: string,
  brand: string,
): boolean {
  if (isConsolidatedDawgBrand(brand)) return true;
  return normalizeKey(category) === normalizeKey("Gaming - daWg");
}

function isPravinConsolidatedCategory(category: string): boolean {
  const c = normalizeKey(category);
  if (c === "roma") return true;
  return isPravinPowerBankSubCategory("", category);
}

function isRithikaConsolidatedCategory(category: string): boolean {
  const c = normalizeKey(category);
  if (!c || isConsolidatedDawgRow(category, "")) return false;
  if (c.includes("gaming") && c.includes("dawg")) return false;
  return (
    c.includes("it accessor") ||
    c.includes("complete it") ||
    c === "pc" ||
    c.includes("gaming") ||
    c.includes("component")
  );
}

function isKaranConsolidatedCategory(category: string, brand: string): boolean {
  if (isConsolidatedDawgBrand(brand)) return false;
  const c = normalizeKey(category);
  if (isPersonalAudioSheetCategory(category)) return true;
  if (c === "audio") return true;
  if (
    c === "home automation" ||
    c.includes("smart home") ||
    (c.includes("automation") && !c.includes("automobile"))
  ) {
    return true;
  }
  if (c === "misc" || c === "miscellaneous") return true;
  return false;
}

function isHariConsolidatedCategory(category: string): boolean {
  if (isCartridgeSheetCategory(category)) return true;
  if (isMonitorAccessorySheetCategory(category)) return true;
  if (isProjectorAccessorySheetCategory(category)) return true;
  return false;
}

/**
 * Consolidated Amazon Ecom Sellout: route by **Category** column only.
 * Excludes NA / #N/A / Laptop, Gaming - daWg, and Brand daWg.
 */
export function resolveAdminConsolidatedCatalogWorkspace(
  row: AdminConsolidatedSelloutRow,
  _marketplace: LegacyMarketplace,
): CatalogWorkspace | null {
  const category = String(row.category ?? "").trim();
  const brand = String(row.brand ?? "").trim();

  if (isConsolidatedExcludedCategory(category)) return null;
  if (isConsolidatedDawgRow(category, brand)) return null;

  if (isPravinConsolidatedCategory(category)) return CATALOG_WORKSPACE_PRAVIN;
  if (isHariConsolidatedCategory(category)) return CATALOG_WORKSPACE_MONITOR;
  if (isRishabhHomeAudioSheetCategory(category)) return CATALOG_WORKSPACE_HOME_AUDIO;
  if (isKaranConsolidatedCategory(category, brand)) return CATALOG_WORKSPACE_PERSONAL_AUDIO;
  if (isRithikaConsolidatedCategory(category)) return CATALOG_WORKSPACE_RITHIKA;

  return null;
}

export function splitAdminConsolidatedPayload(
  payload: ParsedUploadPayload,
  adminWorkspaceByMapKey: Record<string, string>,
  marketplace: LegacyMarketplace,
): Map<CatalogWorkspace, ParsedUploadPayload> {
  const result = new Map<CatalogWorkspace, ParsedUploadPayload>();

  for (const workspace of ADMIN_MANAGER_WORKSPACES) {
    const mapKeysForWorkspace = new Set(
      Object.entries(adminWorkspaceByMapKey)
        .filter(([, ws]) => ws === workspace)
        .map(([key]) => key),
    );
    const products = payload.products.filter((product) =>
      mapKeysForWorkspace.has(`${marketplace}:${product.product_code}`),
    );
    if (products.length === 0) continue;

    const codes = new Set(products.map((p) => p.product_code));
    const subs = new Set(
      products.map((p) => String(p.sub_category ?? "").trim()).filter(Boolean),
    );

    result.set(workspace, {
      products,
      metricInputs: payload.metricInputs.filter((m) => codes.has(m.product_code)),
      dailySales: payload.dailySales.filter((d) => codes.has(d.product_code)),
      categoryMonthlySellout: payload.categoryMonthlySellout.filter((row) =>
        subs.has(String(row.sub_category ?? "").trim()),
      ),
      errors: payload.errors,
      rawCount: products.length,
      validCount: products.length,
      ignoredCount: 0,
      cartridgeRowCount: products.filter(
        (p) => String(p.category ?? "").toLowerCase() === "cartridge",
      ).length,
      flipkartEolModelNames: payload.flipkartEolModelNames,
      flipkartEolFsns: payload.flipkartEolFsns,
      channelLatestDaySellout: payload.channelLatestDaySellout,
    });
  }

  return result;
}

export type AdminConsolidatedIngestSummary = {
  workspace: CatalogWorkspace;
  managerName: string;
  skuCount: number;
}[];

export function formatAdminConsolidatedIngestSummary(
  rows: AdminConsolidatedIngestSummary,
): string {
  if (rows.length === 0) return "No manager-scope rows were found in this file.";
  return rows
    .map(
      (r) =>
        `${r.managerName}: ${r.skuCount} SKU${r.skuCount === 1 ? "" : "s"}`,
    )
    .join(" · ");
}
