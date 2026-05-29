import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./use-auth";
import { isGlobalAdminEmail } from "./admin-realm";
import {
  globalAdminPathFromMonitorPath,
  monitorPathFromGlobalAdminPath,
} from "./admin-global-scope";
/**
 * Legacy bookmarks:
 * - Hari on old `/app/*` → `/app/mp/*`
 * - Admin on `/app/mp/*` → `/app/*`
 */
export function legacyMonitorPathTarget(pathname: string): string {
  return monitorPathFromGlobalAdminPath(pathname);
}

export function LegacyMonitorPathRedirect() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const target = isGlobalAdminEmail(user?.email)
    ? globalAdminPathFromMonitorPath(pathname)
    : legacyMonitorPathTarget(pathname);
  return <Navigate to={target} replace />;
}
