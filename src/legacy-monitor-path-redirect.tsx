import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./use-auth";
import { isGlobalAdminEmail } from "./admin-realm";
import { marketplacePathToAdminPath } from "./admin-app-paths";
import { monitorPathFromLegacyBarePath } from "./monitor-app-paths";

/** Redirect legacy bare `/app/*` bookmarks to `/app/mp/*` or `/app/admin/*`. */
export function LegacyBareAppPathRedirect() {
  const { pathname, search } = useLocation();
  const { user } = useAuth();
  const target = isGlobalAdminEmail(user?.email)
    ? marketplacePathToAdminPath(pathname, search)
    : monitorPathFromLegacyBarePath(pathname, search);
  return <Navigate to={target} replace />;
}
