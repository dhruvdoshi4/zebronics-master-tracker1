/** Admin marketplace-global routes — separate from Hari's `/app/*` workspace. */
export const ADMIN_APP_PREFIX = "/app/admin";

export function isAdminAppPath(pathname: string): boolean {
  return pathname === ADMIN_APP_PREFIX || pathname.startsWith(`${ADMIN_APP_PREFIX}/`);
}

/** Hari / legacy marketplace pages at `/app/*` (not manager prefixes, not admin). */
export function isHariMarketplaceAppPath(pathname: string): boolean {
  if (!pathname.startsWith("/app")) return false;
  if (pathname === "/app" || pathname === "/app/") return false;
  if (isAdminAppPath(pathname)) return false;
  if (pathname === "/app/qcom" || pathname.startsWith("/app/qcom/")) return false;
  if (pathname === "/app/pa" || pathname.startsWith("/app/pa/")) return false;
  if (pathname === "/app/ri" || pathname.startsWith("/app/ri/")) return false;
  if (pathname === "/app/pv" || pathname.startsWith("/app/pv/")) return false;
  if (pathname === "/app/ha" || pathname.startsWith("/app/ha/")) return false;
  if (pathname === "/app/mp" || pathname.startsWith("/app/mp/")) return false;
  return true;
}

export function marketplacePathToAdminPath(pathname: string, search = ""): string {
  if (isAdminAppPath(pathname)) return pathname + search;
  if (pathname === "/app" || pathname === "/app/") return `${ADMIN_APP_PREFIX}/upload${search}`;
  if (!pathname.startsWith("/app/")) return `${ADMIN_APP_PREFIX}/upload${search}`;
  return `${ADMIN_APP_PREFIX}${pathname.slice("/app".length)}${search}`;
}

export function adminPathToMarketplacePath(pathname: string, search = ""): string {
  if (!isAdminAppPath(pathname)) return pathname + search;
  if (pathname === ADMIN_APP_PREFIX || pathname === `${ADMIN_APP_PREFIX}/`) {
    return `/app/upload${search}`;
  }
  return `/app${pathname.slice(ADMIN_APP_PREFIX.length)}${search}`;
}

export function adminDefaultUploadPath(): string {
  return `${ADMIN_APP_PREFIX}/upload`;
}
