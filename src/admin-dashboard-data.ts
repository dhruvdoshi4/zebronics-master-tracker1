import {
  ADMIN_MANAGER_WORKSPACES,
  assertMarketplaceGlobalMarketplace,
} from "./admin-realm";
import { ANALYSIS_CATEGORY_ALL } from "./analysis-category-paths";
import type { CatalogWorkspace } from "./catalog-workspace";
import {
  productMasterBelongsToAnyManagerWorkspace,
  resolveManagerCatalogWorkspaceForRow,
  rowBelongsToAnyManagerDashboard,
} from "./admin-global-scope";
import {
  getDashboardRecords,
  getLatestSelloutProductCodeSet,
  getLatestUploadSheetCoverageByMarketplace,
  listAnalysisCategoryTree,
  loadGlobalCategorySheetMonthlySellout,
  productMatchesSubCategoryForWorkspace,
} from "./data";
import { supabase } from "./supabase";
import { loadGlobalCategoryGmsMonthlySellout } from "./data-gms";
import type { DashboardRecord, LegacyMarketplace, Marketplace, ProductMaster } from "./types";
import { normalizeKey } from "./utils";

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
      if (cat === ANALYSIS_CATEGORY_ALL) continue;
      categories.add(cat);
      if (!subCategoriesByCategory[cat]) {
        subCategoriesByCategory[cat] = new Set<string>();
      }
    }
    for (const [cat, subs] of Object.entries(tree.subCategoriesByCategory)) {
      if (cat === ANALYSIS_CATEGORY_ALL) continue;
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

  return {
    categories: [...categories].sort((a, b) => a.localeCompare(b, "en-IN")),
    subCategoriesByCategory: Object.fromEntries(
      Object.entries(subCategoriesByCategory).map(([cat, subs]) => [
        cat,
        [...subs].sort((a, b) => a.localeCompare(b, "en-IN")),
      ]),
    ),
  };
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
