import { ADMIN_APP_PREFIX } from "./admin-app-paths";

/** Hari — Monitor + Projector workspace (same pattern as `/app/pa`, `/app/ri`, …). */
export const MONITOR_APP_PREFIX = "/app/mp";

export function monitorDefaultUploadPath(): string {
  return `${MONITOR_APP_PREFIX}/upload`;
}

/** Legacy bare `/app/*` bookmarks → Hari `/app/mp/*`. */
export function monitorPathFromLegacyBarePath(pathname: string, search = ""): string {
  if (pathname === "/app" || pathname === "/app/") return monitorDefaultUploadPath() + search;
  if (pathname.startsWith(MONITOR_APP_PREFIX)) return pathname + search;
  if (!pathname.startsWith("/app/")) return monitorDefaultUploadPath() + search;
  const rest = pathname.slice("/app".length);
  if (rest === "/asin" || rest.startsWith("/asin/")) {
    return `${MONITOR_APP_PREFIX}/lookup${rest.slice("/asin".length)}${search}`;
  }
  return `${MONITOR_APP_PREFIX}${rest}${search}`;
}

/** Hari `/app/mp/*` → admin `/app/admin/*`. */
export function adminPathFromMonitorPath(pathname: string, search = ""): string {
  if (!pathname.startsWith(MONITOR_APP_PREFIX)) {
    return `${ADMIN_APP_PREFIX}/upload${search}`;
  }
  const rest = pathname.slice(MONITOR_APP_PREFIX.length) || "/upload";
  return `${ADMIN_APP_PREFIX}${rest}${search}`;
}
