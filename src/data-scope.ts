import { isGlobalAdminEmail, readStoredAdminRealm } from "./admin-realm";
import { supabase } from "./supabase";
import { normalizeLoginEmail } from "./welcome-users";
import type { DataScope, Profile } from "./types";

export type { DataScope };

export const DAWG_LOGIN_EMAIL = "dawg@zebronics.com";

export function resolveDataScope(options?: {
  profileScope?: DataScope | null;
  email?: string | null | undefined;
}): DataScope {
  const email = normalizeLoginEmail(options?.email ?? "");
  if (isGlobalAdminEmail(email) && readStoredAdminRealm() === "marketplace_global") {
    return "default";
  }
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
