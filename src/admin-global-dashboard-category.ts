import { resolveManagerCatalogWorkspaceForRow } from "./admin-global-scope";
import {
  CATALOG_WORKSPACE_HOME_AUDIO,
  CATALOG_WORKSPACE_MONITOR,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_PRAVIN,
  CATALOG_WORKSPACE_RITHIKA,
  type CatalogWorkspace,
} from "./catalog-workspace";
import { hariAnalysisTopCategoryForTrackedSub } from "./analysis-category-filters";
import {
  karanDashboardSheetCategory,
  karanDashboardSubCategoryLabel,
} from "./karan-category-scope";
import {
  pravinDashboardSheetCategory,
} from "./pravin-category-scope";
import {
  rithikaDashboardSheetCategory,
  rithikaDashboardSubCategoryLabel,
} from "./rithika-category-scope";
import {
  inferRishabhHomeAudioSubCategoryFromHaystack,
  rowPassesRishabhCategoryScope,
  rowPassesRishabhItAccessoriesScope,
  rishabhTopCategoryForSub,
} from "./rishabh-category-scope";
import type { LegacyMarketplace } from "./types";
import { normalizeKey } from "./utils";

export type AdminDashboardRowLike = {
  category?: string | null;
  sub_category?: string | null;
  product_name?: string | null;
  model_name?: string | null;
  catalog_workspace?: string | null;
};

function rowFields(row: AdminDashboardRowLike) {
  return {
    category: row.category ?? null,
    sub_category: row.sub_category ?? null,
    product_name: row.product_name ?? row.model_name ?? null,
  };
}

/** Map a sellout row to the admin global top category (ROMA, PowerBank, Personal Audio, …). */
export function adminGlobalDashboardTopCategory(
  row: AdminDashboardRowLike,
  marketplace: LegacyMarketplace,
): string | null {
  const fields = rowFields(row);
  const workspace =
    resolveManagerCatalogWorkspaceForRow(
      { ...fields, catalog_workspace: row.catalog_workspace ?? null },
      marketplace,
    ) ?? null;

  if (workspace === CATALOG_WORKSPACE_PRAVIN) {
    return pravinDashboardSheetCategory(fields);
  }
  if (workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) {
    return karanDashboardSheetCategory(fields, marketplace);
  }
  if (workspace === CATALOG_WORKSPACE_RITHIKA) {
    return rithikaDashboardSheetCategory(fields, marketplace);
  }
  if (workspace === CATALOG_WORKSPACE_HOME_AUDIO) {
    if (
      rowPassesRishabhItAccessoriesScope(
        String(fields.category ?? ""),
        String(fields.sub_category ?? ""),
        String(fields.product_name ?? ""),
      )
    ) {
      return "IT Accessories";
    }
    if (
      rowPassesRishabhCategoryScope(
        String(fields.category ?? ""),
        String(fields.sub_category ?? ""),
        String(fields.product_name ?? ""),
      )
    ) {
      return (
        rishabhTopCategoryForSub(String(fields.sub_category ?? "")) ??
        inferRishabhHomeAudioSubCategoryFromHaystack(
          String(fields.category ?? ""),
          String(fields.sub_category ?? ""),
          String(fields.product_name ?? ""),
        ) ??
        "Home Audio"
      );
    }
    return null;
  }
  if (workspace === CATALOG_WORKSPACE_MONITOR) {
    const fromSub = hariAnalysisTopCategoryForTrackedSub(String(fields.sub_category ?? ""));
    if (fromSub) return fromSub;
    const cat = String(fields.category ?? "").trim();
    if (!cat) return null;
    const key = normalizeKey(cat);
    if (key.includes("cartridge")) return "Cartridge";
    if (key.includes("monitor")) return "Monitor & Acc.";
    if (key.includes("projector")) return "Projector & Acc.";
    return cat;
  }
  return String(fields.category ?? "").trim() || null;
}

export function adminGlobalDashboardSubCategoryLabel(
  row: AdminDashboardRowLike,
  marketplace: LegacyMarketplace,
): string | null {
  const fields = rowFields(row);
  const workspace: CatalogWorkspace | null =
    resolveManagerCatalogWorkspaceForRow(
      { ...fields, catalog_workspace: row.catalog_workspace ?? null },
      marketplace,
    ) ?? null;

  if (workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) {
    return karanDashboardSubCategoryLabel(fields, marketplace);
  }
  if (workspace === CATALOG_WORKSPACE_RITHIKA) {
    const label = rithikaDashboardSubCategoryLabel(fields, marketplace);
    if (label) return label;
    const sub = String(fields.sub_category ?? "").trim();
    return sub || null;
  }
  return String(fields.sub_category ?? "").trim() || null;
}
