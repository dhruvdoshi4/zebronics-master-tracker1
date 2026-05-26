import type { AppRole, LegacyMarketplace } from "./types";
import { normalizeLoginEmail } from "./welcome-users";
import { normalizeKey } from "./utils";

/** Accounts that must always have admin (upload + full app), regardless of stale profiles rows. */
const WORKSPACE_ADMIN_EMAILS = new Set([
  "karan@zebronics.com",
  "hari@zebronics.com",
  "qcom@zebronics.com",
  "quickcom@zebronics.com",
]);

export function effectiveAppRole(
  email: string | null | undefined,
  profileRole: AppRole | null | undefined,
): AppRole {
  if (!email) return profileRole === "admin" ? "admin" : "viewer";
  const key = normalizeLoginEmail(email);
  if (WORKSPACE_ADMIN_EMAILS.has(key)) return "admin";
  const [local, domain] = key.split("@");
  if (domain?.endsWith("zebronics.com")) {
    if (local === "karan" || local?.startsWith("karan.")) return "admin";
    if (local === "hari" || local?.startsWith("hari.")) return "admin";
    if (local === "qcom" || local?.startsWith("qcom.")) return "admin";
  }
  return profileRole === "admin" ? "admin" : "viewer";
}

/**
 * Catalog workspace tags on uploads and product_master (Hari vs Karan).
 * Enforced product visibility: see manager-dashboard-scope.ts → rowBelongsToManagerDashboard().
 */
/** Hari monitor/projector vs Karan personal-audio workspace (shared amazon/flipkart tables). */
export type CatalogWorkspace = "monitor_projector" | "personal_audio";

export const CATALOG_WORKSPACE_MONITOR: CatalogWorkspace = "monitor_projector";
export const CATALOG_WORKSPACE_PERSONAL_AUDIO: CatalogWorkspace = "personal_audio";

export function catalogWorkspaceFromEmail(
  email: string | null | undefined,
): CatalogWorkspace {
  if (!email) return CATALOG_WORKSPACE_MONITOR;
  const key = email.trim().toLowerCase();
  const [local] = key.split("@");
  if (
    key === "karan@zebronics.com" ||
    local === "karan" ||
    local?.startsWith("karan.")
  ) {
    return CATALOG_WORKSPACE_PERSONAL_AUDIO;
  }
  return CATALOG_WORKSPACE_MONITOR;
}

export function catalogWorkspaceLabel(workspace: CatalogWorkspace): string {
  return workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO
    ? "Personal Audio & Auto"
    : "Monitor + Projector";
}

export function catalogWorkspaceManagerName(workspace: CatalogWorkspace): string {
  return workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO ? "Karan" : "Hari";
}

export function parseCatalogWorkspaceFromUploadRow(row: {
  catalog_workspace?: string | null;
  notes?: string | null;
}): CatalogWorkspace {
  const direct = String(row.catalog_workspace ?? "").trim();
  if (direct === CATALOG_WORKSPACE_PERSONAL_AUDIO) return CATALOG_WORKSPACE_PERSONAL_AUDIO;
  if (direct === CATALOG_WORKSPACE_MONITOR) return CATALOG_WORKSPACE_MONITOR;
  const notes = String(row.notes ?? "");
  const m = notes.match(/catalog_workspace[=:]\s*([a-z_]+)/i);
  if (m?.[1] === CATALOG_WORKSPACE_PERSONAL_AUDIO) return CATALOG_WORKSPACE_PERSONAL_AUDIO;
  return CATALOG_WORKSPACE_MONITOR;
}

/**
 * Strict upload ownership — legacy rows without a marker belong to Hari (monitor) only.
 * Never use this for cross-workspace fallbacks when scoped upload is missing.
 */
export function uploadRowBelongsToCatalogWorkspace(
  row: { catalog_workspace?: string | null; notes?: string | null },
  workspace: CatalogWorkspace,
): boolean {
  const direct = String(row.catalog_workspace ?? "").trim();
  if (direct === CATALOG_WORKSPACE_PERSONAL_AUDIO || direct === CATALOG_WORKSPACE_MONITOR) {
    return direct === workspace;
  }
  const notes = String(row.notes ?? "");
  const m = notes.match(/catalog_workspace[=:]\s*([a-z_]+)/i);
  if (m?.[1] === CATALOG_WORKSPACE_PERSONAL_AUDIO) {
    return workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO;
  }
  if (m?.[1] === CATALOG_WORKSPACE_MONITOR) {
    return workspace === CATALOG_WORKSPACE_MONITOR;
  }
  return workspace === CATALOG_WORKSPACE_MONITOR;
}

/** Product master row belongs to exactly one manager workspace. */
export function productMasterBelongsToWorkspace(
  row: { catalog_workspace?: string | null },
  workspace: CatalogWorkspace,
): boolean {
  const w = String(row.catalog_workspace ?? "").trim();
  if (w === CATALOG_WORKSPACE_PERSONAL_AUDIO || w === CATALOG_WORKSPACE_MONITOR) {
    return w === workspace;
  }
  return workspace === CATALOG_WORKSPACE_MONITOR;
}

export function uploadNotesForCatalogWorkspace(workspace: CatalogWorkspace): string | null {
  return workspace === CATALOG_WORKSPACE_MONITOR
    ? null
    : `catalog_workspace=${workspace}`;
}

export type UploadHistoryScope = "marketplace" | "quickcommerce" | "personal_audio" | "dawg";

export function uploadHistoryScopeFromWorkspace(
  workspace: CatalogWorkspace,
): UploadHistoryScope {
  return workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO ? "personal_audio" : "marketplace";
}

type UploadHistoryRowLike = {
  marketplace: string;
  upload_kind?: string | null;
  notes?: string | null;
  catalog_workspace?: string | null;
  data_scope?: string | null;
};

/** Sellout upload history tabs — QCom vs Hari vs Karan. */
export function uploadRowMatchesHistoryScope(
  row: UploadHistoryRowLike,
  scope: UploadHistoryScope,
): boolean {
  const mp = row.marketplace;
  const isQcomUpload =
    mp === "consolidated" ||
    mp === "zepto" ||
    mp === "blinkit" ||
    mp === "bigbasket" ||
    mp === "instamart";
  const ws = parseCatalogWorkspaceFromUploadRow(row);

  if (scope === "quickcommerce") return isQcomUpload;
  if (scope === "dawg") {
    return !isQcomUpload && String(row.data_scope ?? "") === "dawg";
  }
  if (scope === "personal_audio") {
    return !isQcomUpload && ws === CATALOG_WORKSPACE_PERSONAL_AUDIO;
  }
  return (
    !isQcomUpload &&
    ws === CATALOG_WORKSPACE_MONITOR &&
    String(row.data_scope ?? "default") !== "dawg"
  );
}

export function isLegacyMarketplaceForWorkspace(
  m: string,
): m is LegacyMarketplace {
  return m === "amazon" || m === "flipkart";
}

export function productMasterOrFilterForWorkspace(workspace: CatalogWorkspace): string {
  if (workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) {
    return `catalog_workspace.eq.${CATALOG_WORKSPACE_PERSONAL_AUDIO}`;
  }
  return `catalog_workspace.eq.${CATALOG_WORKSPACE_MONITOR},catalog_workspace.is.null`;
}

/** Treat null workspace as monitor_projector for rows created before migration. */
export function rowCatalogWorkspace(
  row: { catalog_workspace?: string | null },
  fallback: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
): CatalogWorkspace {
  const w = String(row.catalog_workspace ?? "").trim();
  if (w === CATALOG_WORKSPACE_PERSONAL_AUDIO) return CATALOG_WORKSPACE_PERSONAL_AUDIO;
  if (w === CATALOG_WORKSPACE_MONITOR) return CATALOG_WORKSPACE_MONITOR;
  return fallback;
}

export function sheetCategoryHaystack(
  category: string,
  subCategory: string,
  productName: string,
): string {
  return normalizeKey(`${category} ${subCategory} ${productName}`);
}
