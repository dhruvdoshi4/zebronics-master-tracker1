/**
 * Dump admin global category analysis tree per manager workspace.
 * Run: npx tsx scripts/dump-admin-analysis-tree.ts
 */
import { listAdminGlobalAnalysisCategoryTree } from "../src/admin-dashboard-data";
import { listAnalysisCategoryTree } from "../src/data";
import { ADMIN_MANAGER_WORKSPACES } from "../src/admin-realm";
import { catalogWorkspaceManagerName } from "../src/catalog-workspace";
import { analysisSubCategoryOptionLabel } from "../src/analysis-category-filters";

async function main() {
  console.log("\n=== Per-manager category analysis trees ===\n");
  for (const workspace of ADMIN_MANAGER_WORKSPACES) {
    const tree = await listAnalysisCategoryTree(workspace, "default");
    console.log(`--- ${catalogWorkspaceManagerName(workspace)} (${workspace}) ---`);
    for (const cat of tree.categories) {
      if (cat === "all") continue;
      const subs = tree.subCategoriesByCategory[cat] ?? [];
      console.log(`  ${cat} (${subs.length} subs)`);
      for (const sub of subs) {
        console.log(`    · ${sub} → ${analysisSubCategoryOptionLabel(sub)}`);
      }
    }
    console.log("");
  }

  const merged = await listAdminGlobalAnalysisCategoryTree();
  console.log("=== Admin global merged tree ===\n");
  console.log("Categories:", merged.categories.filter((c) => c !== "all").join(", "));
  console.log("");
  for (const cat of merged.categories) {
    if (cat === "all") continue;
    const subs = merged.subCategoriesByCategory[cat] ?? [];
    console.log(`  ${cat} (${subs.length} subs)`);
    for (const sub of subs.slice(0, 30)) {
      console.log(`    · ${sub} → ${analysisSubCategoryOptionLabel(sub)}`);
    }
    if (subs.length > 30) console.log(`    … +${subs.length - 30} more`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
