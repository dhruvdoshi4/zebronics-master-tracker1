import { ADMIN_MANAGER_WORKSPACES } from "./admin-realm";
import { isLegacyBareAppPath } from "./admin-app-paths";
import {
  productMasterBelongsToWorkspace,
  type CatalogWorkspace,
} from "./catalog-workspace";
import { rowBelongsToManagerDashboard } from "./manager-dashboard-scope";
import type { LegacyMarketplace } from "./types";
import {
  isMonitorAppPath,
  isPersonalAudioAppPath,
  isPravinAppPath,
  isRishabhAppPath,
  isRithikaAppPath,
} from "./tenants";

/** Legacy bare `/app/*` routes (bookmarks) — not a manager prefix. */
export function isGlobalAdminAppPath(pathname: string): boolean {
  return isLegacyBareAppPath(pathname);
}

export function isManagerWorkspaceAppPath(pathname: string): boolean {
  return (
    isMonitorAppPath(pathname) ||
    isPersonalAudioAppPath(pathname) ||
    isRithikaAppPath(pathname) ||
    isPravinAppPath(pathname) ||
    isRishabhAppPath(pathname)
  );
}

export function managerRoutePrefixForWorkspace(workspace: CatalogWorkspace): string {
  if (workspace === "personal_audio") return "/app/pa";
  if (workspace === "rithika_it_gaming") return "/app/ri";
  if (workspace === "roma_powerbank") return "/app/pv";
  if (workspace === "home_audio") return "/app/ha";
  return "/app/mp";
}

export {
  adminPathFromMonitorPath,
  monitorPathFromLegacyBarePath,
} from "./monitor-app-paths";
export { marketplacePathToAdminPath as globalAdminPathFromMonitorPath } from "./admin-app-paths";
export { monitorPathFromLegacyBarePath as monitorPathFromGlobalAdminPath } from "./monitor-app-paths";

export function rowBelongsToAnyManagerDashboard(
  row: {
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
    catalog_workspace?: string | null;
  },
  marketplace: LegacyMarketplace = "amazon",
): boolean {
  return resolveManagerCatalogWorkspaceForRow(row, marketplace) !== null;
}

/** First manager workspace that owns this sellout row (same order as consolidated routing). */
export function resolveManagerCatalogWorkspaceForRow(
  row: {
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
    catalog_workspace?: string | null;
  },
  marketplace: LegacyMarketplace = "amazon",
): CatalogWorkspace | null {
  const tagged = String(row.catalog_workspace ?? "").trim();
  if (tagged) {
    for (const workspace of ADMIN_MANAGER_WORKSPACES) {
      if (tagged === workspace) return workspace;
    }
  }
  for (const workspace of ADMIN_MANAGER_WORKSPACES) {
    if (
      rowBelongsToManagerDashboard(row, {
        catalogWorkspace: workspace,
        marketplace,
        dataScope: "default",
      })
    ) {
      return workspace;
    }
  }
  return null;
}

export function productMasterBelongsToAnyManagerWorkspace(row: {
  catalog_workspace?: string | null;
}): boolean {
  return ADMIN_MANAGER_WORKSPACES.some((workspace) =>
    productMasterBelongsToWorkspace(row, workspace),
  );
}
