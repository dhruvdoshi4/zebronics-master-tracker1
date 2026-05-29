import { ADMIN_MANAGER_WORKSPACES } from "./admin-realm";
import {
  CATALOG_WORKSPACE_HOME_AUDIO,
  CATALOG_WORKSPACE_MONITOR,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_PRAVIN,
  CATALOG_WORKSPACE_RITHIKA,
  catalogWorkspaceManagerName,
  type CatalogWorkspace,
} from "./catalog-workspace";
import { productMatchesDawgScope } from "./dawg-scope";
import { productMatchesHariMonitorProjectorDashboardScope } from "./hari-dashboard-scope";
import {
  KARAN_TRACKED_SUB_CATEGORY_SET,
  normalizedKaranSubCategory,
} from "./karan-category-scope";
import {
  rowBelongsToManagerDashboard,
  type ManagerDashboardRow,
} from "./manager-dashboard-scope";
import {
  normalizedPravinSubCategory,
  rowPassesPravinConsolidatedCategoryScope,
} from "./pravin-category-scope";
import {
  normalizedRishabhSubCategory,
  rowPassesRishabhCategoryScope,
} from "./rishabh-category-scope";
import {
  normalizedRithikaSubCategory,
  rowPassesRithikaKamGate,
} from "./rithika-category-scope";
import { isCartridgeSheetCategory } from "./sellout-category-scope";
import type { LegacyMarketplace, ParsedUploadPayload } from "./types";
import { normalizeKey } from "./utils";

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

function isConsolidatedSkippedRow(
  category: string,
  subCategory: string,
  brand: string,
): boolean {
  if (isConsolidatedExcludedCategory(category)) return true;
  if (isConsolidatedDawgRow(category, brand)) return true;
  const c = normalizeKey(category);
  if (!c || c === "nan") return true;
  return productMatchesDawgScope({ category, sub_category: subCategory });
}

/**
 * Same rules as each manager's own Amazon upload + dashboard scope
 * (`rowBelongsToManagerDashboard` + per-manager ingest gates in `parsers.ts`).
 */
function rowPassesManagerSelloutIngest(
  row: ManagerDashboardRow,
  workspace: CatalogWorkspace,
  marketplace: LegacyMarketplace,
  kam: string,
): boolean {
  const category = String(row.category ?? "");
  const subCategory = String(row.sub_category ?? "");
  const productName = String(row.product_name ?? "");

  if (workspace === CATALOG_WORKSPACE_MONITOR) {
    return (
      isCartridgeSheetCategory(category) ||
      productMatchesHariMonitorProjectorDashboardScope({
        category,
        sub_category: subCategory,
        product_name: productName,
      })
    );
  }

  if (workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) {
    const sub = normalizedKaranSubCategory(
      subCategory,
      category,
      productName,
      marketplace,
    );
    return sub !== null && KARAN_TRACKED_SUB_CATEGORY_SET.has(sub);
  }

  if (workspace === CATALOG_WORKSPACE_RITHIKA) {
    const bucket = normalizedRithikaSubCategory(
      subCategory,
      category,
      productName,
      marketplace,
    );
    return (
      bucket !== null && rowPassesRithikaKamGate(kam, marketplace, bucket)
    );
  }

  if (workspace === CATALOG_WORKSPACE_HOME_AUDIO) {
    return (
      normalizedRishabhSubCategory(subCategory, category, productName) !== null &&
      rowPassesRishabhCategoryScope(category, subCategory, productName)
    );
  }

  if (workspace === CATALOG_WORKSPACE_PRAVIN) {
    return (
      rowPassesPravinConsolidatedCategoryScope(category, subCategory, productName) &&
      normalizedPravinSubCategory(subCategory, category, productName) !== null
    );
  }

  return false;
}

/** Pick manager workspace using the same scope each dashboard already enforces. */
export function resolveAdminConsolidatedCatalogWorkspace(
  row: AdminConsolidatedSelloutRow,
  marketplace: LegacyMarketplace,
): CatalogWorkspace | null {
  const category = String(row.category ?? "").trim();
  const subCategory = String(row.sub_category ?? "").trim();
  const productName = String(row.product_name ?? "").trim();
  const kam = String(row.kam ?? "").trim();
  const brand = String(row.brand ?? "").trim();

  if (isConsolidatedSkippedRow(category, subCategory, brand)) return null;

  const scopeRow: ManagerDashboardRow = {
    category,
    sub_category: subCategory,
    product_name: productName,
    catalog_workspace: null,
  };

  for (const workspace of ADMIN_MANAGER_WORKSPACES) {
    if (
      !rowBelongsToManagerDashboard(scopeRow, {
        catalogWorkspace: workspace,
        marketplace,
        dataScope: "default",
      })
    ) {
      continue;
    }
    if (!rowPassesManagerSelloutIngest(scopeRow, workspace, marketplace, kam)) {
      continue;
    }
    return workspace;
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
  if (rows.length === 0) {
    return "No manager-scope rows were found. Rows must match the same category rules as each manager's own Amazon upload (N/A, Laptop, and daWg are skipped).";
  }
  const total = rows.reduce((sum, r) => sum + r.skuCount, 0);
  const parts = rows
    .map(
      (r) =>
        `${r.managerName}: ${r.skuCount} SKU${r.skuCount === 1 ? "" : "s"}`,
    )
    .join(" · ");
  return `${parts} (${total} total)`;
}

export function buildAdminConsolidatedIngestSummary(
  splits: Map<CatalogWorkspace, ParsedUploadPayload>,
): AdminConsolidatedIngestSummary {
  const summary: AdminConsolidatedIngestSummary = [];
  for (const workspace of ADMIN_MANAGER_WORKSPACES) {
    const wsPayload = splits.get(workspace);
    if (!wsPayload?.products.length) continue;
    summary.push({
      workspace,
      managerName: catalogWorkspaceManagerName(workspace),
      skuCount: wsPayload.products.length,
    });
  }
  return summary;
}
