import { resolveDataScope, type DataScope } from "./data-scope";
import type { Profile } from "./types";

let activeDataScope: DataScope = "default";

/** Set on login from profile + email (see AuthProvider). */
export function setActiveDataScope(scope: DataScope): void {
  activeDataScope = scope;
}

export function getActiveDataScope(): DataScope {
  return activeDataScope;
}

export function syncActiveDataScopeFromAuth(
  email: string | null | undefined,
  profile: Profile | null | undefined,
): DataScope {
  const scope = resolveDataScope({
    email,
    profileScope: profile?.data_scope,
  });
  setActiveDataScope(scope);
  return scope;
}
