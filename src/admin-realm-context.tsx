import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useNavigate } from "react-router-dom";
import type { CatalogWorkspace } from "./catalog-workspace";
import {
  adminRealmHomePath,
  adminRealmLabel,
  type AdminDashboardViewMode,
  type AdminRealm,
  isGlobalAdminEmail,
  readStoredAdminRealm,
  writeStoredAdminRealm,
} from "./admin-realm";
import { useAuth } from "./use-auth";

type AdminRealmContextValue = {
  isGlobalAdmin: boolean;
  realm: AdminRealm;
  isMarketplaceGlobal: boolean;
  isQcomRealm: boolean;
  realmLabel: string;
  setRealm: (realm: AdminRealm) => void;
  toggleRealm: () => void;
  impersonatedWorkspace: CatalogWorkspace | null;
  setImpersonatedWorkspace: (workspace: CatalogWorkspace | null) => void;
  dashboardViewMode: AdminDashboardViewMode | null;
  setDashboardViewMode: (mode: AdminDashboardViewMode | null) => void;
};

const AdminRealmContext = createContext<AdminRealmContextValue | null>(null);

export function AdminRealmProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isGlobalAdmin = isGlobalAdminEmail(user?.email);
  const [realm, setRealmState] = useState<AdminRealm>(() =>
    isGlobalAdmin ? readStoredAdminRealm() : "marketplace_global",
  );
  const [impersonatedWorkspace, setImpersonatedWorkspace] =
    useState<CatalogWorkspace | null>(null);
  const [dashboardViewMode, setDashboardViewMode] = useState<AdminDashboardViewMode | null>(
    null,
  );

  const setRealm = useCallback(
    (next: AdminRealm) => {
      if (!isGlobalAdmin) return;
      writeStoredAdminRealm(next);
      setRealmState(next);
      setImpersonatedWorkspace(null);
      setDashboardViewMode(null);
      navigate(adminRealmHomePath(next), { replace: true });
    },
    [isGlobalAdmin, navigate],
  );

  const toggleRealm = useCallback(() => {
    setRealm(realm === "qcom" ? "marketplace_global" : "qcom");
  }, [realm, setRealm]);

  const value = useMemo<AdminRealmContextValue>(
    () => ({
      isGlobalAdmin,
      realm: isGlobalAdmin ? realm : "marketplace_global",
      isMarketplaceGlobal: isGlobalAdmin && realm === "marketplace_global",
      isQcomRealm: isGlobalAdmin && realm === "qcom",
      realmLabel: adminRealmLabel(isGlobalAdmin ? realm : "marketplace_global"),
      setRealm,
      toggleRealm,
      impersonatedWorkspace,
      setImpersonatedWorkspace,
      dashboardViewMode,
      setDashboardViewMode,
    }),
    [
      isGlobalAdmin,
      realm,
      setRealm,
      toggleRealm,
      impersonatedWorkspace,
      dashboardViewMode,
    ],
  );

  return (
    <AdminRealmContext.Provider value={value}>{children}</AdminRealmContext.Provider>
  );
}

export function useAdminRealm(): AdminRealmContextValue {
  const ctx = useContext(AdminRealmContext);
  if (!ctx) {
    return {
      isGlobalAdmin: false,
      realm: "marketplace_global",
      isMarketplaceGlobal: false,
      isQcomRealm: false,
      realmLabel: adminRealmLabel("marketplace_global"),
      setRealm: () => undefined,
      toggleRealm: () => undefined,
      impersonatedWorkspace: null,
      setImpersonatedWorkspace: () => undefined,
      dashboardViewMode: null,
      setDashboardViewMode: () => undefined,
    };
  }
  return ctx;
}
