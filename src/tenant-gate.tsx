import type { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./use-auth";
import { isDawgAllowedAppPath, resolveDataScope } from "./data-scope";
import {
  getAppTenant,
  getDefaultAppPath,
  isMarketplaceOnlyAppPath,
  isPersonalAudioAppPath,
  isPravinAppPath,
  isQuickCommerceAppPath,
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

/** Keeps marketplace, Karan, Rithika, and quick-commerce workspaces isolated per login. */
export function TenantGate({ children }: PropsWithChildren) {
  const { user, profile } = useAuth();
  const { pathname } = useLocation();
  const tenant = getAppTenant(user?.email);
  const dataScope = resolveDataScope({
    profileScope: profile?.data_scope,
    email: user?.email,
  });
  const home = getDefaultAppPath(user?.email, profile?.data_scope);

  if (dataScope === "dawg" && !isDawgAllowedAppPath(pathname)) {
    return <Navigate to={home} replace />;
  }

  if (
    tenant === "quickcommerce" &&
    (isMarketplaceOnlyAppPath(pathname) ||
      isPersonalAudioAppPath(pathname) ||
      isRithikaAppPath(pathname) ||
      isPravinAppPath(pathname))
  ) {
    return <Navigate to={home} replace />;
  }
  if (
    tenant === "marketplace" &&
    (isQuickCommerceAppPath(pathname) ||
      isPersonalAudioAppPath(pathname) ||
      isRithikaAppPath(pathname) ||
      isPravinAppPath(pathname))
  ) {
    return <Navigate to={home} replace />;
  }
  if (
    tenant === "personal_audio" &&
    (isQuickCommerceAppPath(pathname) ||
      isMarketplaceOnlyAppPath(pathname) ||
      isRithikaAppPath(pathname) ||
      isPravinAppPath(pathname))
  ) {
    const paPath = rewriteAppPathForManagerTenant(pathname, "/app/pa");
    return <Navigate to={paPath === "/app/pa" ? home : paPath} replace />;
  }
  if (
    tenant === "rithika" &&
    (isQuickCommerceAppPath(pathname) ||
      isMarketplaceOnlyAppPath(pathname) ||
      isPersonalAudioAppPath(pathname) ||
      isPravinAppPath(pathname))
  ) {
    const riPath = rewriteAppPathForManagerTenant(pathname, "/app/ri");
    return <Navigate to={riPath === "/app/ri" ? home : riPath} replace />;
  }
  if (
    tenant === "pravin" &&
    (isQuickCommerceAppPath(pathname) ||
      isMarketplaceOnlyAppPath(pathname) ||
      isPersonalAudioAppPath(pathname) ||
      isRithikaAppPath(pathname))
  ) {
    const pvPath = pathname.replace(/^\/app/, "/app/pv") || "/app/pv/upload";
    return <Navigate to={pvPath === "/app/pv" ? home : pvPath} replace />;
  }

  return children;
}

export function AppHomeRedirect() {
  const { user, profile } = useAuth();
  return <Navigate to={getDefaultAppPath(user?.email, profile?.data_scope)} replace />;
}
