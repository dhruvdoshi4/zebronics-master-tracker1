import {
  ADMIN_MANAGER_WORKSPACES,
  assertMarketplaceGlobalMarketplace,
} from "./admin-realm";
import { ANALYSIS_CATEGORY_ALL, ANALYSIS_SUB_CATEGORY_ALL } from "./analysis-category-paths";
import {
  ADMIN_GLOBAL_ANALYSIS_CATEGORY_ORDER,
  analysisSubCategoryOptionLabel,
  dedupeAnalysisSubCategories,
  normalizeHariSubCategoryValue,
  sortAdminGlobalAnalysisCategories,
} from "./analysis-category-filters";
import type { CatalogWorkspace } from "./catalog-workspace";
import {
  productMasterBelongsToAnyManagerWorkspace,
  resolveManagerCatalogWorkspaceForRow,
  rowBelongsToAnyManagerDashboard,
} from "./admin-global-scope";
import {
  chunkArray,
  getDashboardRecords,
  getLatestSelloutProductCodeSet,
  getLatestUploadSheetCoverageByMarketplace,
  listAnalysisCategoryTree,
  loadGlobalCategorySheetMonthlySellout,
  productMatchesCategoryAnalysisSelection,
  productMatchesSubCategoryForWorkspace,
  searchWorkspaceCatalogForLookup,
  type UnifiedProductSuggestion,
} from "./data";
import { supabase } from "./supabase";
import { loadGlobalCategoryGmsMonthlySellout } from "./data-gms";
import { catalogProductName } from "./product-display";
import type { ProductScopeFilter } from "./marketplace-lookup-filters";
import { loadProductIdMap, lookupErpProductId } from "./product-id-map";
import type {
  DashboardRecord,
  LegacyMarketplace,
  Marketplace,
  ProductMaster,
  SubCategoryFilter,
} from "./types";
import { getSubCategoryLabel } from "./types";
import { normalizeKey } from "./utils";

const ADMIN_ANALYSIS_CATEGORY_KEYS = new Set(
  ADMIN_GLOBAL_ANALYSIS_CATEGORY_ORDER.map((cat) => normalizeKey(cat)),
);

function isAdminGlobalAnalysisCategory(cat: string): boolean {
  return ADMIN_ANALYSIS_CATEGORY_KEYS.has(normalizeKey(cat));
}

export async function listAdminGlobalAnalysisCategoryTree() {
  const parts = await Promise.all(
    ADMIN_MANAGER_WORKSPACES.map((workspace) =>
      listAnalysisCategoryTree(workspace, "default"),
    ),
  );
  const categories = new Set<string>([ANALYSIS_CATEGORY_ALL]);
  const subCategoriesByCategory: Record<string, Set<string>> = {
    [ANALYSIS_CATEGORY_ALL]: new Set<string>(),
  };

  for (const tree of parts) {
    for (const cat of tree.categories) {
      if (cat === ANALYSIS_CATEGORY_ALL || !isAdminGlobalAnalysisCategory(cat)) continue;
      categories.add(cat);
      if (!subCategoriesByCategory[cat]) {
        subCategoriesByCategory[cat] = new Set<string>();
      }
    }
    for (const [cat, subs] of Object.entries(tree.subCategoriesByCategory)) {
      if (cat === ANALYSIS_CATEGORY_ALL) {
        for (const sub of subs) {
          subCategoriesByCategory[ANALYSIS_CATEGORY_ALL]?.add(sub);
        }
        continue;
      }
      if (!isAdminGlobalAnalysisCategory(cat)) continue;
      categories.add(cat);
      if (!subCategoriesByCategory[cat]) {
        subCategoriesByCategory[cat] = new Set<string>();
      }
      for (const sub of subs) {
        subCategoriesByCategory[cat].add(sub);
        subCategoriesByCategory[ANALYSIS_CATEGORY_ALL]?.add(sub);
      }
    }
  }

  const sortedTop = sortAdminGlobalAnalysisCategories(categories);
  const allSubs = dedupeAnalysisSubCategories(subCategoriesByCategory[ANALYSIS_CATEGORY_ALL] ?? []);

  return {
    categories: [ANALYSIS_CATEGORY_ALL, ...sortedTop],
    subCategoriesByCategory: Object.fromEntries([
      [ANALYSIS_CATEGORY_ALL, allSubs],
      ...sortedTop.map((cat) => [
        cat,
        dedupeAnalysisSubCategories(subCategoriesByCategory[cat] ?? []),
      ]),
    ]),
  };
}

/** Sub-category filter dropdown for admin global Product Master / dashboards. */
export function adminGlobalSubCategoryFiltersFromTree(tree: {
  subCategoriesByCategory: Record<string, string[]>;
}): {
  options: readonly SubCategoryFilter[];
  labels: Record<string, string>;
} {
  const list = tree.subCategoriesByCategory[ANALYSIS_CATEGORY_ALL] ?? [];
  const seen = new Set<string>();
  const options: SubCategoryFilter[] = ["all"];
  const labels: Record<string, string> = { all: "All" };
  for (const sub of list) {
    const hari = normalizeHariSubCategoryValue(sub);
    const value = (hari ?? sub) as SubCategoryFilter;
    const key = normalizeKey(String(value));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push(value);
    labels[String(value)] = hari
      ? getSubCategoryLabel(hari)
      : analysisSubCategoryOptionLabel(sub);
  }
  return { options, labels };
}

function dashboardRowKey(row: DashboardRecord): string {
  return `${row.marketplace}:${row.product_code}`.toUpperCase();
}

/** Merge dashboard rows from all manager workspaces (dedupe by channel + product code). */
export async function getAdminGlobalDashboardRecords(
  marketplace: LegacyMarketplace,
  options?: {
    workspace?: CatalogWorkspace | null;
    sheetCategory?: string;
    sheetSubCategory?: string;
  },
): Promise<DashboardRecord[]> {
  assertMarketplaceGlobalMarketplace(marketplace);
  const workspaces = options?.workspace
    ? [options.workspace]
    : [...ADMIN_MANAGER_WORKSPACES];

  const parts = await Promise.all(
    workspaces.map((workspace) => getDashboardRecords(marketplace, workspace)),
  );

  const byKey = new Map<string, DashboardRecord>();
  for (const rows of parts) {
    for (const row of rows) {
      byKey.set(dashboardRowKey(row), row);
    }
  }

  let merged = [...byKey.values()];

  const category = options?.sheetCategory?.trim();
  const sub = options?.sheetSubCategory?.trim();
  if (category && category !== "all") {
    merged = merged.filter(
      (row) => normalizeKey(row.category ?? "") === normalizeKey(category),
    );
  }
  if (sub && sub !== "all") {
    merged = merged.filter(
      (row) => normalizeKey(row.sub_category ?? "") === normalizeKey(sub),
    );
  }

  return merged;
}

/** Category analysis roll-up across all manager workspaces (dedupe SKUs before summing). */
export async function loadAdminGlobalCategorySheetMonthlySellout(
  category: string,
  subCategory: string,
) {
  return loadGlobalCategorySheetMonthlySellout(category, subCategory, "default");
}

/** GMS category roll-up across all manager workspaces (dedupe SKUs before summing). */
export async function loadAdminGlobalCategoryGmsMonthlySellout(
  category: string,
  subCategory: string,
) {
  return loadGlobalCategoryGmsMonthlySellout(category, subCategory, "default");
}

const PRODUCT_MASTER_PAGE_SIZE = 1000;

async function fetchAllProductMasterForMarketplace(
  marketplace: Marketplace,
): Promise<ProductMaster[]> {
  const all: ProductMaster[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("product_master")
      .select("*")
      .eq("marketplace", marketplace)
      .order("updated_at", { ascending: false })
      .range(offset, offset + PRODUCT_MASTER_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const batch = (data ?? []) as ProductMaster[];
    all.push(...batch);
    if (batch.length < PRODUCT_MASTER_PAGE_SIZE) break;
    offset += PRODUCT_MASTER_PAGE_SIZE;
  }

  return all;
}

export function productMasterMatchesAdminGlobalSubCategory(
  row: Pick<
    ProductMaster,
    "product_code" | "sub_category" | "category" | "product_name" | "catalog_workspace"
  >,
  subCategory: string,
  marketplace: LegacyMarketplace,
): boolean {
  if (subCategory === "all") {
    return rowBelongsToAnyManagerDashboard(row, marketplace);
  }
  const workspace = resolveManagerCatalogWorkspaceForRow(row, marketplace);
  if (!workspace) return false;
  return productMatchesSubCategoryForWorkspace(
    subCategory,
    row,
    marketplace,
    workspace,
  );
}

export async function getAdminGlobalProductMaster(
  marketplace: Marketplace,
): Promise<ProductMaster[]> {
  const rows = await fetchAllProductMasterForMarketplace(marketplace);
  return rows.filter((row) => productMasterBelongsToAnyManagerWorkspace(row));
}

/** Latest sellout snapshot dates across manager uploads (newest per channel). */
export async function getAdminGlobalUploadSheetCoverageByMarketplace(): Promise<{
  amazon: string | null;
  flipkart: string | null;
}> {
  const rows = await Promise.all(
    ADMIN_MANAGER_WORKSPACES.map((workspace) =>
      getLatestUploadSheetCoverageByMarketplace(workspace),
    ),
  );
  const pickLatest = (dates: Array<string | null>) => {
    const valid = dates.filter((d): d is string => Boolean(d));
    if (valid.length === 0) return null;
    return valid.sort((a, b) => b.localeCompare(a))[0];
  };
  return {
    amazon: pickLatest(rows.map((r) => r.amazon)),
    flipkart: pickLatest(rows.map((r) => r.flipkart)),
  };
}

export async function getAdminGlobalSelloutProductCodeSet(
  marketplace: Marketplace,
): Promise<Set<string>> {
  const sets = await Promise.all(
    ADMIN_MANAGER_WORKSPACES.map((workspace) =>
      getLatestSelloutProductCodeSet(marketplace, workspace),
    ),
  );
  const merged = new Set<string>();
  for (const set of sets) {
    for (const code of set) merged.add(code);
  }
  return merged;
}

function channelListingLabel(asin: string | null, fsn: string | null): string {
  const parts: string[] = [];
  if (asin) parts.push(`ASIN ${asin}`);
  if (fsn) parts.push(`FSN ${fsn}`);
  return parts.join(" · ");
}

/** Admin global product lookup — any manager workspace + category analysis selection. */
export function buildAdminGlobalLookupScopeFilter(
  category: string,
  subCategory: string,
): ProductScopeFilter {
  const cat = category.trim() || ANALYSIS_CATEGORY_ALL;
  const sub = subCategory.trim() || ANALYSIS_SUB_CATEGORY_ALL;

  return (row) => {
    for (const marketplace of ["amazon", "flipkart"] as const) {
      const workspace = resolveManagerCatalogWorkspaceForRow(row, marketplace);
      if (!workspace) continue;
      if (
        productMatchesCategoryAnalysisSelection(cat, sub, row, {
          catalogWorkspace: workspace,
          dataScope: "default",
        })
      ) {
        return true;
      }
    }
    return false;
  };
}

/** Browse merged manager catalogue for admin Product Lookup. */
export async function browseAdminGlobalUnifiedProducts(
  scopeFilter: ProductScopeFilter,
  limit = 10,
): Promise<UnifiedProductSuggestion[]> {
  const [amazonCodes, flipkartCodes] = await Promise.all([
    getAdminGlobalSelloutProductCodeSet("amazon"),
    getAdminGlobalSelloutProductCodeSet("flipkart"),
  ]);
  if (amazonCodes.size === 0 && flipkartCodes.size === 0) return [];

  const idMap = await loadProductIdMap();
  const byKey = new Map<string, UnifiedProductSuggestion>();

  const mergeRow = (
    marketplace: Marketplace,
    productCode: string,
    productName: string,
    row: {
      category?: string | null;
      sub_category?: string | null;
      product_name?: string | null;
      catalog_workspace?: string | null;
    },
  ) => {
    if (!scopeFilter(row)) return;
    const pid = idMap ? lookupErpProductId(idMap, marketplace, productCode) : null;
    const catalog = catalogProductName(productName, productCode) || productName;
    const mapKey = pid ? `pid:${pid}` : `name:${normalizeKey(catalog)}`;
    const existing = byKey.get(mapKey);
    if (!existing) {
      byKey.set(mapKey, {
        key: mapKey,
        erpProductId: pid,
        modelName: catalog,
        asin: marketplace === "amazon" ? productCode : null,
        fsn: marketplace === "flipkart" ? productCode : null,
        subtitle: "",
      });
      return;
    }
    if (marketplace === "amazon") existing.asin = productCode;
    if (marketplace === "flipkart") existing.fsn = productCode;
    if (pid && !existing.erpProductId) existing.erpProductId = pid;
  };

  async function scanMarketplace(marketplace: Marketplace, codes: Set<string>) {
    for (const chunk of chunkArray([...codes], 150)) {
      if (byKey.size >= limit * 4) return;
      const { data, error } = await supabase
        .from("product_master")
        .select("product_code, product_name, category, sub_category, catalog_workspace")
        .eq("marketplace", marketplace)
        .in("product_code", chunk);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as Array<{
        product_code: string;
        product_name: string;
        category?: string | null;
        sub_category?: string | null;
        catalog_workspace?: string | null;
      }>) {
        const code = row.product_code.trim().toUpperCase();
        if (!codes.has(code)) continue;
        if (!productMasterBelongsToAnyManagerWorkspace(row)) continue;
        mergeRow(marketplace, row.product_code, row.product_name, row);
      }
    }
  }

  await Promise.all([
    scanMarketplace("amazon", amazonCodes),
    scanMarketplace("flipkart", flipkartCodes),
  ]);

  return [...byKey.values()]
    .sort((a, b) => a.modelName.localeCompare(b.modelName, undefined, { sensitivity: "base" }))
    .slice(0, limit)
    .map((row) => {
      const codes = channelListingLabel(row.asin, row.fsn);
      row.subtitle = row.erpProductId
        ? codes
          ? `ID ${row.erpProductId} · ${codes}`
          : `ID ${row.erpProductId}`
        : codes;
      return row;
    });
}

/** Search merged manager catalogue for admin Product Lookup. */
export async function searchAdminGlobalUnifiedProducts(
  lookupText: string,
  scopeFilter: ProductScopeFilter,
  limit = 10,
): Promise<UnifiedProductSuggestion[]> {
  const trimmed = lookupText.trim();
  if (trimmed.length < 2) return [];

  const idMap = await loadProductIdMap();
  const byKey = new Map<string, UnifiedProductSuggestion>();
  const seen = new Set<string>();

  for (const workspace of ADMIN_MANAGER_WORKSPACES) {
    for (const hit of await searchWorkspaceCatalogForLookup(trimmed, workspace)) {
      const key = `${hit.marketplace}:${hit.productCode.toUpperCase()}`;
      if (seen.has(key)) continue;
      const scopeRow = {
        category: null as string | null,
        sub_category: null as string | null,
        product_name: hit.productName,
      };
      const { data } = await supabase
        .from("product_master")
        .select("category, sub_category, product_name, catalog_workspace")
        .eq("marketplace", hit.marketplace)
        .eq("product_code", hit.productCode)
        .maybeSingle();
      if (data) {
        scopeRow.category = data.category ?? null;
        scopeRow.sub_category = data.sub_category ?? null;
        scopeRow.product_name = data.product_name ?? hit.productName;
      }
      if (!scopeFilter(scopeRow)) continue;
      seen.add(key);

      const pid = idMap ? lookupErpProductId(idMap, hit.marketplace, hit.productCode) : null;
      const catalog =
        catalogProductName(hit.productName, hit.productCode) || hit.productName;
      const mapKey = pid ? `pid:${pid}` : key;
      byKey.set(mapKey, {
        key: mapKey,
        erpProductId: pid,
        modelName: catalog,
        asin: hit.marketplace === "amazon" ? hit.productCode : null,
        fsn: hit.marketplace === "flipkart" ? hit.productCode : null,
        subtitle: "",
      });
      if (byKey.size >= limit) break;
    }
    if (byKey.size >= limit) break;
  }

  return [...byKey.values()].slice(0, limit);
}
