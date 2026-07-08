import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AdminDashboardLanding } from "./admin-dashboard-landing";
import { useAdminRealm } from "./admin-realm-context";
import type { AdminDashboardViewMode } from "./admin-realm";
import {
  ANALYSIS_CATEGORY_ALL,
  ANALYSIS_SUB_CATEGORY_ALL,
  analysisCategoryToUrlSegment,
} from "./analysis-category-paths";
import type { CatalogWorkspace } from "./catalog-workspace";
import { CategorySubCategoryFilterControls } from "./category-subcategory-filter-controls";
import {
  DimensionCycleTableHeader,
  sortLabelsAlphabetically,
  useCategorySubCategoryCycle,
} from "./category-subcategory-cycle";
import { useCatalogScope } from "./catalog-scope-context";
import {
  KARAN_TOP_CATEGORIES,
  karanDashboardSheetCategory,
  karanDashboardSubCategoryDisplayOptions,
  karanDashboardSubCategoryLabel,
} from "./karan-category-scope";
import {
  PRAVIN_TOP_CATEGORIES,
  pravinDashboardSheetCategory,
  pravinDashboardSubCategoryDisplayOptions,
  productMatchesPravinCategoryRollup,
} from "./pravin-category-scope";
import {
  RITHIKA_TOP_CATEGORIES,
  rithikaDashboardSheetCategory,
  rithikaDashboardSubCategoryLabel,
  sheetSubCategoryLabel,
} from "./rithika-category-scope";
import { rithikaDashboardSubCategoryDisplayOptions } from "./rithika-sheet-taxonomy";
import {
  RISHABH_TOP_CATEGORIES,
  productMatchesRishabhCategoryRollup,
  rishabhDashboardSubCategoryDisplayOptions,
  rowPassesRishabhItAccessoriesScope,
} from "./rishabh-category-scope";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardRatingsPanel } from "./dashboard-ratings-panel";
import {
  getLatestRatingsUploadMeta,
  loadAdminGlobalRatingsDashboardRows,
  loadRatingsDashboardRows,
  type ProductRatingsRow,
} from "./data-ratings";
import {
  getDashboardRecords,
  productMatchesCategoryAnalysisSelection,
} from "./data";
import {
  adminGlobalDashboardSubCategoryLabel,
  adminGlobalDashboardTopCategory,
} from "./admin-global-dashboard-category";
import {
  getAdminGlobalDashboardRecords,
  listAdminGlobalAnalysisCategoryTree,
} from "./admin-dashboard-data";
import {
  resolveManagerCatalogWorkspaceForRow,
  rowBelongsToAnyManagerDashboard,
} from "./admin-global-scope";
import { analysisSubCategoryOptionLabel } from "./analysis-category-filters";
import { catalogWorkspaceManagerName } from "./catalog-workspace";
import { dashboardListingModelPath } from "./product-channel";
import { PO_COVERAGE_TARGET_DAYS } from "./metrics";
import {
  type DashboardRecord,
  type LegacyMarketplace,
  type Marketplace,
} from "./types";
import { CHART_AXIS_TICK, CHART_GRID_STROKE } from "./chart-theme";
import {
  Card,
  ChartTooltip,
  DataAsOnRangeBadge,
  EmptyState,
  InlineLoader,
  PageTitle,
  SortableTableHeader,
  StatCard,
} from "./ui";
import { useTableSort } from "./table-sort";
import { displayModelName } from "./product-display";
import {
  cn,
  formatDecimal,
  formatCoverageDataAsOf,
  formatSelloutDrr,
  formatInteger,
  sheetCoverageMinMax,
} from "./utils";

function formatDayMonthColumnLabel(isoYyyyMmDd: string): string {
  const d = new Date(`${isoYyyyMmDd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoYyyyMmDd;
  const day = d.getDate();
  const month = d.toLocaleString("en-IN", { month: "short" });
  return `${day} ${month}`;
}

function selloutReportAnchorDate(records: DashboardRecord[]): string | null {
  return records.reduce<string | null>((max, row) => {
    const d = String(row.as_of_date ?? "").trim().slice(0, 10);
    if (!d) return max;
    return !max || d > max ? d : max;
  }, null);
}

/** Sheet report-month MTD column label (e.g. Jun MTD when coverage is June). */
function reportMonthMtdColumnLabel(anchorIso: string | null): string {
  if (!anchorIso) return "MTD";
  const d = new Date(`${anchorIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "MTD";
  return `${d.toLocaleString("en-US", { month: "short" })} MTD`;
}

/** Prior calendar month SO column (e.g. May SO when report is June). */
function priorMonthSoColumnLabel(anchorIso: string | null): string {
  if (!anchorIso) return "Prior month SO";
  const d = new Date(`${anchorIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "Prior month SO";
  d.setMonth(d.getMonth() - 1);
  return `${d.toLocaleString("en-US", { month: "short" })} SO`;
}

function warehouseTotalStockUnits(row: DashboardRecord): number {
  return Math.max(0, row.ho_units ?? 0) + Math.max(0, row.gurgaon_units ?? 0);
}

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

type DashboardView = "po" | "ratings";

export function DashboardPage({ marketplace }: { marketplace: Marketplace }) {
  const {
    workspace,
    routePrefix,
    isPersonalAudio,
    isPravin,
    isRithika,
    isRishabh,
    isManagerWorkspace,
    matchesDashboardScopeForMarketplace,
  } = useCatalogScope();
  const {
    isMarketplaceGlobal,
    dashboardViewMode,
    setDashboardViewMode,
    impersonatedWorkspace,
    setImpersonatedWorkspace,
  } = useAdminRealm();
  const legacyMarketplace = marketplace as LegacyMarketplace;
  const [adminScopeReady, setAdminScopeReady] = useState(false);
  const [pendingManagerWorkspace, setPendingManagerWorkspace] = useState<
    CatalogWorkspace | ""
  >("");
  const [adminCategoryRaw, setAdminCategoryRaw] = useState(ANALYSIS_CATEGORY_ALL);
  const [adminSubCategory, setAdminSubCategory] = useState(ANALYSIS_SUB_CATEGORY_ALL);
  const [adminCategoryTree, setAdminCategoryTree] = useState<{
    categories: string[];
    subCategoriesByCategory: Record<string, string[]>;
  }>({ categories: [ANALYSIS_CATEGORY_ALL], subCategoriesByCategory: {} });
  const [adminCategoryLoading, setAdminCategoryLoading] = useState(false);
  const [view, setView] = useState<DashboardView>("po");
  const [records, setRecords] = useState<DashboardRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ratingsRows, setRatingsRows] = useState<ProductRatingsRow[]>([]);
  const [ratingsLoading, setRatingsLoading] = useState(false);
  const [ratingsError, setRatingsError] = useState<string | null>(null);
  const [ratingsMeta, setRatingsMeta] = useState<{
    snapshotDate: string | null;
    fileName: string | null;
  }>({ snapshotDate: null, fileName: null });
  const [chartsReady, setChartsReady] = useState(false);

  useEffect(() => {
    void getLatestRatingsUploadMeta().then(setRatingsMeta);
  }, []);

  useEffect(() => {
    setAdminScopeReady(false);
    setDashboardViewMode(null);
    setImpersonatedWorkspace(null);
    setPendingManagerWorkspace("");
  }, [marketplace, setDashboardViewMode, setImpersonatedWorkspace]);

  useEffect(() => {
    if (!isMarketplaceGlobal) return;
    setAdminCategoryLoading(true);
    void listAdminGlobalAnalysisCategoryTree()
      .then(setAdminCategoryTree)
      .finally(() => setAdminCategoryLoading(false));
  }, [isMarketplaceGlobal]);

  const adminNeedsLanding = isMarketplaceGlobal && !adminScopeReady;

  const adminCategoryOptions = useMemo(
    () =>
      adminCategoryTree.categories.map((raw) => ({
        raw,
        segment: analysisCategoryToUrlSegment(raw),
        label: raw === ANALYSIS_CATEGORY_ALL ? "All categories" : raw,
      })),
    [adminCategoryTree.categories],
  );

  const adminSubCategoryOptions = useMemo(() => {
    const list = adminCategoryRaw === ANALYSIS_CATEGORY_ALL
      ? (adminCategoryTree.subCategoriesByCategory[ANALYSIS_CATEGORY_ALL] ?? [])
      : (adminCategoryTree.subCategoriesByCategory[adminCategoryRaw] ?? []);
    return list.map((sub) => ({ value: sub, label: analysisSubCategoryOptionLabel(sub) }));
  }, [adminCategoryRaw, adminCategoryTree.subCategoriesByCategory]);

  useEffect(() => {
    if (adminNeedsLanding) {
      setIsLoading(false);
      return;
    }
    if (view !== "po") return;
    setIsLoading(true);
    setError(null);

    const activeCatalogWorkspace = impersonatedWorkspace ?? workspace;

    const load =
      isMarketplaceGlobal && dashboardViewMode === "category"
        ? getAdminGlobalDashboardRecords(legacyMarketplace)
        : getDashboardRecords(marketplace, activeCatalogWorkspace);

    void load
      .then((dashboardRows) => {
        setRecords(dashboardRows);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load dashboard.");
      })
      .finally(() => setIsLoading(false));
  }, [
    adminNeedsLanding,
    marketplace,
    view,
    workspace,
    isMarketplaceGlobal,
    dashboardViewMode,
    adminCategoryRaw,
    adminSubCategory,
    legacyMarketplace,
    impersonatedWorkspace,
  ]);

  useEffect(() => {
    if (view !== "ratings") return;
    setRatingsLoading(true);
    setRatingsError(null);
    const ratingsLoad =
      isMarketplaceGlobal && dashboardViewMode === "category"
        ? loadAdminGlobalRatingsDashboardRows(marketplace)
        : loadRatingsDashboardRows(
            marketplace,
            undefined,
            impersonatedWorkspace ?? workspace,
          );
    void ratingsLoad
      .then(setRatingsRows)
      .catch((e: unknown) => {
        setRatingsError(e instanceof Error ? e.message : "Failed to load ratings.");
        setRatingsRows([]);
      })
      .finally(() => setRatingsLoading(false));
  }, [
    marketplace,
    view,
    workspace,
    impersonatedWorkspace,
    isMarketplaceGlobal,
    dashboardViewMode,
  ]);

  const filterSourceRows = view === "po" ? records : ratingsRows;

  type FilterRow = {
    category?: string | null;
    sub_category?: string | null;
    product_name?: string | null;
    model_name?: string | null;
  };

  const karanRowFields = (row: FilterRow) => ({
    category: row.category ?? null,
    sub_category: row.sub_category ?? null,
    product_name: row.product_name ?? row.model_name ?? null,
  });

  const matchesDashboardScopeFn = useMemo(
    () => (row: FilterRow) =>
      matchesDashboardScopeForMarketplace(karanRowFields(row), legacyMarketplace),
    [legacyMarketplace, matchesDashboardScopeForMarketplace],
  );

  const cyclePreFilter = useMemo(() => {
    if (isMarketplaceGlobal && dashboardViewMode === "category") {
      return (row: FilterRow) =>
        rowBelongsToAnyManagerDashboard(
          {
            category: row.category ?? null,
            sub_category: row.sub_category ?? null,
            product_name: row.product_name ?? row.model_name ?? null,
            catalog_workspace: null,
          },
          legacyMarketplace,
        );
    }
    return matchesDashboardScopeFn;
  }, [isMarketplaceGlobal, dashboardViewMode, matchesDashboardScopeFn, legacyMarketplace]);

  const getDashboardCategory = useMemo(
    () => (row: FilterRow) => {
      if (isMarketplaceGlobal && dashboardViewMode === "category") {
        return adminGlobalDashboardTopCategory(row, legacyMarketplace);
      }
      if (isPersonalAudio) {
        return karanDashboardSheetCategory(karanRowFields(row), legacyMarketplace);
      }
      if (isPravin) {
        return pravinDashboardSheetCategory(karanRowFields(row));
      }
      if (isRithika) {
        return rithikaDashboardSheetCategory(karanRowFields(row), legacyMarketplace);
      }
      if (isRishabh) {
        const fields = karanRowFields(row);
        if (
          rowPassesRishabhItAccessoriesScope(
            String(fields.category ?? ""),
            String(fields.sub_category ?? ""),
            String(fields.product_name ?? ""),
          )
        ) {
          return "IT Accessories";
        }
        return "Home Audio";
      }
      return "category" in row ? row.category : null;
    },
    [
      isMarketplaceGlobal,
      dashboardViewMode,
      isPersonalAudio,
      isPravin,
      isRithika,
      isRishabh,
      legacyMarketplace,
    ],
  );

  const getDashboardSubCategory = useMemo(
    () => (row: FilterRow) => {
      if (isMarketplaceGlobal && dashboardViewMode === "category") {
        return adminGlobalDashboardSubCategoryLabel(row, legacyMarketplace);
      }
      if (isPersonalAudio) {
        return karanDashboardSubCategoryLabel(karanRowFields(row), legacyMarketplace);
      }
      if (isRithika) {
        const fields = karanRowFields(row);
        return (
          rithikaDashboardSubCategoryLabel(fields, legacyMarketplace) ||
          sheetSubCategoryLabel(fields) ||
          (row.sub_category ?? null)
        );
      }
      return row.sub_category ?? null;
    },
    [isMarketplaceGlobal, dashboardViewMode, isPersonalAudio, isRithika, legacyMarketplace],
  );

  const {
    category,
    setCategory,
    categories,
    categoryList,
    subCategoryList,
    filteredRows: cycleFilteredRecords,
    categoryCycleIndex,
    categoryCycleDirection,
    subCategoryCycleIndex,
    subCategoryCycleDirection,
    handleCategoryCycle,
    handleSubCategoryCycle,
    scopeLabel,
    activeCycleBadge,
    getDimensionCellValue,
  } = useCategorySubCategoryCycle({
    rows: filterSourceRows,
    getCategory: getDashboardCategory,
    getSubCategory: getDashboardSubCategory,
    preFilter: cyclePreFilter,
  });

  const dashboardSubCategoryOptions = useMemo(() => {
    let canonical: string[] = [];
    if (isPersonalAudio) {
      canonical = karanDashboardSubCategoryDisplayOptions(category);
    } else if (isRithika) {
      canonical = rithikaDashboardSubCategoryDisplayOptions(category);
    } else if (isRishabh) {
      canonical = rishabhDashboardSubCategoryDisplayOptions(category);
    } else if (isPravin) {
      canonical = pravinDashboardSubCategoryDisplayOptions(category);
    }
    if (canonical.length === 0) return subCategoryList;
    return sortLabelsAlphabetically([...new Set([...canonical, ...subCategoryList])]);
  }, [
    category,
    isPersonalAudio,
    isRithika,
    isRishabh,
    isPravin,
    subCategoryList,
  ]);

  const dashboardCategories = useMemo(() => {
    if (isMarketplaceGlobal && dashboardViewMode === "category") {
      return adminCategoryTree.categories.map((c) =>
        c === ANALYSIS_CATEGORY_ALL ? "all" : c,
      );
    }
    if (isPravin) return ["all", ...PRAVIN_TOP_CATEGORIES];
    if (isPersonalAudio) return ["all", ...KARAN_TOP_CATEGORIES];
    if (isRithika) return ["all", ...RITHIKA_TOP_CATEGORIES];
    if (isRishabh) return ["all", ...RISHABH_TOP_CATEGORIES];
    if (!isManagerWorkspace || legacyMarketplace !== "flipkart") return categories;
    if (categories.includes("IT Accessories")) return categories;
    const next = [...categories];
    const allAt = next.indexOf("all");
    next.splice(allAt >= 0 ? allAt + 1 : 0, 0, "IT Accessories");
    return next;
  }, [
    categories,
    isManagerWorkspace,
    isMarketplaceGlobal,
    dashboardViewMode,
    adminCategoryTree.categories,
    isPersonalAudio,
    isPravin,
    isRithika,
    isRishabh,
    legacyMarketplace,
  ]);

  const [sheetSubCategory, setSheetSubCategory] = useState("all");

  useEffect(() => {
    setSheetSubCategory("all");
  }, [category]);

  useEffect(() => {
    if (!adminScopeReady || !isMarketplaceGlobal || dashboardViewMode !== "category") {
      return;
    }
    const initial =
      adminCategoryRaw === ANALYSIS_CATEGORY_ALL ? "all" : adminCategoryRaw;
    setCategory(initial);
  }, [
    adminScopeReady,
    isMarketplaceGlobal,
    dashboardViewMode,
    adminCategoryRaw,
    setCategory,
  ]);

  useEffect(() => {
    if (!dashboardCategories.includes(category)) {
      setCategory("all");
    }
  }, [dashboardCategories, category, setCategory]);

  const applySheetSubCategoryFilter = <T extends FilterRow>(list: T[]): T[] => {
    if (sheetSubCategory === "all") return list;
    if (isPersonalAudio) {
      return list.filter(
        (r) =>
          karanDashboardSubCategoryLabel(karanRowFields(r), legacyMarketplace) ===
          sheetSubCategory,
      );
    }
    if (isMarketplaceGlobal && dashboardViewMode === "category") {
      const selectedCategory =
        category === "all" ? ANALYSIS_CATEGORY_ALL : category;
      return list.filter((r) => {
        const fields = karanRowFields(r);
        const managerWorkspace =
          resolveManagerCatalogWorkspaceForRow(
            { ...fields, catalog_workspace: null },
            legacyMarketplace,
          ) ?? null;
        if (!managerWorkspace) return false;
        return productMatchesCategoryAnalysisSelection(
          selectedCategory,
          sheetSubCategory,
          fields,
          { catalogWorkspace: managerWorkspace, dataScope: "default" },
        );
      });
    }
    if (isRithika) {
      return list.filter((r) => getDashboardSubCategory(r)?.trim() === sheetSubCategory);
    }
    if (isRishabh) {
      return list.filter((r) =>
        productMatchesRishabhCategoryRollup(sheetSubCategory, karanRowFields(r)),
      );
    }
    if (isPravin) {
      return list.filter((r) =>
        productMatchesPravinCategoryRollup(sheetSubCategory, karanRowFields(r)),
      );
    }
    return list.filter((r) => {
      const derived = getDashboardSubCategory(r)?.trim();
      if (derived && derived === sheetSubCategory) return true;
      return (r.sub_category ?? "").trim() === sheetSubCategory;
    });
  };

  const filteredRecords = useMemo(
    () => applySheetSubCategoryFilter(cycleFilteredRecords as DashboardRecord[]),
    [cycleFilteredRecords, category, sheetSubCategory],
  );

  const filteredRatingsRows = useMemo(
    () => applySheetSubCategoryFilter(cycleFilteredRecords as ProductRatingsRow[]),
    [cycleFilteredRecords, category, sheetSubCategory],
  );

  const kpis = useMemo(() => {
    const totalPo = filteredRecords.reduce(
      (acc, row) => acc + row.purchase_order_units,
      0,
    );
    return { totalPo };
  }, [filteredRecords]);

  const metricsMissingWarning = useMemo(() => {
    if (view !== "po" || filteredRecords.length === 0) return false;
    const hasInventoryOrSellout = filteredRecords.some(
      (row) =>
        (row.inventory_units ?? 0) > 0 ||
        (row.total_so_units ?? 0) > 0 ||
        (row.may_mtd_units ?? 0) > 0,
    );
    return !hasInventoryOrSellout;
  }, [filteredRecords, view]);

  const poLoading = view === "po" && isLoading;

  const last7SoDates = useMemo(() => {
    const sample = filteredRecords.find((row) => row.last3DaysSo?.length);
    return sample?.last3DaysSo?.map((point) => point.sale_date) ?? [];
  }, [filteredRecords]);

  const latestColumnSellout = useMemo(() => {
    if (view !== "po" || filteredRecords.length === 0) {
      return { saleDate: null, totalUnits: 0, usesMtdFallback: false };
    }
    const latestDay = last7SoDates[0] ?? null;
    if (latestDay) {
      const totalUnits = filteredRecords.reduce(
        (sum, row) => sum + Math.max(0, row.last3DaysSo?.[0]?.units_sold ?? 0),
        0,
      );
      return { saleDate: latestDay, totalUnits, usesMtdFallback: false };
    }
    const saleDate = selloutReportAnchorDate(filteredRecords);
    const totalUnits = filteredRecords.reduce(
      (sum, row) => sum + Math.max(0, row.may_mtd_units ?? 0),
      0,
    );
    return { saleDate, totalUnits, usesMtdFallback: true };
  }, [filteredRecords, view, last7SoDates]);

  useEffect(() => {
    if (view !== "po" || poLoading || filteredRecords.length === 0) {
      setChartsReady(false);
      return;
    }
    const frame = requestAnimationFrame(() => setChartsReady(true));
    return () => {
      cancelAnimationFrame(frame);
      setChartsReady(false);
    };
  }, [view, poLoading, filteredRecords.length, category, sheetSubCategory]);

  const dashboardCoverage = useMemo(
    () => sheetCoverageMinMax(filteredRecords),
    [filteredRecords],
  );

  const codeLabel = getCodeLabel(marketplace);

  const reportAnchorDate = useMemo(
    () => selloutReportAnchorDate(filteredRecords),
    [filteredRecords],
  );
  const mtdColumnLabel = useMemo(
    () => reportMonthMtdColumnLabel(reportAnchorDate),
    [reportAnchorDate],
  );
  const priorMonthSoLabel = useMemo(
    () => priorMonthSoColumnLabel(reportAnchorDate),
    [reportAnchorDate],
  );

  const dashboardSortAccessors = useMemo(() => {
    const accessors: import("./table-sort").TableSortAccessors<DashboardRecord> = {
      product_code: (row) => row.product_code,
      model: (row) => displayModelName(row.product_name, row.product_code),
      category: (row) => row.category ?? "",
      sub_category: (row) =>
        isPersonalAudio
          ? (karanDashboardSubCategoryLabel(
              {
                category: row.category,
                sub_category: row.sub_category,
                product_name: row.product_name,
              },
              legacyMarketplace,
            ) ?? "")
          : (row.sub_category ?? ""),
      inventory_units: (row) => row.inventory_units,
      doc_days: (row) => row.doc_days,
      drr_units: (row) => row.drr_units,
      may_mtd_units: (row) => row.may_mtd_units,
      apr_so_units: (row) => row.apr_so_units,
      total_stock_units: (row) => warehouseTotalStockUnits(row),
      purchase_order_units: (row) => row.purchase_order_units,
      total_so_units: (row) => row.total_so_units,
    };
    last7SoDates.forEach((_saleDate, index) => {
      accessors[`last3_so_${index}`] = (row) => row.last3DaysSo?.[index]?.units_sold ?? 0;
    });
    return accessors;
  }, [isPersonalAudio, legacyMarketplace, last7SoDates]);

  const tableScrollRef = useRef<HTMLDivElement>(null);

  const { sortedRows: sortedTableRows, sortKey, sortDirection, requestSort } = useTableSort(
    filteredRecords,
    dashboardSortAccessors,
    "purchase_order_units",
    "desc",
    {
      naturalTextSortKeys: ["model", "sub_category"],
      textSortKeys: ["category"],
      tieBreaker: (row) => displayModelName(row.product_name, row.product_code),
    },
  );

  useEffect(() => {
    tableScrollRef.current?.scrollTo({ top: 0 });
  }, [sortKey, sortDirection, category, categoryCycleIndex, subCategoryCycleIndex]);

  const last7DaySelloutChartData = useMemo(
    () =>
      last7SoDates
        .slice()
        .reverse()
        .map((saleDate, indexFromOldest) => {
          const reverseIndex = last7SoDates.length - 1 - indexFromOldest;
          const totalSellout = filteredRecords.reduce(
            (sum, row) => sum + Math.max(0, row.last3DaysSo?.[reverseIndex]?.units_sold ?? 0),
            0,
          );
          return {
            saleDate,
            label: formatDayMonthColumnLabel(saleDate),
            totalSellout,
          };
        }),
    [filteredRecords, last7SoDates],
  );

  const channelName = marketplace === "amazon" ? "Amazon" : "Flipkart";
  const hasCartridgeCategory = categoryList.some(
    (c) => c.trim().toLowerCase() === "cartridge",
  );

  const adminScopeBanner =
    isMarketplaceGlobal && adminScopeReady && dashboardViewMode === "manager" && impersonatedWorkspace
      ? `Viewing as ${catalogWorkspaceManagerName(impersonatedWorkspace)}`
      : isMarketplaceGlobal && adminScopeReady && dashboardViewMode === "category"
        ? "Viewing by category (all managers)"
        : null;

  function openAdminScope(
    mode: AdminDashboardViewMode,
    managerWorkspace?: CatalogWorkspace,
  ) {
    setDashboardViewMode(mode);
    if (mode === "manager" && managerWorkspace) {
      setImpersonatedWorkspace(managerWorkspace);
    } else {
      setImpersonatedWorkspace(null);
    }
    setAdminScopeReady(true);
  }

  if (adminNeedsLanding) {
    return (
      <div className="space-y-6">
        <PageTitle
          title={`${channelName} Dashboard`}
          subtitle="Admin — choose manager scope or category filters before loading data."
        />
        <AdminDashboardLanding
          marketplaceLabel={channelName}
          viewMode={dashboardViewMode}
          onViewModeChange={(mode) => {
            setDashboardViewMode(mode);
            setPendingManagerWorkspace("");
          }}
          selectedWorkspace={pendingManagerWorkspace}
          onWorkspaceChange={setPendingManagerWorkspace}
          onContinue={() => {
            if (dashboardViewMode === "manager" && pendingManagerWorkspace) {
              openAdminScope("manager", pendingManagerWorkspace);
            } else if (dashboardViewMode === "category") {
              openAdminScope("category");
            }
          }}
          categorySegment={analysisCategoryToUrlSegment(adminCategoryRaw)}
          categories={adminCategoryOptions.map((o) => o.segment)}
          categoryLabels={Object.fromEntries(
            adminCategoryOptions.map((o) => [o.segment, o.label]),
          )}
          onCategorySegmentChange={(segment) => {
            const picked = adminCategoryOptions.find((o) => o.segment === segment);
            setAdminCategoryRaw(picked?.raw ?? ANALYSIS_CATEGORY_ALL);
            setAdminSubCategory(ANALYSIS_SUB_CATEGORY_ALL);
          }}
          sheetSubCategory={adminSubCategory}
          subCategoryOptions={adminSubCategoryOptions.map((o) => o.value)}
          subCategoryLabels={Object.fromEntries(
            adminSubCategoryOptions.map((o) => [o.value, o.label]),
          )}
          onSheetSubCategoryChange={setAdminSubCategory}
          categoryFiltersLoading={adminCategoryLoading}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {adminScopeBanner ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/80 px-4 py-2 text-sm font-semibold text-violet-950">
          <span>{adminScopeBanner}</span>
          <button
            type="button"
            className="text-violet-700 underline"
            onClick={() => {
              setAdminScopeReady(false);
              setDashboardViewMode(null);
              setImpersonatedWorkspace(null);
            }}
          >
            Change view
          </button>
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title={`${channelName} Dashboard`}
            subtitle={
              view === "po"
                ? workspace === "personal_audio"
                  ? "Personal audio, home automation, auto accessories, and Flipkart gaming headphones — inventory, sellout and PO from the latest sellout upload."
                  : workspace === "rithika_it_gaming"
                    ? "IT & accessories, gaming & components, ROMA (AUX/OTG, fans, drive cast), Amazon 2.0 speakers & gaming headphones — from the latest sellout upload."
                    : workspace === "home_audio"
                      ? "Home Audio — Mini Soundbar, Multimedia Speaker, Party Speaker, Soundbar, Trolley Speaker, and Tower Speaker from the latest sellout upload."
                      : workspace === "roma_powerbank"
                        ? "ROMA and PowerBank — inventory, sellout and PO from the latest Cocoblu / Click_tect / Flipkart sellout upload."
                        : "Monitors, projectors, and Hari categories (Monitor & Acc., Projector & Acc., Cartridge). Inventory, sellout and PO from the latest sellout upload."
                : workspace === "personal_audio"
                  ? "Ratings & BSR for Karan category rows on this channel."
                  : workspace === "rithika_it_gaming"
                    ? "Ratings & BSR for Rithika category rows on this channel."
                    : workspace === "home_audio"
                      ? "Ratings & BSR for Home Audio category rows on this channel."
                      : "Ratings & BSR by sheet Category and Sub category (Monitor & Acc., Projector & Acc., Cartridge)."
            }
          />
        </div>
        {view === "po" && dashboardCoverage.min && dashboardCoverage.max ? (
          <DataAsOnRangeBadge
            min={dashboardCoverage.min}
            max={dashboardCoverage.max}
            scopeLabel={scopeLabel}
          />
        ) : view === "ratings" && ratingsMeta.snapshotDate ? (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/90 px-4 py-2 text-sm font-medium text-indigo-950">
            <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-700">
              Ratings as on
            </p>
            <p>
              {new Date(`${ratingsMeta.snapshotDate}T12:00:00`).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
        ) : null}
      </div>

      {view === "po" && !poLoading && !error && metricsMissingWarning ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <strong>Sellout numbers are missing</strong> for these SKUs (names only). Open{" "}
          <strong>Upload Center</strong>, upload the ROMA &amp; PowerBank sellout file again for{" "}
          <strong>{channelName}</strong> (pick the correct marketplace tab), wait for the success
          message, then refresh this page.
        </p>
      ) : null}

      {view === "po" &&
      !poLoading &&
      !error &&
      !hasCartridgeCategory &&
      workspace === "monitor_projector" ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <strong>Cartridge</strong> is not loaded for {channelName} yet. Open{" "}
          <strong>Upload</strong>, re-upload your master (sheet <strong>Ecom Sellout</strong>). After
          parsing you should see about <strong>13 Cartridge</strong> rows in the upload message — then
          refresh this page.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <CategorySubCategoryFilterControls
          category={category}
          categories={dashboardCategories}
          onCategoryChange={setCategory}
          subCategory={sheetSubCategory}
          subCategoryOptions={dashboardSubCategoryOptions}
          onSubCategoryChange={setSheetSubCategory}
          showSubCategory
        />
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setView("po")}
            className={cn(
              "rounded px-3 py-1.5 text-xs font-bold transition",
              view === "po"
                ? "bg-violet-600 text-white shadow-sm"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300",
            )}
          >
            PO metrics
          </button>
          <button
            type="button"
            onClick={() => setView("ratings")}
            className={cn(
              "rounded px-3 py-1.5 text-xs font-bold transition",
              view === "ratings"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300",
            )}
          >
            Ratings &amp; reviews
          </button>
        </div>
        <span className="rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {view === "po" ? filteredRecords.length : filteredRatingsRows.length} SKU
          {(view === "po" ? filteredRecords.length : filteredRatingsRows.length) === 1
            ? ""
            : "s"}{" "}
          in view
          {activeCycleBadge ? ` · ${activeCycleBadge}` : ""}
        </span>
      </div>

      {view === "ratings" ? (
        ratingsLoading ? (
          <InlineLoader text="Loading ratings & reviews…" />
        ) : (
          <DashboardRatingsPanel
            marketplace={marketplace}
            rows={filteredRatingsRows}
            isLoading={ratingsLoading}
            error={ratingsError}
            sheetFilter={{ category, sheetSubCategory }}
            scopeLabel={scopeLabel}
          />
        )
      ) : poLoading ? (
        <InlineLoader text={`Loading ${marketplace} dashboard...`} />
      ) : error ? (
        <EmptyState title="Unable to load dashboard" description={error} />
      ) : (
        <>
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Total Purchase Order"
          value={formatInteger(kpis.totalPo)}
          variant="amber"
          hint="Suggested PO units"
        />
        <StatCard
          label={
            latestColumnSellout.saleDate
              ? latestColumnSellout.usesMtdFallback
                ? `${mtdColumnLabel} total`
                : `Sell out (${formatDayMonthColumnLabel(latestColumnSellout.saleDate)})`
              : "Sell out (latest date column)"
          }
          value={formatInteger(latestColumnSellout.totalUnits)}
          variant="emerald"
          hint={
            latestColumnSellout.saleDate
              ? latestColumnSellout.usesMtdFallback
                ? `Sum of ${mtdColumnLabel} for SKUs in this view — sheet as on ${formatCoverageDataAsOf(latestColumnSellout.saleDate)}. Re-upload sellout to populate daily columns.`
                : `Sum of ${formatDayMonthColumnLabel(latestColumnSellout.saleDate)} sellout for SKUs in this view.`
              : "No sellout snapshot for SKUs in this view — re-upload the sellout master."
          }
        />
      </div>

      {filteredRecords.length === 0 ? (
        <EmptyState
          title="No data yet"
          description={`No SKUs in this view. Upload a ${marketplace} sheet from Upload Center.`}
        />
      ) : (
        <>
          <div className="grid gap-4">
            {!chartsReady ? (
              <Card className="flex h-72 items-center justify-center text-sm text-zinc-500">
                Loading charts…
              </Card>
            ) : (
            <Card>
              <div className="mb-4 flex items-center justify-between gap-2">
                <h3 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Last 7 days sellout
                </h3>
                <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-emerald-800">
                  Day by day trend
                </span>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={last7DaySelloutChartData}
                    margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={CHART_GRID_STROKE}
                    />
                    <XAxis
                      dataKey="label"
                      tick={CHART_AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={CHART_AXIS_TICK}
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(16,185,129,0.12)" }}
                      content={
                        <ChartTooltip
                          formatValue={(value) =>
                            `${formatInteger(Number(value ?? 0))} units`
                          }
                          labelPrefix="Day"
                          labelKey="label"
                        />
                      }
                    />
                    <Bar dataKey="totalSellout" name="Total sellout" radius={[6, 6, 0, 0]} fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            )}
          </div>

          <Card className="overflow-hidden border-zinc-300 bg-white p-0 shadow-md">
            <div className="border-b-2 border-zinc-300 bg-zinc-100 px-4 py-3">
              <h3 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                SKU metrics
              </h3>
              <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                Model ↑↓ sorts A–Z with numbers in order. <strong>All categories</strong>: Category
                ↑↓ steps through sheet categories. One category: Sub category ↑↓ steps through
                types.
              </p>
            </div>
            <div
              ref={tableScrollRef}
              className="max-h-[min(70vh,800px)] overflow-auto"
            >
            <table className="min-w-full divide-y divide-zinc-300 text-sm font-medium text-zinc-900">
              <thead className="sticky top-0 z-10 bg-zinc-100 shadow-sm">
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-zinc-800">
                  <SortableTableHeader
                    label="Model"
                    sortKey="model"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                  />
                  {category === "all" ? (
                    <DimensionCycleTableHeader
                      defaultLabel="Category"
                      valueList={categoryList}
                      cycleIndex={categoryCycleIndex}
                      lastDirection={categoryCycleDirection}
                      onCycle={handleCategoryCycle}
                      stepAriaLabel="Step through categories"
                    />
                  ) : (
                    <DimensionCycleTableHeader
                      defaultLabel="Sub category"
                      valueList={dashboardSubCategoryOptions}
                      cycleIndex={subCategoryCycleIndex}
                      lastDirection={subCategoryCycleDirection}
                      onCycle={handleSubCategoryCycle}
                      stepAriaLabel={`Step through sub categories in ${category}`}
                    />
                  )}
                  <SortableTableHeader
                    label="DRR"
                    sortKey="drr_units"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    align="right"
                  />
                  <SortableTableHeader
                    label="Total stock"
                    sortKey="total_stock_units"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    align="right"
                  />
                  <SortableTableHeader
                    label="ATP"
                    sortKey="inventory_units"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    align="right"
                  />
                  <SortableTableHeader
                    label="DOC"
                    sortKey="doc_days"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    align="right"
                  />
                  {last7SoDates.map((date, index) => (
                    <SortableTableHeader
                      key={date}
                      label={formatDayMonthColumnLabel(date)}
                      sortKey={`last3_so_${index}`}
                      activeKey={sortKey}
                      activeDirection={sortDirection}
                      onSort={requestSort}
                      className="normal-case tracking-normal"
                      align="right"
                    />
                  ))}
                  <SortableTableHeader
                    label={mtdColumnLabel}
                    sortKey="may_mtd_units"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    className="normal-case tracking-normal"
                    align="right"
                  />
                  <SortableTableHeader
                    label={priorMonthSoLabel}
                    sortKey="apr_so_units"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    className="normal-case tracking-normal"
                    align="right"
                  />
                  <SortableTableHeader
                    label="Total SO"
                    sortKey="total_so_units"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    align="right"
                  />
                  <SortableTableHeader
                    label="PO"
                    sortKey="purchase_order_units"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {sortedTableRows.map((row) => (
                  <tr
                    key={row.product_code}
                    className="odd:bg-white even:bg-zinc-50 hover:bg-sky-50"
                  >
                    <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                      <Link
                        to={dashboardListingModelPath(
                          marketplace,
                          row.product_code,
                          routePrefix,
                        )}
                        className="rounded-sm text-violet-700 underline-offset-2 hover:text-violet-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                        title={`${codeLabel}: ${row.product_code}`}
                      >
                        {displayModelName(row.product_name, row.product_code)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {getDimensionCellValue(row)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatSelloutDrr(row.drr_units)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatInteger(warehouseTotalStockUnits(row))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatInteger(row.inventory_units)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatDecimal(row.doc_days)}
                    </td>
                    {last7SoDates.map((date, index) => (
                      <td key={date} className="px-3 py-2 text-right tabular-nums">
                        {formatInteger(row.last3DaysSo?.[index]?.units_sold ?? 0)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatInteger(row.may_mtd_units)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatInteger(row.apr_so_units)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatInteger(row.total_so_units)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ring-1",
                          row.purchase_order_units > 0
                            ? "bg-amber-500/15 text-amber-700 ring-amber-400/40 dark:text-amber-200 dark:ring-amber-500/40"
                            : "bg-zinc-100 text-zinc-600 ring-zinc-300/70 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
                        )}
                      >
                        {formatInteger(row.purchase_order_units)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Card>
        </>
      )}

      <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        <span className="font-semibold text-zinc-700 dark:text-zinc-300">How PO is calculated:</span>{" "}
        Recommended PO = max(0, (28 Days Avg × {PO_COVERAGE_TARGET_DAYS} days) − marketplace inventory).
        Inventory is the on-hand units for this channel (Amazon or Flipkart), not HO/network stock.
      </p>
        </>
      )}
    </div>
  );
}
