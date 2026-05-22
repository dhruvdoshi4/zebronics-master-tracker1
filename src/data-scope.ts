import { normalizeLoginEmail } from "./welcome-users";
import type { DataScope, Profile } from "./types";

export type { DataScope };

export const DAWG_LOGIN_EMAIL = "dawg@zebronics.com";

export function resolveDataScope(options?: {
  profileScope?: DataScope | null;
  email?: string | null | undefined;
}): DataScope {
  const email = normalizeLoginEmail(options?.email ?? "");
  /** Login email wins — profile may still say default if seed ran before migration. */
  if (email === DAWG_LOGIN_EMAIL) return "dawg";
  if (options?.profileScope === "dawg" || options?.profileScope === "default") {
    return options.profileScope;
  }
  return "default";
}

export function isDawgDataScope(scope: DataScope): boolean {
  return scope === "dawg";
}

/** daWg uses the full marketplace app; only Quick Commerce routes are blocked. */
export function isDawgAllowedAppPath(pathname: string): boolean {
  if (!pathname.startsWith("/app")) return true;
  if (pathname === "/app/qcom" || pathname.startsWith("/app/qcom/")) return false;
  return true;
}
