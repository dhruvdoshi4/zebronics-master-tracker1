import {
  catalogWorkspaceFromEmail,
  CATALOG_WORKSPACE_MONITOR,
  type CatalogWorkspace,
} from "./catalog-workspace";
import type { Profile } from "./types";

let activeCatalogWorkspace: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR;
let marketplaceGlobalScopeActive = false;

/** Set on route change / login so data.ts reads match the active manager workspace. */
export function setActiveCatalogWorkspace(workspace: CatalogWorkspace): void {
  activeCatalogWorkspace = workspace;
}

export function getActiveCatalogWorkspace(): CatalogWorkspace {
  return activeCatalogWorkspace;
}

/** Boss `/app/*` — browse/search/lookup across all manager workspaces. */
export function setMarketplaceGlobalScopeActive(active: boolean): void {
  marketplaceGlobalScopeActive = active;
}

export function isMarketplaceGlobalScopeActive(): boolean {
  return marketplaceGlobalScopeActive;
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
): CatalogWorkspace {
  if (pathname === "/app/mp" || pathname.startsWith("/app/mp/")) {
    return "monitor_projector";
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
  return catalogWorkspaceFromEmail(email);
}
