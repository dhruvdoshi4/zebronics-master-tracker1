import { ADMIN_MANAGER_WORKSPACES } from "./admin-realm";
import {
  CATALOG_WORKSPACE_HOME_AUDIO,
  CATALOG_WORKSPACE_MONITOR,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_PRAVIN,
  CATALOG_WORKSPACE_RITHIKA,
  type CatalogWorkspace,
} from "./catalog-workspace";
import { productMatchesDawgScope } from "./dawg-scope";
import { productMatchesHariMonitorProjectorDashboardScope } from "./hari-dashboard-scope";
import {
  KARAN_TRACKED_SUB_CATEGORY_SET,
  normalizedKaranSubCategory,
  productMatchesKaranDashboardScopeForMarketplace,
} from "./karan-category-scope";
import {
  normalizedPravinSubCategory,
  productMatchesPravinDashboardScopeForMarketplace,
  rowPassesPravinCategoryScope,
} from "./pravin-category-scope";
import {
  normalizedRishabhSubCategory,
  productMatchesRishabhDashboardScopeForMarketplace,
} from "./rishabh-category-scope";
import {
  normalizedRithikaSubCategory,
  productMatchesRithikaDashboardScopeForMarketplace,
  rowPassesRithikaKamGate,
} from "./rithika-category-scope";
import type { LegacyMarketplace, ParsedUploadPayload } from "./types";

export const ADMIN_CONSOLIDATED_AMAZON_UPLOAD_VALUE = "__consolidated_amazon__" as const;

export type AdminConsolidatedSelloutRow = {
  category: string;
  sub_category: string;
  product_name: string;
  kam?: string;
};

/** Sheet row → manager workspace (Marketplace_Global managers only; no daWg). */
export function resolveAdminConsolidatedCatalogWorkspace(
  row: AdminConsolidatedSelloutRow,
  marketplace: LegacyMarketplace,
): CatalogWorkspace | null {
  const category = String(row.category ?? "").trim();
  const rawSubCategory = String(row.sub_category ?? "").trim();
  const productName = String(row.product_name ?? "").trim();
  const kam = String(row.kam ?? "").trim();

  if (
    productMatchesDawgScope({
      category,
      sub_category: rawSubCategory,
    })
  ) {
    return null;
  }

  const scopeRow = {
    category,
    sub_category: rawSubCategory,
    product_name: productName,
    catalog_workspace: null as string | null,
  };

  if (rowPassesPravinCategoryScope(category, rawSubCategory, productName)) {
    const sub = normalizedPravinSubCategory(rawSubCategory, category, productName);
    if (
      sub &&
      productMatchesPravinDashboardScopeForMarketplace(scopeRow, marketplace)
    ) {
      return CATALOG_WORKSPACE_PRAVIN;
    }
  }

  const rithikaBucket = normalizedRithikaSubCategory(
    rawSubCategory,
    category,
    productName,
    marketplace,
  );
  if (
    rithikaBucket &&
    rowPassesRithikaKamGate(kam, marketplace, rithikaBucket) &&
    productMatchesRithikaDashboardScopeForMarketplace(scopeRow, marketplace)
  ) {
    return CATALOG_WORKSPACE_RITHIKA;
  }

  const rishabhSub = normalizedRishabhSubCategory(
    rawSubCategory,
    category,
    productName,
  );
  if (
    rishabhSub &&
    productMatchesRishabhDashboardScopeForMarketplace(scopeRow, marketplace)
  ) {
    return CATALOG_WORKSPACE_HOME_AUDIO;
  }

  const karanSub = normalizedKaranSubCategory(
    rawSubCategory,
    category,
    productName,
    marketplace,
  );
  if (
    karanSub &&
    KARAN_TRACKED_SUB_CATEGORY_SET.has(karanSub) &&
    productMatchesKaranDashboardScopeForMarketplace(scopeRow, marketplace)
  ) {
    return CATALOG_WORKSPACE_PERSONAL_AUDIO;
  }

  if (productMatchesHariMonitorProjectorDashboardScope(scopeRow)) {
    return CATALOG_WORKSPACE_MONITOR;
  }

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
