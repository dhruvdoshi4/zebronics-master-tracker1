/**
 * MANAGER DASHBOARD ISOLATION RULE (enforced app-wide)
 *
 * Each standalone dashboard (Hari `/app`, Karan `/app/pa`, daWg, QCom) must show ONLY
 * products that belong to that manager's catalog workspace and category rules.
 *
 * - No cross-manager uploads or product_master rows (catalog_workspace tag).
 * - No fallback to another manager's sellout when a channel has no upload.
 * - Karan: channel-aware scope (e.g. Flipkart gaming headphones under IT Accessories only).
 * - Hari: monitor / projector / cartridge rules only.
 * - daWg: Gaming - daWg + Personal Audio sheet categories only.
 *
 * All loaders (PO dashboard, ratings, lookup, search, GMS, analysis) must call
 * rowBelongsToManagerDashboard() — never show out-of-scope SKUs in UI tables or charts.
 */

import {
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_HOME_AUDIO,
  CATALOG_WORKSPACE_PRAVIN,
  CATALOG_WORKSPACE_RITHIKA,
  productMasterBelongsToWorkspace,
  type CatalogWorkspace,
} from "./catalog-workspace";
import { isDawgDataScope, type DataScope } from "./data-scope";
import { productMatchesDawgScope } from "./dawg-scope";
import { productMatchesHariMonitorProjectorDashboardScope } from "./hari-dashboard-scope";
import { productMatchesKaranDashboardScopeForMarketplace } from "./karan-category-scope";
import { productMatchesPravinDashboardScopeForMarketplace } from "./pravin-category-scope";
import { productMatchesRishabhDashboardScopeForMarketplace } from "./rishabh-category-scope";
import { productMatchesRithikaDashboardScopeForMarketplace } from "./rithika-category-scope";
import { rowVisibleViaSharedSub } from "./shared-ecom-subcategory-scope";
import type { LegacyMarketplace } from "./types";
import { getActiveCatalogWorkspace } from "./workspace-catalog-scope";
import { getActiveDataScope } from "./workspace-data-scope";

export type ManagerDashboardRow = {
  category?: string | null;
  sub_category?: string | null;
  product_name?: string | null;
  catalog_workspace?: string | null;
};

export type ManagerDashboardScopeContext = {
  catalogWorkspace: CatalogWorkspace;
  dataScope?: DataScope;
  /** Required for Karan (personal_audio); optional for Hari / daWg. */
  marketplace?: LegacyMarketplace;
};

export function resolveManagerDashboardScopeContext(
  overrides?: Partial<ManagerDashboardScopeContext>,
): ManagerDashboardScopeContext {
  return {
    catalogWorkspace: overrides?.catalogWorkspace ?? getActiveCatalogWorkspace(),
    dataScope: overrides?.dataScope ?? getActiveDataScope(),
    marketplace: overrides?.marketplace,
  };
}

/**
 * Single gate for every manager dashboard row (PO, ratings, lookup, tables).
 * Returns false for any product outside the active manager's sight.
 */
export function rowBelongsToManagerDashboard(
  row: ManagerDashboardRow,
  ctx: ManagerDashboardScopeContext,
): boolean {
  const dataScope = ctx.dataScope ?? "default";

  /** Home Audio: sheet category wins over stale tags (e.g. SKU still tagged monitor_projector from Hari). */
  if (ctx.catalogWorkspace === CATALOG_WORKSPACE_HOME_AUDIO) {
    const mp =
      ctx.marketplace === "amazon" || ctx.marketplace === "flipkart"
        ? ctx.marketplace
        : "amazon";
    return productMatchesRishabhDashboardScopeForMarketplace(
      {
        category: row.category ?? null,
        sub_category: row.sub_category ?? null,
        product_name: row.product_name ?? null,
        catalog_workspace: row.catalog_workspace ?? null,
      },
      mp,
    );
  }

  if (
    ctx.catalogWorkspace === CATALOG_WORKSPACE_PERSONAL_AUDIO ||
    ctx.catalogWorkspace === CATALOG_WORKSPACE_RITHIKA
  ) {
    const mp =
      ctx.marketplace === "amazon" || ctx.marketplace === "flipkart"
        ? ctx.marketplace
        : null;
    if (
      mp &&
      rowVisibleViaSharedSub(ctx.catalogWorkspace, row, mp)
    ) {
      if (ctx.catalogWorkspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) {
        return productMatchesKaranDashboardScopeForMarketplace(
          {
            category: row.category ?? null,
            sub_category: row.sub_category ?? null,
            product_name: row.product_name ?? null,
            catalog_workspace: row.catalog_workspace ?? null,
          },
          mp,
        );
      }
      return productMatchesRithikaDashboardScopeForMarketplace(
        {
          category: row.category ?? null,
          sub_category: row.sub_category ?? null,
          product_name: row.product_name ?? null,
          catalog_workspace: row.catalog_workspace ?? null,
        },
        mp,
      );
    }
  }

  if (
    row.catalog_workspace &&
    !productMasterBelongsToWorkspace(row, ctx.catalogWorkspace)
  ) {
    return false;
  }

  if (isDawgDataScope(dataScope)) {
    return productMatchesDawgScope({
      category: row.category ?? null,
      sub_category: row.sub_category ?? null,
    });
  }

  if (ctx.catalogWorkspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) {
    if (ctx.marketplace !== "amazon" && ctx.marketplace !== "flipkart") {
      return false;
    }
    return productMatchesKaranDashboardScopeForMarketplace(
      {
        category: row.category ?? null,
        sub_category: row.sub_category ?? null,
        product_name: row.product_name ?? null,
        catalog_workspace: row.catalog_workspace ?? null,
      },
      ctx.marketplace,
    );
  }

  if (ctx.catalogWorkspace === CATALOG_WORKSPACE_RITHIKA) {
    if (ctx.marketplace !== "amazon" && ctx.marketplace !== "flipkart") {
      return false;
    }
    return productMatchesRithikaDashboardScopeForMarketplace(
      {
        category: row.category ?? null,
        sub_category: row.sub_category ?? null,
        product_name: row.product_name ?? null,
        catalog_workspace: row.catalog_workspace ?? null,
      },
      ctx.marketplace,
    );
  }

  if (ctx.catalogWorkspace === CATALOG_WORKSPACE_PRAVIN) {
    if (ctx.marketplace !== "amazon" && ctx.marketplace !== "flipkart") {
      return false;
    }
    return productMatchesPravinDashboardScopeForMarketplace(
      {
        category: row.category ?? null,
        sub_category: row.sub_category ?? null,
        product_name: row.product_name ?? null,
        catalog_workspace: row.catalog_workspace ?? null,
      },
      ctx.marketplace,
    );
  }

  return productMatchesHariMonitorProjectorDashboardScope({
    category: row.category ?? null,
    sub_category: row.sub_category ?? null,
    product_name: row.product_name ?? null,
  });
}
