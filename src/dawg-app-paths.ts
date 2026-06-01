import { MONITOR_APP_PREFIX } from "./monitor-app-paths";

/** Gaming - daWg standalone marketplace app (not Hari `/app/mp`). */
export const DAWG_APP_PREFIX = "/app/dw";

export function isDawgAppPath(pathname: string): boolean {
  return pathname === DAWG_APP_PREFIX || pathname.startsWith(`${DAWG_APP_PREFIX}/`);
}

export function dawgDefaultUploadPath(): string {
  return `${DAWG_APP_PREFIX}/upload`;
}

/** Legacy daWg bookmarks under Hari `/app/mp/*` → `/app/dw/*`. */
export function dawgPathFromMonitorPath(pathname: string, search = ""): string {
  if (isDawgAppPath(pathname)) return pathname + search;
  if (!pathname.startsWith(MONITOR_APP_PREFIX)) return dawgDefaultUploadPath() + search;
  const rest = pathname.slice(MONITOR_APP_PREFIX.length) || "/upload";
  return `${DAWG_APP_PREFIX}${rest}${search}`;
}
