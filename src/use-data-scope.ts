import { resolveDataScope, type DataScope } from "./data-scope";
import { useAuth } from "./use-auth";

export function useDataScope(): DataScope {
  const { user, profile } = useAuth();
  return resolveDataScope({
    profileScope: profile?.data_scope,
    email: user?.email,
  });
}
