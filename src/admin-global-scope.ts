import { ADMIN_MANAGER_WORKSPACES } from "./admin-realm";
import {
  productMasterBelongsToWorkspace,
  type CatalogWorkspace,
} from "./catalog-workspace";
import { rowBelongsToManagerDashboard } from "./manager-dashboard-scope";
import type { LegacyMarketplace } from "./types";
import {
  isMarketplaceOnlyAppPath,
  isMonitorAppPath,
  isPersonalAudioAppPath,
  isPravinAppPath,
  isRishabhAppPath,
  isRithikaAppPath,
} from "./tenants";

/** Boss `/app/*` routes — not a manager prefix (`/app/mp`, `/app/pa`, …). */
export function isGlobalAdminAppPath(pathname: string): boolean {
  return isMarketplaceOnlyAppPath(pathname);
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

export function globalAdminPathFromMonitorPath(pathname: string): string {
  if (pathname === "/app/mp" || pathname === "/app/mp/") return "/app/upload";
  if (!pathname.startsWith("/app/mp/")) return "/app/upload";
  const rest = pathname.slice("/app/mp".length);
  if (rest === "/lookup" || rest.startsWith("/lookup/")) {
    return `/app/asin${rest.slice("/lookup".length)}`;
  }
  return `/app${rest}`;
}

export function monitorPathFromGlobalAdminPath(pathname: string): string {
  if (pathname === "/app" || pathname === "/app/") return "/app/mp/upload";
  if (pathname.startsWith("/app/mp")) return pathname;
  if (!pathname.startsWith("/app/")) return "/app/mp/upload";
  const rest = pathname.slice("/app".length);
  if (rest === "/asin" || rest.startsWith("/asin/")) {
    return `/app/mp/lookup${rest.slice("/asin".length)}`;
  }
  return `/app/mp${rest}`;
}

export function rowBelongsToAnyManagerDashboard(
  row: {
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
    catalog_workspace?: string | null;
  },
  marketplace: LegacyMarketplace = "amazon",
): boolean {
  return ADMIN_MANAGER_WORKSPACES.some((workspace) =>
    rowBelongsToManagerDashboard(row, {
      catalogWorkspace: workspace,
      marketplace,
      dataScope: "default",
    }),
  );
}

export function productMasterBelongsToAnyManagerWorkspace(row: {
  catalog_workspace?: string | null;
}): boolean {
  return ADMIN_MANAGER_WORKSPACES.some((workspace) =>
    productMasterBelongsToWorkspace(row, workspace),
  );
}
