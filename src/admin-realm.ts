import {
  CATALOG_WORKSPACE_HOME_AUDIO,
  CATALOG_WORKSPACE_MONITOR,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_PRAVIN,
  CATALOG_WORKSPACE_RITHIKA,
  catalogWorkspaceLabel,
  catalogWorkspaceManagerName,
  type CatalogWorkspace,
} from "./catalog-workspace";
import { isQcomMarketplace, type Marketplace } from "./types";
import { normalizeLoginEmail } from "./welcome-users";

export const GLOBAL_ADMIN_EMAIL = "admin@zebronics.com";

export type AdminRealm = "marketplace_global" | "qcom";

export type AdminDashboardViewMode = "manager" | "category";

export const ADMIN_REALM_STORAGE_KEY = "zebronics.admin.realm";

/** Manager workspaces visible in Marketplace_Global (no daWg). */
export const ADMIN_MANAGER_WORKSPACES: readonly CatalogWorkspace[] = [
  CATALOG_WORKSPACE_MONITOR,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_RITHIKA,
  CATALOG_WORKSPACE_PRAVIN,
  CATALOG_WORKSPACE_HOME_AUDIO,
] as const;

export type AdminManagerOption = {
  workspace: CatalogWorkspace;
  label: string;
  managerName: string;
};

export const ADMIN_MANAGER_OPTIONS: readonly AdminManagerOption[] =
  ADMIN_MANAGER_WORKSPACES.map((workspace) => ({
    workspace,
    label: catalogWorkspaceLabel(workspace),
    managerName: catalogWorkspaceManagerName(workspace),
  }));

export function isGlobalAdminEmail(email: string | null | undefined): boolean {
  return normalizeLoginEmail(email ?? "") === GLOBAL_ADMIN_EMAIL;
}

export function readStoredAdminRealm(): AdminRealm {
  if (typeof sessionStorage === "undefined") return "marketplace_global";
  const raw = sessionStorage.getItem(ADMIN_REALM_STORAGE_KEY);
  return raw === "qcom" ? "qcom" : "marketplace_global";
}

export function writeStoredAdminRealm(realm: AdminRealm): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(ADMIN_REALM_STORAGE_KEY, realm);
}

export function adminRealmLabel(realm: AdminRealm): string {
  return realm === "qcom" ? "Quick Commerce" : "Amazon + Flipkart";
}

export function adminRealmHomePath(realm: AdminRealm): string {
  return realm === "qcom" ? "/app/qcom/upload" : "/app/admin/upload";
}

/** Marketplace_Global must never load QCOM channel sellout rows. */
export function isMarketplaceGlobalChannel(marketplace: Marketplace): boolean {
  return marketplace === "amazon" || marketplace === "flipkart";
}

export function assertMarketplaceGlobalMarketplace(marketplace: Marketplace): void {
  if (isQcomMarketplace(marketplace)) {
    throw new Error("Quick Commerce channel data is not available in Amazon + Flipkart mode.");
  }
}
