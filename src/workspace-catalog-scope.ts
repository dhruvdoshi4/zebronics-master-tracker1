import { isAdminAppPath } from "./admin-app-paths";
import { isDawgAppPath } from "./dawg-app-paths";
import { isGlobalAdminEmail } from "./admin-realm";
import {
  catalogWorkspaceFromEmail,
  CATALOG_WORKSPACE_MONITOR,
  type CatalogWorkspace,
} from "./catalog-workspace";
import type { Profile } from "./types";

let activeCatalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR;

/** Set on route change / login so data.ts reads match the active manager workspace. */
export function setActiveCatalogWorkspace(workspace: CatalogWorkspace): void {
  activeCatalogWorkspace = workspace;
}

export function getActiveCatalogWorkspace(): CatalogWorkspace {
  return activeCatalogWorkspace;
}

export function syncActiveCatalogWorkspaceFromAuth(
  email: string | null | undefined,
  _profile?: Profile | null,
): CatalogWorkspace {
  const workspace = catalogWorkspaceFromEmail(email);
  setActiveCatalogWorkspace(workspace);
  return workspace;
}

export function resolveCatalogWorkspaceForPath(
  pathname: string,
  email: string | null | undefined,
): CatalogWorkspace | null {
  if (isDawgAppPath(pathname)) {
    return CATALOG_WORKSPACE_MONITOR;
  }
  if (pathname === "/app/mp" || pathname.startsWith("/app/mp/")) {
    return CATALOG_WORKSPACE_MONITOR;
  }
  if (isAdminAppPath(pathname)) {
    return isGlobalAdminEmail(email) ? null : CATALOG_WORKSPACE_MONITOR;
  }
  if (pathname === "/app/pa" || pathname.startsWith("/app/pa/")) {
    return "personal_audio";
  }
  if (pathname === "/app/ri" || pathname.startsWith("/app/ri/")) {
    return "rithika_it_gaming";
  }
  if (pathname === "/app/pv" || pathname.startsWith("/app/pv/")) {
    return "roma_powerbank";
  }
  if (pathname === "/app/ha" || pathname.startsWith("/app/ha/")) {
    return "home_audio";
  }
  if (isGlobalAdminEmail(email)) {
    return null;
  }
  return catalogWorkspaceFromEmail(email);
}
