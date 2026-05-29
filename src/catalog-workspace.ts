import type { AppRole, LegacyMarketplace } from "./types";
import { normalizeLoginEmail } from "./welcome-users";
import { normalizeKey } from "./utils";

/** Accounts that must always have admin (upload + full app), regardless of stale profiles rows. */
const WORKSPACE_ADMIN_EMAILS = new Set([
  "admin@zebronics.com",
  "karan@zebronics.com",
  "pravin@zebronics.com",
  "hari@zebronics.com",
  "rithika@zebronics.com",
  "rishabh@zebronics.com",
  "rishab@zebronics.com",
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
    if (local === "pravin" || local?.startsWith("pravin.")) return "admin";
    if (local === "hari" || local?.startsWith("hari.")) return "admin";
    if (local === "rithika" || local?.startsWith("rithika.")) return "admin";
    if (
      local === "rishabh" ||
      local?.startsWith("rishabh.") ||
      local === "rishab" ||
      local?.startsWith("rishab.")
    ) {
      return "admin";
    }
    if (local === "qcom" || local?.startsWith("qcom.")) return "admin";
  }
  return profileRole === "admin" ? "admin" : "viewer";
}

/**
 * Catalog workspace tags on uploads and product_master (Hari vs Karan vs Rithika).
 * Enforced product visibility: see manager-dashboard-scope.ts → rowBelongsToManagerDashboard().
 */
export type CatalogWorkspace =
  | "monitor_projector"
  | "personal_audio"
  | "rithika_it_gaming"
  | "roma_powerbank"
  | "home_audio";

export const CATALOG_WORKSPACE_MONITOR: CatalogWorkspace = "monitor_projector";
export const CATALOG_WORKSPACE_PERSONAL_AUDIO: CatalogWorkspace = "personal_audio";
export const CATALOG_WORKSPACE_RITHIKA: CatalogWorkspace = "rithika_it_gaming";
export const CATALOG_WORKSPACE_PRAVIN: CatalogWorkspace = "roma_powerbank";
export const CATALOG_WORKSPACE_HOME_AUDIO: CatalogWorkspace = "home_audio";

const ALL_CATALOG_WORKSPACES = new Set<CatalogWorkspace>([
  CATALOG_WORKSPACE_MONITOR,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_RITHIKA,
  CATALOG_WORKSPACE_PRAVIN,
  CATALOG_WORKSPACE_HOME_AUDIO,
]);

export function isManagerCatalogWorkspace(workspace: CatalogWorkspace): boolean {
  return (
    workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO ||
    workspace === CATALOG_WORKSPACE_RITHIKA ||
    workspace === CATALOG_WORKSPACE_PRAVIN ||
    workspace === CATALOG_WORKSPACE_HOME_AUDIO
  );
}

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
  if (
    key === "rithika@zebronics.com" ||
    local === "rithika" ||
    local?.startsWith("rithika.")
  ) {
    return CATALOG_WORKSPACE_RITHIKA;
  }
  if (
    key === "pravin@zebronics.com" ||
    local === "pravin" ||
    local?.startsWith("pravin.")
  ) {
    return CATALOG_WORKSPACE_PRAVIN;
  }
  if (
    key === "rishabh@zebronics.com" ||
    local === "rishabh" ||
    local?.startsWith("rishabh.") ||
    key === "rishab@zebronics.com" ||
    local === "rishab" ||
    local?.startsWith("rishab.")
  ) {
    return CATALOG_WORKSPACE_HOME_AUDIO;
  }
  return CATALOG_WORKSPACE_MONITOR;
}

export function catalogWorkspaceLabel(workspace: CatalogWorkspace): string {
  if (workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) return "Personal Audio & Auto";
  if (workspace === CATALOG_WORKSPACE_RITHIKA) return "IT, Gaming & Accessories";
  if (workspace === CATALOG_WORKSPACE_PRAVIN) return "ROMA & PowerBank";
  if (workspace === CATALOG_WORKSPACE_HOME_AUDIO) return "Home Audio";
  return "Monitor + Projector";
}

export function catalogWorkspaceManagerName(workspace: CatalogWorkspace): string {
  if (workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) return "Karan";
  if (workspace === CATALOG_WORKSPACE_RITHIKA) return "Rithika";
  if (workspace === CATALOG_WORKSPACE_PRAVIN) return "Pravin";
  if (workspace === CATALOG_WORKSPACE_HOME_AUDIO) return "Rishabh";
  return "Hari";
}

export function parseWorkspaceToken(raw: string): CatalogWorkspace | null {
  if (ALL_CATALOG_WORKSPACES.has(raw as CatalogWorkspace)) {
    return raw as CatalogWorkspace;
  }
  return null;
}

export function parseCatalogWorkspaceFromUploadRow(row: {
  catalog_workspace?: string | null;
  notes?: string | null;
}): CatalogWorkspace {
  const direct = parseWorkspaceToken(String(row.catalog_workspace ?? "").trim());
  if (direct) return direct;
  const notes = String(row.notes ?? "");
  const m = notes.match(/catalog_workspace[=:]\s*([a-z_]+)/i);
  const fromNotes = m?.[1] ? parseWorkspaceToken(m[1]) : null;
  if (fromNotes) return fromNotes;
  return CATALOG_WORKSPACE_MONITOR;
}

/**
 * Strict upload ownership — legacy rows without a marker belong to Hari (monitor) only.
 */
export function uploadRowBelongsToCatalogWorkspace(
  row: { catalog_workspace?: string | null; notes?: string | null },
  workspace: CatalogWorkspace,
): boolean {
  const direct = parseWorkspaceToken(String(row.catalog_workspace ?? "").trim());
  if (direct) return direct === workspace;
  const notes = String(row.notes ?? "");
  const m = notes.match(/catalog_workspace[=:]\s*([a-z_]+)/i);
  const fromNotes = m?.[1] ? parseWorkspaceToken(m[1]) : null;
  if (fromNotes) return fromNotes === workspace;
  return workspace === CATALOG_WORKSPACE_MONITOR;
}

export function productMasterBelongsToWorkspace(
  row: { catalog_workspace?: string | null },
  workspace: CatalogWorkspace,
): boolean {
  const w = parseWorkspaceToken(String(row.catalog_workspace ?? "").trim());
  if (w) return w === workspace;
  /** Untagged rows: Hari monitor workspace only; Karan/Rithika infer scope elsewhere. */
  if (workspace === CATALOG_WORKSPACE_MONITOR) return true;
  if (workspace === CATALOG_WORKSPACE_PRAVIN) {
    return w === CATALOG_WORKSPACE_PRAVIN;
  }
  if (
    workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO ||
    workspace === CATALOG_WORKSPACE_RITHIKA ||
    workspace === CATALOG_WORKSPACE_HOME_AUDIO
  ) {
    return true;
  }
  return false;
}

export function uploadNotesForCatalogWorkspace(workspace: CatalogWorkspace): string | null {
  return workspace === CATALOG_WORKSPACE_MONITOR
    ? null
    : `catalog_workspace=${workspace}`;
}

export type UploadHistoryScope =
  | "marketplace"
  | "quickcommerce"
  | "personal_audio"
  | "rithika"
  | "pravin"
  | "home_audio"
  | "dawg";

export function uploadHistoryScopeFromWorkspace(
  workspace: CatalogWorkspace,
): UploadHistoryScope {
  if (workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) return "personal_audio";
  if (workspace === CATALOG_WORKSPACE_RITHIKA) return "rithika";
  if (workspace === CATALOG_WORKSPACE_PRAVIN) return "pravin";
  if (workspace === CATALOG_WORKSPACE_HOME_AUDIO) return "home_audio";
  return "marketplace";
}

type UploadHistoryRowLike = {
  marketplace: string;
  upload_kind?: string | null;
  notes?: string | null;
  catalog_workspace?: string | null;
  data_scope?: string | null;
};

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
  if (scope === "rithika") {
    return !isQcomUpload && ws === CATALOG_WORKSPACE_RITHIKA;
  }
  if (scope === "pravin") {
    return !isQcomUpload && ws === CATALOG_WORKSPACE_PRAVIN;
  }
  if (scope === "home_audio") {
    return !isQcomUpload && ws === CATALOG_WORKSPACE_HOME_AUDIO;
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
  if (workspace === CATALOG_WORKSPACE_RITHIKA) {
    return `catalog_workspace.eq.${CATALOG_WORKSPACE_RITHIKA}`;
  }
  if (workspace === CATALOG_WORKSPACE_PRAVIN) {
    return `catalog_workspace.eq.${CATALOG_WORKSPACE_PRAVIN}`;
  }
  if (workspace === CATALOG_WORKSPACE_HOME_AUDIO) {
    return `catalog_workspace.eq.${CATALOG_WORKSPACE_HOME_AUDIO}`;
  }
  return `catalog_workspace.eq.${CATALOG_WORKSPACE_MONITOR},catalog_workspace.is.null`;
}

export function rowCatalogWorkspace(
  row: { catalog_workspace?: string | null },
  fallback: CatalogWorkspace = CATALOG_WORKSPACE_MONITOR,
): CatalogWorkspace {
  const w = parseWorkspaceToken(String(row.catalog_workspace ?? "").trim());
  return w ?? fallback;
}

export function sheetCategoryHaystack(
  category: string,
  subCategory: string,
  productName: string,
): string {
  return normalizeKey(`${category} ${subCategory} ${productName}`);
}
