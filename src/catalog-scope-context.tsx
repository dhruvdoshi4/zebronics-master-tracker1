import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from "react";
import {
  CATALOG_WORKSPACE_MONITOR,
  catalogWorkspaceLabel,
  type CatalogWorkspace,
} from "./catalog-workspace";
import {
  KARAN_SUB_CATEGORY_FILTER_LABELS,
  KARAN_SUB_CATEGORY_FILTER_OPTIONS,
  KARAN_TRACKED_SUB_CATEGORIES,
  productMatchesKaranCategoryRollup,
  type KaranSubCategory,
} from "./karan-category-scope";
import { productMatchesCategoryRollup } from "./data";
import {
  rowBelongsToManagerDashboard,
  type ManagerDashboardRow,
} from "./manager-dashboard-scope";
import {
  SUB_CATEGORY_FILTER_LABELS,
  SUB_CATEGORY_FILTER_OPTIONS,
  type SubCategory,
} from "./types";
import type { LegacyMarketplace } from "./types";
import { useAuth } from "./use-auth";
import { catalogWorkspaceFromEmail } from "./catalog-workspace";
import { isDawgDataScope, resolveDataScope } from "./data-scope";
import type { DataScope } from "./types";
import { setActiveCatalogWorkspace } from "./workspace-catalog-scope";

export type CatalogScopeApi = {
  workspace: CatalogWorkspace;
  tenantLabel: string;
  isPersonalAudio: boolean;
  trackedSubCategories: readonly string[];
  filterOptions: readonly string[];
  filterLabels: Record<string, string>;
  matchesDashboardScope: (row: ManagerDashboardRow) => boolean;
  matchesDashboardScopeForMarketplace: (
    row: ManagerDashboardRow,
    marketplace: LegacyMarketplace,
  ) => boolean;
  matchesCategoryRollup: (
    subCategory: string,
    row: {
      category?: string | null;
      sub_category?: string | null;
      product_name?: string | null;
    },
    marketplace: LegacyMarketplace,
  ) => boolean;
  uploadHistoryScope: "marketplace" | "personal_audio" | "dawg";
  isDawg: boolean;
  routePrefix: string;
};

const CatalogScopeContext = createContext<CatalogScopeApi | null>(null);

function buildScopeApi(
  workspace: CatalogWorkspace,
  dataScope: DataScope = "default",
): CatalogScopeApi {
  const isDawg = isDawgDataScope(dataScope);
  const isPersonalAudio = !isDawg && workspace === "personal_audio";
  return {
    workspace,
    tenantLabel: isDawg ? "Gaming - daWg" : catalogWorkspaceLabel(workspace),
    isPersonalAudio,
    isDawg,
    trackedSubCategories: isPersonalAudio
      ? KARAN_TRACKED_SUB_CATEGORIES
      : (["monitor", "monitor_arm", "projector", "projector_screen", "cartridge"] as const),
    filterOptions: isPersonalAudio
      ? KARAN_SUB_CATEGORY_FILTER_OPTIONS
      : SUB_CATEGORY_FILTER_OPTIONS,
    filterLabels: isPersonalAudio
      ? KARAN_SUB_CATEGORY_FILTER_LABELS
      : SUB_CATEGORY_FILTER_LABELS,
    matchesDashboardScope: (row) =>
      rowBelongsToManagerDashboard(row, { catalogWorkspace: workspace, dataScope }),
    matchesDashboardScopeForMarketplace: (row, marketplace) =>
      rowBelongsToManagerDashboard(row, {
        catalogWorkspace: workspace,
        dataScope,
        marketplace,
      }),
    matchesCategoryRollup: isPersonalAudio
      ? (sub, row, marketplace) =>
          productMatchesKaranCategoryRollup(sub as KaranSubCategory, {
            category: row.category ?? null,
            sub_category: row.sub_category ?? null,
            product_name: row.product_name ?? null,
          }, marketplace)
      : (sub, row) =>
          productMatchesCategoryRollup(sub as SubCategory, {
            category: row.category ?? null,
            sub_category: row.sub_category ?? null,
            product_name: row.product_name ?? null,
          }),
    uploadHistoryScope: isDawg
      ? "dawg"
      : isPersonalAudio
        ? "personal_audio"
        : "marketplace",
    routePrefix: isPersonalAudio ? "/app/pa" : "/app",
  };
}

export function CatalogScopeProvider({
  workspace,
  children,
}: PropsWithChildren<{ workspace?: CatalogWorkspace }>) {
  const { user, profile } = useAuth();
  const resolved = workspace ?? catalogWorkspaceFromEmail(user?.email);
  const dataScope = resolveDataScope({
    email: user?.email,
    profileScope: profile?.data_scope,
  });
  const value = useMemo(() => buildScopeApi(resolved, dataScope), [resolved, dataScope]);
  useEffect(() => {
    setActiveCatalogWorkspace(resolved);
  }, [resolved]);
  return (
    <CatalogScopeContext.Provider value={value}>{children}</CatalogScopeContext.Provider>
  );
}

export function useCatalogScope(): CatalogScopeApi {
  const ctx = useContext(CatalogScopeContext);
  if (ctx) return ctx;
  return buildScopeApi(CATALOG_WORKSPACE_MONITOR);
}
