import { createContext, useContext, useMemo, type PropsWithChildren } from "react";
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
  productMatchesKaranDashboardScope,
  type KaranSubCategory,
} from "./karan-category-scope";
import { productMatchesCategoryRollup } from "./data";
import { productMatchesMarketplaceDashboardScope } from "./marketplace-dashboard-scope";
import {
  SUB_CATEGORY_FILTER_LABELS,
  SUB_CATEGORY_FILTER_OPTIONS,
  type SubCategory,
} from "./types";
import type { LegacyMarketplace } from "./types";
import { useAuth } from "./use-auth";
import { catalogWorkspaceFromEmail } from "./catalog-workspace";

export type CatalogScopeApi = {
  workspace: CatalogWorkspace;
  tenantLabel: string;
  isPersonalAudio: boolean;
  trackedSubCategories: readonly string[];
  filterOptions: readonly string[];
  filterLabels: Record<string, string>;
  matchesDashboardScope: (row: {
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
    catalog_workspace?: string | null;
  }) => boolean;
  matchesCategoryRollup: (
    subCategory: string,
    row: {
      category?: string | null;
      sub_category?: string | null;
      product_name?: string | null;
    },
    marketplace: LegacyMarketplace,
  ) => boolean;
  uploadHistoryScope: "marketplace" | "personal_audio";
  routePrefix: string;
};

const CatalogScopeContext = createContext<CatalogScopeApi | null>(null);

function buildScopeApi(workspace: CatalogWorkspace): CatalogScopeApi {
  const isPersonalAudio = workspace === "personal_audio";
  return {
    workspace,
    tenantLabel: catalogWorkspaceLabel(workspace),
    isPersonalAudio,
    trackedSubCategories: isPersonalAudio
      ? KARAN_TRACKED_SUB_CATEGORIES
      : (["monitor", "monitor_arm", "projector", "projector_screen", "cartridge"] as const),
    filterOptions: isPersonalAudio
      ? KARAN_SUB_CATEGORY_FILTER_OPTIONS
      : SUB_CATEGORY_FILTER_OPTIONS,
    filterLabels: isPersonalAudio
      ? KARAN_SUB_CATEGORY_FILTER_LABELS
      : SUB_CATEGORY_FILTER_LABELS,
    matchesDashboardScope: isPersonalAudio
      ? productMatchesKaranDashboardScope
      : (row) =>
          productMatchesMarketplaceDashboardScope({
            category: row.category ?? null,
            sub_category: row.sub_category ?? null,
            product_name: row.product_name ?? null,
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
    uploadHistoryScope: isPersonalAudio ? "personal_audio" : "marketplace",
    routePrefix: isPersonalAudio ? "/app/pa" : "/app",
  };
}

export function CatalogScopeProvider({
  workspace,
  children,
}: PropsWithChildren<{ workspace?: CatalogWorkspace }>) {
  const { user } = useAuth();
  const resolved = workspace ?? catalogWorkspaceFromEmail(user?.email);
  const value = useMemo(() => buildScopeApi(resolved), [resolved]);
  return (
    <CatalogScopeContext.Provider value={value}>{children}</CatalogScopeContext.Provider>
  );
}

export function useCatalogScope(): CatalogScopeApi {
  const ctx = useContext(CatalogScopeContext);
  if (ctx) return ctx;
  return buildScopeApi(CATALOG_WORKSPACE_MONITOR);
}
