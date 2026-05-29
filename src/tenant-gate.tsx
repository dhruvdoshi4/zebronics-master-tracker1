import type { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  globalAdminPathFromMonitorPath,
  monitorPathFromGlobalAdminPath,
} from "./admin-global-scope";
import { useAuth } from "./use-auth";
import { isGlobalAdminEmail } from "./admin-realm";
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

/** Keeps global admin, Hari, Karan, Rithika, and quick-commerce workspaces isolated per login. */
export function TenantGate({ children }: PropsWithChildren) {
  const { user, profile } = useAuth();
  const { pathname } = useLocation();
  const tenant = getAppTenant(user?.email);
  const isAdmin = isGlobalAdminEmail(user?.email);
  const dataScope = resolveDataScope({
    profileScope: profile?.data_scope,
    email: user?.email,
  });
  const home = getDefaultAppPath(user?.email, profile?.data_scope);

  if (isAdmin && tenant === "quickcommerce" && isMarketplaceOnlyAppPath(pathname)) {
    return <Navigate to={home} replace />;
  }
  if (isAdmin && tenant === "global_admin" && isQuickCommerceAppPath(pathname)) {
    return <Navigate to={home} replace />;
  }

  if (dataScope === "dawg" && !isDawgAllowedAppPath(pathname)) {
    return <Navigate to={home} replace />;
  }

  if (tenant === "global_admin" && isMonitorAppPath(pathname)) {
    return <Navigate to={globalAdminPathFromMonitorPath(pathname)} replace />;
  }

  if (tenant === "monitor" && isMarketplaceOnlyAppPath(pathname)) {
    return <Navigate to={monitorPathFromGlobalAdminPath(pathname)} replace />;
  }

  if (
    tenant === "quickcommerce" &&
    (isMarketplaceOnlyAppPath(pathname) ||
      isMonitorAppPath(pathname) ||
      isPersonalAudioAppPath(pathname) ||
      isRithikaAppPath(pathname) ||
      isPravinAppPath(pathname) ||
      isRishabhAppPath(pathname))
  ) {
    return <Navigate to={home} replace />;
  }

  if (
    tenant === "global_admin" &&
    (isQuickCommerceAppPath(pathname) ||
      isPersonalAudioAppPath(pathname) ||
      isRithikaAppPath(pathname) ||
      isPravinAppPath(pathname) ||
      isRishabhAppPath(pathname))
  ) {
    return <Navigate to={home} replace />;
  }

  if (
    tenant === "marketplace" &&
    (isQuickCommerceAppPath(pathname) ||
      isMonitorAppPath(pathname) ||
      isPersonalAudioAppPath(pathname) ||
      isRithikaAppPath(pathname) ||
      isPravinAppPath(pathname) ||
      isRishabhAppPath(pathname))
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
    const paPath =
      pathname === "/app" || pathname === "/app/"
        ? "/app/pa/upload"
        : pathname.startsWith("/app/pa")
          ? pathname
          : `/app/pa${pathname.slice("/app".length)}`;
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
    const riPath =
      pathname === "/app" || pathname === "/app/"
        ? "/app/ri/upload"
        : pathname.startsWith("/app/ri")
          ? pathname
          : `/app/ri${pathname.slice("/app".length)}`;
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
    const pvPath =
      pathname === "/app" || pathname === "/app/"
        ? "/app/pv/upload"
        : pathname.startsWith("/app/pv")
          ? pathname
          : `/app/pv${pathname.slice("/app".length)}`;
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
    const haPath =
      pathname === "/app" || pathname === "/app/"
        ? "/app/ha/upload"
        : pathname.startsWith("/app/ha")
          ? pathname
          : `/app/ha${pathname.slice("/app".length)}`;
    return <Navigate to={haPath === "/app/ha" ? home : haPath} replace />;
  }

  return children;
}

export function AppHomeRedirect() {
  const { user, profile } = useAuth();
  return <Navigate to={getDefaultAppPath(user?.email, profile?.data_scope)} replace />;
}
