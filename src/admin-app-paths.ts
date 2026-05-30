import { MONITOR_APP_PREFIX, monitorDefaultUploadPath } from "./monitor-app-paths";

/** Admin marketplace-global routes — separate from Hari's `/app/mp` workspace. */
export const ADMIN_APP_PREFIX = "/app/admin";

export function isAdminAppPath(pathname: string): boolean {
  return pathname === ADMIN_APP_PREFIX || pathname.startsWith(`${ADMIN_APP_PREFIX}/`);
}

/** Legacy bare `/app/*` bookmarks (not `/app/mp`, `/app/admin`, or other manager prefixes). */
export function isLegacyBareAppPath(pathname: string): boolean {
  if (!pathname.startsWith("/app")) return false;
  if (pathname === "/app" || pathname === "/app/") return true;
  if (isAdminAppPath(pathname)) return false;
  if (pathname === "/app/qcom" || pathname.startsWith("/app/qcom/")) return false;
  if (pathname === "/app/pa" || pathname.startsWith("/app/pa/")) return false;
  if (pathname === "/app/ri" || pathname.startsWith("/app/ri/")) return false;
  if (pathname === "/app/pv" || pathname.startsWith("/app/pv/")) return false;
  if (pathname === "/app/ha" || pathname.startsWith("/app/ha/")) return false;
  if (pathname === "/app/mp" || pathname.startsWith("/app/mp/")) return false;
  return true;
}

/** @deprecated Use {@link isLegacyBareAppPath}. */
export const isHariMarketplaceAppPath = isLegacyBareAppPath;

export function marketplacePathToAdminPath(pathname: string, search = ""): string {
  if (isAdminAppPath(pathname)) return pathname + search;
  if (pathname === "/app" || pathname === "/app/") return `${ADMIN_APP_PREFIX}/upload${search}`;
  if (pathname.startsWith(`${MONITOR_APP_PREFIX}/`) || pathname === MONITOR_APP_PREFIX) {
    const rest = pathname.slice(MONITOR_APP_PREFIX.length) || "/upload";
    return `${ADMIN_APP_PREFIX}${rest}${search}`;
  }
  if (!pathname.startsWith("/app/")) return `${ADMIN_APP_PREFIX}/upload${search}`;
  const rest = pathname.slice("/app".length);
  if (rest === "/asin" || rest.startsWith("/asin/")) {
    return `${ADMIN_APP_PREFIX}/lookup${rest.slice("/asin".length)}${search}`;
  }
  return `${ADMIN_APP_PREFIX}${rest}${search}`;
}

/** Non-admin hit an admin URL → send to Hari `/app/mp/*`. */
export function adminPathToMonitorPath(pathname: string, search = ""): string {
  if (!isAdminAppPath(pathname)) return pathname + search;
  if (pathname === ADMIN_APP_PREFIX || pathname === `${ADMIN_APP_PREFIX}/`) {
    return monitorDefaultUploadPath() + search;
  }
  const rest = pathname.slice(ADMIN_APP_PREFIX.length);
  return `${MONITOR_APP_PREFIX}${rest}${search}`;
}

/** @deprecated Use {@link adminPathToMonitorPath}. */
export const adminPathToMarketplacePath = adminPathToMonitorPath;

export function adminDefaultUploadPath(): string {
  return `${ADMIN_APP_PREFIX}/upload`;
}
