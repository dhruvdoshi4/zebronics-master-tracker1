import type { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  adminPathToMonitorPath,
  isAdminAppPath,
  isLegacyBareAppPath,
  marketplacePathToAdminPath,
} from "./admin-app-paths";
import { useAuth } from "./use-auth";
import { isGlobalAdminEmail, readStoredAdminRealm } from "./admin-realm";
import { adminPathFromMonitorPath, monitorPathFromLegacyBarePath } from "./monitor-app-paths";
import { isDawgAllowedAppPath, resolveDataScope } from "./data-scope";
import {
  getAppTenant,
  getDefaultAppPath,
  isMarketplaceOnlyAppPath,
  isMonitorAppPath,
  isPersonalAudioAppPath,
  isPravinAppPath,
  isQuickCommerceAppPath,
  isRishabhAppPath,
  isRithikaAppPath,
} from "./tenants";

/** `/app/model/...` → `/app/ri/model/...` without doubling `/app/ri/ri/...`. */
function rewriteAppPathForManagerTenant(pathname: string, managerPrefix: string): string {
  if (pathname === "/app" || pathname === "/app/") return managerPrefix;
  if (pathname.startsWith(`${managerPrefix}/`)) return pathname;
  if (pathname.startsWith("/app/")) {
    return `${managerPrefix}${pathname.slice("/app".length)}`;
  }
  return managerPrefix;
}

/** Keeps marketplace, Karan, Rithika, Rishabh, and quick-commerce workspaces isolated per login. */
export function TenantGate({ children }: PropsWithChildren) {
  const { user, profile } = useAuth();
  const { pathname, search } = useLocation();
  const tenant = getAppTenant(user?.email);
  const isAdmin = isGlobalAdminEmail(user?.email);
  const dataScope = resolveDataScope({
    profileScope: profile?.data_scope,
    email: user?.email,
  });
  const home = getDefaultAppPath(user?.email, profile?.data_scope);

  if (isAdmin && readStoredAdminRealm() === "marketplace_global" && isLegacyBareAppPath(pathname)) {
    return <Navigate to={marketplacePathToAdminPath(pathname, search)} replace />;
  }
  if (isAdmin && readStoredAdminRealm() === "marketplace_global" && isMonitorAppPath(pathname)) {
    return <Navigate to={adminPathFromMonitorPath(pathname, search)} replace />;
  }
  if (!isAdmin && isAdminAppPath(pathname)) {
    return <Navigate to={adminPathToMonitorPath(pathname, search)} replace />;
  }
  if (tenant === "marketplace" && isLegacyBareAppPath(pathname)) {
    return <Navigate to={monitorPathFromLegacyBarePath(pathname, search)} replace />;
  }

  if (isAdmin && tenant === "quickcommerce" && isMarketplaceOnlyAppPath(pathname)) {
    return <Navigate to={home} replace />;
  }
  if (isAdmin && tenant === "marketplace" && isQuickCommerceAppPath(pathname)) {
    return <Navigate to={home} replace />;
  }

  if (dataScope === "dawg" && !isDawgAllowedAppPath(pathname)) {
    return <Navigate to={home} replace />;
  }

  if (
    tenant === "quickcommerce" &&
    (isLegacyBareAppPath(pathname) ||
      isMonitorAppPath(pathname) ||
      isMarketplaceOnlyAppPath(pathname) ||
      isPersonalAudioAppPath(pathname) ||
      isRithikaAppPath(pathname) ||
      isPravinAppPath(pathname) ||
      isRishabhAppPath(pathname) ||
      isAdminAppPath(pathname))
  ) {
    if (pathname === "/app/ho-stock" || pathname.startsWith("/app/ho-stock/")) {
      return <Navigate to="/app/qcom/ho-stock" replace />;
    }
    return <Navigate to={home} replace />;
  }
  if (
    tenant === "marketplace" &&
    !isAdmin &&
    (isQuickCommerceAppPath(pathname) ||
      isPersonalAudioAppPath(pathname) ||
      isRithikaAppPath(pathname) ||
      isPravinAppPath(pathname) ||
      isRishabhAppPath(pathname) ||
      isAdminAppPath(pathname))
  ) {
    return <Navigate to={home} replace />;
  }
  if (
    tenant === "personal_audio" &&
    (isQuickCommerceAppPath(pathname) ||
      isMarketplaceOnlyAppPath(pathname) ||
      isMonitorAppPath(pathname) ||
      isRithikaAppPath(pathname) ||
      isPravinAppPath(pathname) ||
      isRishabhAppPath(pathname))
  ) {
    const paPath = rewriteAppPathForManagerTenant(pathname, "/app/pa");
    return <Navigate to={paPath === "/app/pa" ? home : paPath} replace />;
  }
  if (
    tenant === "rithika" &&
    (isQuickCommerceAppPath(pathname) ||
      isMarketplaceOnlyAppPath(pathname) ||
      isMonitorAppPath(pathname) ||
      isPersonalAudioAppPath(pathname) ||
      isPravinAppPath(pathname) ||
      isRishabhAppPath(pathname))
  ) {
    const riPath = rewriteAppPathForManagerTenant(pathname, "/app/ri");
    return <Navigate to={riPath === "/app/ri" ? home : riPath} replace />;
  }
  if (
    tenant === "pravin" &&
    (isQuickCommerceAppPath(pathname) ||
      isMarketplaceOnlyAppPath(pathname) ||
      isMonitorAppPath(pathname) ||
      isPersonalAudioAppPath(pathname) ||
      isRithikaAppPath(pathname) ||
      isRishabhAppPath(pathname))
  ) {
    const pvPath = pathname.replace(/^\/app/, "/app/pv") || "/app/pv/upload";
    return <Navigate to={pvPath === "/app/pv" ? home : pvPath} replace />;
  }
  if (
    tenant === "rishabh" &&
    (isQuickCommerceAppPath(pathname) ||
      isMarketplaceOnlyAppPath(pathname) ||
      isMonitorAppPath(pathname) ||
      isPersonalAudioAppPath(pathname) ||
      isRithikaAppPath(pathname) ||
      isPravinAppPath(pathname))
  ) {
    const haPath = rewriteAppPathForManagerTenant(pathname, "/app/ha");
    return <Navigate to={haPath === "/app/ha" ? home : haPath} replace />;
  }

  return children;
}

export function AppHomeRedirect() {
  const { user, profile } = useAuth();
  return <Navigate to={getDefaultAppPath(user?.email, profile?.data_scope)} replace />;
}
