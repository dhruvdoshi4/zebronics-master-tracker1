import {
  ADMIN_MANAGER_WORKSPACES,
  assertMarketplaceGlobalMarketplace,
} from "./admin-realm";
import { ANALYSIS_CATEGORY_ALL } from "./analysis-category-paths";
import type { CatalogWorkspace } from "./catalog-workspace";
import { getDashboardRecords, listAnalysisCategoryTree } from "./data";
import type { DashboardRecord, LegacyMarketplace } from "./types";
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
