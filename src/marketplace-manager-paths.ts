import type { CatalogWorkspace } from "./catalog-workspace";
import { ADMIN_APP_PREFIX } from "./admin-app-paths";
import { MONITOR_APP_PREFIX } from "./monitor-app-paths";
import type { AppTenant } from "./tenants";

/**
 * Marketplace manager URL prefixes (Amazon + Flipkart workspaces).
 *
 * | User   | Prefix        | Example              |
 * |--------|---------------|----------------------|
 * | Admin  | /app/admin    | /app/admin/upload    |
 * | Hari   | /app/mp       | /app/mp/upload       |
 * | Karan  | /app/pa       | /app/pa/upload       |
 * | Rithika| /app/ri       | /app/ri/upload       |
 * | Pravin | /app/pv       | /app/pv/upload       |
 * | Rishabh| /app/ha       | /app/ha/upload       |
 *
 * Legacy bare `/app/upload` etc. redirect via {@link legacyBareEcomRedirectRoutes}.
 */
export const MANAGER_MARKETPLACE_PREFIX = {
  admin: ADMIN_APP_PREFIX,
  monitor: MONITOR_APP_PREFIX,
  personal_audio: "/app/pa",
  rithika: "/app/ri",
  pravin: "/app/pv",
  home_audio: "/app/ha",
} as const;

export type ManagerMarketplacePrefixKey = keyof typeof MANAGER_MARKETPLACE_PREFIX;

export function managerPrefixForWorkspace(workspace: CatalogWorkspace): string {
  if (workspace === "personal_audio") return MANAGER_MARKETPLACE_PREFIX.personal_audio;
  if (workspace === "rithika_it_gaming") return MANAGER_MARKETPLACE_PREFIX.rithika;
  if (workspace === "roma_powerbank") return MANAGER_MARKETPLACE_PREFIX.pravin;
  if (workspace === "home_audio") return MANAGER_MARKETPLACE_PREFIX.home_audio;
  return MANAGER_MARKETPLACE_PREFIX.monitor;
}

export function managerPrefixForTenant(tenant: AppTenant): string {
  if (tenant === "personal_audio") return MANAGER_MARKETPLACE_PREFIX.personal_audio;
  if (tenant === "rithika") return MANAGER_MARKETPLACE_PREFIX.rithika;
  if (tenant === "pravin") return MANAGER_MARKETPLACE_PREFIX.pravin;
  if (tenant === "rishabh") return MANAGER_MARKETPLACE_PREFIX.home_audio;
  return MANAGER_MARKETPLACE_PREFIX.monitor;
}

export function isKnownManagerMarketplacePrefix(pathname: string): boolean {
  return Object.values(MANAGER_MARKETPLACE_PREFIX).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
