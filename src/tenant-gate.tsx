import type { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./use-auth";
import { isDawgAllowedAppPath, resolveDataScope } from "./data-scope";
import {
  getAppTenant,
  getDefaultAppPath,
  isMarketplaceOnlyAppPath,
  isPersonalAudioAppPath,
  isQuickCommerceAppPath,
} from "./tenants";

/** Keeps marketplace and quick-commerce workspaces isolated per login. */
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

  if (tenant === "quickcommerce" && (isMarketplaceOnlyAppPath(pathname) || isPersonalAudioAppPath(pathname))) {
    return <Navigate to={home} replace />;
  }
  if (tenant === "marketplace" && (isQuickCommerceAppPath(pathname) || isPersonalAudioAppPath(pathname))) {
    return <Navigate to={home} replace />;
  }
  if (tenant === "personal_audio" && (isQuickCommerceAppPath(pathname) || isMarketplaceOnlyAppPath(pathname))) {
    return <Navigate to={home} replace />;
  }

  return children;
}

export function AppHomeRedirect() {
  const { user, profile } = useAuth();
  return <Navigate to={getDefaultAppPath(user?.email, profile?.data_scope)} replace />;
}
