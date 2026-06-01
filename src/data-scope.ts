import { isGlobalAdminEmail, readStoredAdminRealm } from "./admin-realm";
import { isDawgAppPath } from "./dawg-app-paths";
import { supabase } from "./supabase";
import { normalizeLoginEmail } from "./welcome-users";
import type { DataScope, Profile } from "./types";

export type { DataScope };

export const DAWG_LOGIN_EMAIL = "dawg@zebronics.com";

export function isDawgLoginEmail(email: string | null | undefined): boolean {
  const key = normalizeLoginEmail(email ?? "");
  if (!key) return false;
  if (key === DAWG_LOGIN_EMAIL) return true;
  const [local, domain] = key.split("@");
  if (!domain?.endsWith("zebronics.com")) return false;
  return local === "dawg" || Boolean(local?.startsWith("dawg."));
}

export function resolveDataScope(options?: {
  profileScope?: DataScope | null;
  email?: string | null | undefined;
}): DataScope {
  const email = normalizeLoginEmail(options?.email ?? "");
  if (isGlobalAdminEmail(email) && readStoredAdminRealm() === "marketplace_global") {
    return "default";
  }
  /** Login email wins — profile may still say default if seed ran before migration. */
  if (isDawgLoginEmail(email)) return "dawg";
  if (options?.profileScope === "dawg" || options?.profileScope === "default") {
    return options.profileScope;
  }
  return "default";
}

export function isDawgDataScope(scope: DataScope): boolean {
  return scope === "dawg";
}

/** daWg may only use `/app/dw/*` (plus welcome/login). */
export function isDawgAllowedAppPath(pathname: string): boolean {
  if (!pathname.startsWith("/app")) return true;
  if (pathname === "/welcome") return true;
  if (pathname === "/app/qcom" || pathname.startsWith("/app/qcom/")) return false;
  return isDawgAppPath(pathname);
}

/** Align profiles.data_scope with login email so Supabase RLS matches the app. */
export async function ensureProfileDataScopeForEmail(
  userId: string,
  email: string | null | undefined,
  profile: Profile | null,
): Promise<Profile | null> {
  if (!profile) return null;
  const expected = resolveDataScope({
    email,
    profileScope: profile.data_scope,
  });
  if (profile.data_scope === expected) return profile;
  const { error } = await supabase
    .from("profiles")
    .update({ data_scope: expected })
    .eq("id", userId);
  if (error) {
    console.warn("[auth] could not sync profile data_scope:", error.message);
    return profile;
  }
  return { ...profile, data_scope: expected };
}
