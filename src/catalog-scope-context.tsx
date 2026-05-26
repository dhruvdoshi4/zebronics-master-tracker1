import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_RITHIKA,
  catalogWorkspaceLabel,
  type CatalogWorkspace,
} from "./catalog-workspace";
import {
  KARAN_SUB_CATEGORY_FILTER_LABELS,
  KARAN_SUB_CATEGORY_FILTER_OPTIONS,
  KARAN_TRACKED_SUB_CATEGORIES,
  parseKaranSubCategoryFilterParam,
  productMatchesKaranCategoryRollup,
  type KaranSubCategory,
} from "./karan-category-scope";
import { listDistinctRithikaSheetSubCategories, productMatchesCategoryRollup } from "./data";
import {
  rowBelongsToManagerDashboard,
  type ManagerDashboardRow,
} from "./manager-dashboard-scope";
import {
  RITHIKA_SUB_CATEGORY_FILTER_LABELS,
  RITHIKA_SUB_CATEGORY_FILTER_OPTIONS,
  RITHIKA_TRACKED_SUB_CATEGORIES,
  parseRithikaSubCategoryFilterParam,
  productMatchesRithikaCategoryRollup,
  type RithikaSubCategory,
} from "./rithika-category-scope";
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
import {
  getActiveCatalogWorkspace,
  setActiveCatalogWorkspace,
} from "./workspace-catalog-scope";

export type ManagerSubCategoryFilter =
  | SubCategory
  | KaranSubCategory
  | RithikaSubCategory
  | string;

export type CatalogScopeApi = {
  workspace: CatalogWorkspace;
  tenantLabel: string;
  isPersonalAudio: boolean;
  isRithika: boolean;
  /** Karan or Rithika — uses custom category filters (not Hari M/P). */
  isManagerWorkspace: boolean;
  trackedSubCategories: readonly string[];
  filterOptions: readonly string[];
  filterLabels: Record<string, string>;
  parseSubCategoryFilter: (raw: string | null | undefined) => ManagerSubCategoryFilter | null;
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
  uploadHistoryScope: "marketplace" | "personal_audio" | "rithika" | "dawg";
  isDawg: boolean;
  routePrefix: string;
};

const CatalogScopeContext = createContext<CatalogScopeApi | null>(null);

function buildScopeApi(
  workspace: CatalogWorkspace,
  dataScope: DataScope = "default",
): CatalogScopeApi {
  const isDawg = isDawgDataScope(dataScope);
  const isPersonalAudio = !isDawg && workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO;
  const isRithika = !isDawg && workspace === CATALOG_WORKSPACE_RITHIKA;
  const isManagerWorkspace = isPersonalAudio || isRithika;

  return {
    workspace,
    tenantLabel: isDawg ? "Gaming - daWg" : catalogWorkspaceLabel(workspace),
    isPersonalAudio,
    isRithika,
    isManagerWorkspace,
    trackedSubCategories: isPersonalAudio
      ? KARAN_TRACKED_SUB_CATEGORIES
      : isRithika
        ? RITHIKA_TRACKED_SUB_CATEGORIES
        : (["monitor", "monitor_arm", "projector", "projector_screen", "cartridge"] as const),
    filterOptions: isPersonalAudio
      ? KARAN_SUB_CATEGORY_FILTER_OPTIONS
      : isRithika
        ? RITHIKA_SUB_CATEGORY_FILTER_OPTIONS
        : SUB_CATEGORY_FILTER_OPTIONS,
    filterLabels: isPersonalAudio
      ? KARAN_SUB_CATEGORY_FILTER_LABELS
      : isRithika
        ? RITHIKA_SUB_CATEGORY_FILTER_LABELS
        : SUB_CATEGORY_FILTER_LABELS,
    parseSubCategoryFilter: isPersonalAudio
      ? parseKaranSubCategoryFilterParam
      : isRithika
        ? parseRithikaSubCategoryFilterParam
        : (raw) => {
            const decoded = raw != null ? decodeURIComponent(raw) : "";
            if (decoded === "all") return "all";
            if (
              decoded === "monitor" ||
              decoded === "monitor_arm" ||
              decoded === "projector" ||
              decoded === "projector_screen" ||
              decoded === "cartridge"
            ) {
              return decoded as SubCategory;
            }
            return null;
          },
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
      : isRithika
        ? (sub, row, marketplace) =>
            productMatchesRithikaCategoryRollup(sub, {
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
        : isRithika
          ? "rithika"
          : "marketplace",
    routePrefix: isPersonalAudio ? "/app/pa" : isRithika ? "/app/ri" : "/app",
    isDawg,
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
  const base = useMemo(() => buildScopeApi(resolved, dataScope), [resolved, dataScope]);
  const [rithikaSheetSubs, setRithikaSheetSubs] = useState<string[]>([]);

  useEffect(() => {
    setActiveCatalogWorkspace(resolved);
  }, [resolved]);

  useEffect(() => {
    if (resolved !== CATALOG_WORKSPACE_RITHIKA) {
      setRithikaSheetSubs([]);
      return;
    }
    let cancelled = false;
    void listDistinctRithikaSheetSubCategories(resolved).then((subs) => {
      if (!cancelled) setRithikaSheetSubs(subs);
    });
    return () => {
      cancelled = true;
    };
  }, [resolved]);

  const value = useMemo(() => {
    if (resolved !== CATALOG_WORKSPACE_RITHIKA) return base;
    const filterLabels: Record<string, string> = { all: "All" };
    for (const sub of rithikaSheetSubs) filterLabels[sub] = sub;
    return {
      ...base,
      trackedSubCategories: rithikaSheetSubs,
      filterOptions: ["all", ...rithikaSheetSubs],
      filterLabels,
    };
  }, [base, resolved, rithikaSheetSubs]);

  return (
    <CatalogScopeContext.Provider value={value}>{children}</CatalogScopeContext.Provider>
  );
}

export function useCatalogScope(): CatalogScopeApi {
  const ctx = useContext(CatalogScopeContext);
  const { user, profile } = useAuth();
  const dataScope = resolveDataScope({
    email: user?.email,
    profileScope: profile?.data_scope,
  });
  if (ctx) return ctx;
  const workspace = getActiveCatalogWorkspace();
  return buildScopeApi(workspace, dataScope);
}
