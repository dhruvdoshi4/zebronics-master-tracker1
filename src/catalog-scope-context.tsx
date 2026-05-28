import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {
  CATALOG_WORKSPACE_HOME_AUDIO,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_PRAVIN,
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
import {
  listDistinctPravinSheetSubCategories,
  listDistinctRishabhSheetSubCategories,
  listDistinctRithikaSheetSubCategories,
  productMatchesCategoryRollup,
} from "./data";
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
  PRAVIN_SUB_CATEGORY_FILTER_LABELS,
  PRAVIN_SUB_CATEGORY_FILTER_OPTIONS,
  PRAVIN_TOP_CATEGORIES,
  parsePravinSubCategoryFilterParam,
  productMatchesPravinCategoryRollup,
  type PravinSubCategoryFilter,
} from "./pravin-category-scope";
import {
  RISHABH_SUB_CATEGORY_FILTER_LABELS,
  RISHABH_SUB_CATEGORY_FILTER_OPTIONS,
  parseRishabhSubCategoryFilterParam,
  productMatchesRishabhCategoryRollup,
} from "./rishabh-category-scope";
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
  | PravinSubCategoryFilter
  | string;

export type CatalogScopeApi = {
  workspace: CatalogWorkspace;
  tenantLabel: string;
  isPersonalAudio: boolean;
  isRithika: boolean;
  isPravin: boolean;
  isRishabh: boolean;
  /** Karan, Rithika, Pravin, or Rishabh — uses custom category filters (not Hari M/P). */
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
  uploadHistoryScope:
    | "marketplace"
    | "personal_audio"
    | "rithika"
    | "pravin"
    | "home_audio"
    | "dawg";
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
  const isPravin = !isDawg && workspace === CATALOG_WORKSPACE_PRAVIN;
  const isRishabh = !isDawg && workspace === CATALOG_WORKSPACE_HOME_AUDIO;
  const isManagerWorkspace = isPersonalAudio || isRithika || isPravin || isRishabh;

  return {
    workspace,
    tenantLabel: isDawg ? "Gaming - daWg" : catalogWorkspaceLabel(workspace),
    isPersonalAudio,
    isRithika,
    isPravin,
    isRishabh,
    isManagerWorkspace,
    trackedSubCategories: isPersonalAudio
      ? KARAN_TRACKED_SUB_CATEGORIES
      : isRithika
        ? RITHIKA_TRACKED_SUB_CATEGORIES
        : isPravin
          ? PRAVIN_TOP_CATEGORIES
          : (["monitor", "monitor_arm", "projector", "projector_screen", "cartridge"] as const),
    filterOptions: isPersonalAudio
      ? KARAN_SUB_CATEGORY_FILTER_OPTIONS
      : isRithika
        ? RITHIKA_SUB_CATEGORY_FILTER_OPTIONS
        : isPravin
          ? PRAVIN_SUB_CATEGORY_FILTER_OPTIONS
          : isRishabh
            ? RISHABH_SUB_CATEGORY_FILTER_OPTIONS
            : SUB_CATEGORY_FILTER_OPTIONS,
    filterLabels: isPersonalAudio
      ? KARAN_SUB_CATEGORY_FILTER_LABELS
      : isRithika
        ? RITHIKA_SUB_CATEGORY_FILTER_LABELS
        : isPravin
          ? PRAVIN_SUB_CATEGORY_FILTER_LABELS
          : isRishabh
            ? RISHABH_SUB_CATEGORY_FILTER_LABELS
            : SUB_CATEGORY_FILTER_LABELS,
    parseSubCategoryFilter: isPersonalAudio
      ? parseKaranSubCategoryFilterParam
      : isRithika
        ? parseRithikaSubCategoryFilterParam
        : isPravin
          ? parsePravinSubCategoryFilterParam
          : isRishabh
            ? parseRishabhSubCategoryFilterParam
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
      rowBelongsToManagerDashboard(
        isPravin
          ? {
              ...row,
              catalog_workspace:
                row.catalog_workspace ?? CATALOG_WORKSPACE_PRAVIN,
            }
          : row,
        { catalogWorkspace: workspace, dataScope },
      ),
    matchesDashboardScopeForMarketplace: (row, marketplace) =>
      rowBelongsToManagerDashboard(
        isPravin
          ? {
              ...row,
              catalog_workspace:
                row.catalog_workspace ?? CATALOG_WORKSPACE_PRAVIN,
            }
          : row,
        {
          catalogWorkspace: workspace,
          dataScope,
          marketplace,
        },
      ),
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
        : isPravin
          ? (sub, row) =>
              productMatchesPravinCategoryRollup(sub, {
                category: row.category ?? null,
                sub_category: row.sub_category ?? null,
                product_name: row.product_name ?? null,
              })
          : isRishabh
            ? (sub, row) =>
                productMatchesRishabhCategoryRollup(sub, {
                  category: row.category ?? null,
                  sub_category: row.sub_category ?? null,
                  product_name: row.product_name ?? null,
                })
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
          : isPravin
            ? "pravin"
            : isRishabh
              ? "home_audio"
              : "marketplace",
    routePrefix: isPersonalAudio
      ? "/app/pa"
      : isRithika
        ? "/app/ri"
        : isPravin
          ? "/app/pv"
          : isRishabh
            ? "/app/ha"
            : "/app",
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
  const [pravinSheetSubs, setPravinSheetSubs] = useState<string[]>([]);
  const [rishabhSheetSubs, setRishabhSheetSubs] = useState<string[]>([]);

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

  useEffect(() => {
    if (resolved !== CATALOG_WORKSPACE_PRAVIN) {
      setPravinSheetSubs([]);
      return;
    }
    let cancelled = false;
    void listDistinctPravinSheetSubCategories(resolved).then((subs) => {
      if (!cancelled) setPravinSheetSubs(subs);
    });
    return () => {
      cancelled = true;
    };
  }, [resolved]);

  useEffect(() => {
    if (resolved !== CATALOG_WORKSPACE_HOME_AUDIO) {
      setRishabhSheetSubs([]);
      return;
    }
    let cancelled = false;
    void listDistinctRishabhSheetSubCategories(resolved).then((subs) => {
      if (!cancelled) setRishabhSheetSubs(subs);
    });
    return () => {
      cancelled = true;
    };
  }, [resolved]);

  const value = useMemo(() => {
    if (resolved === CATALOG_WORKSPACE_RITHIKA) {
      const filterLabels: Record<string, string> = { all: "All" };
      for (const sub of rithikaSheetSubs) filterLabels[sub] = sub;
      return {
        ...base,
        trackedSubCategories: rithikaSheetSubs,
        filterOptions: ["all", ...rithikaSheetSubs],
        filterLabels,
      };
    }
    if (resolved === CATALOG_WORKSPACE_PRAVIN) {
      const filterLabels: Record<string, string> = { all: "All" };
      for (const sub of pravinSheetSubs) filterLabels[sub] = sub;
      return {
        ...base,
        trackedSubCategories: pravinSheetSubs,
        filterOptions: ["all", ...pravinSheetSubs],
        filterLabels,
      };
    }
    if (resolved === CATALOG_WORKSPACE_HOME_AUDIO) {
      const filterLabels: Record<string, string> = { all: "All" };
      for (const sub of rishabhSheetSubs) filterLabels[sub] = sub;
      return {
        ...base,
        trackedSubCategories: rishabhSheetSubs,
        filterOptions: ["all", ...rishabhSheetSubs],
        filterLabels,
      };
    }
    return base;
  }, [base, resolved, rithikaSheetSubs, pravinSheetSubs, rishabhSheetSubs]);

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
