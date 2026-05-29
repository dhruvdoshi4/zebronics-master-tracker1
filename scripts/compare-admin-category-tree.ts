/**
 * Compare Ecom Sellout sheet categories vs expected admin dropdown.
 * Run: npx tsx scripts/compare-admin-category-tree.ts [xlsx]
 */
import fs from "node:fs";
import XLSX from "xlsx";
import { ADMIN_MANAGER_WORKSPACES } from "../src/admin-realm";
import {
  CATALOG_WORKSPACE_HOME_AUDIO,
  CATALOG_WORKSPACE_MONITOR,
  CATALOG_WORKSPACE_PERSONAL_AUDIO,
  CATALOG_WORKSPACE_PRAVIN,
  CATALOG_WORKSPACE_RITHIKA,
  catalogWorkspaceManagerName,
  type CatalogWorkspace,
} from "../src/catalog-workspace";
import { productMatchesDawgScope } from "../src/dawg-scope";
import { productMatchesHariMonitorProjectorDashboardScope } from "../src/hari-dashboard-scope";
import { productMatchesKaranDashboardScopeForMarketplace } from "../src/karan-category-scope";
import { productMatchesPravinDashboardScopeForMarketplace } from "../src/pravin-category-scope";
import { productMatchesRishabhDashboardScopeForMarketplace } from "../src/rishabh-category-scope";
import { productMatchesRithikaDashboardScopeForMarketplace } from "../src/rithika-category-scope";
import { normalizeKey } from "../src/utils";

function rowBelongsToManager(
  row: { category: string; sub: string; name: string },
  workspace: CatalogWorkspace,
): boolean {
  const scopeRow = {
    category: row.category,
    sub_category: row.sub,
    product_name: row.name,
    catalog_workspace: null as string | null,
  };
  if (workspace === CATALOG_WORKSPACE_HOME_AUDIO) {
    return productMatchesRishabhDashboardScopeForMarketplace(scopeRow, "amazon");
  }
  if (workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) {
    return productMatchesKaranDashboardScopeForMarketplace(scopeRow, "amazon");
  }
  if (workspace === CATALOG_WORKSPACE_RITHIKA) {
    return productMatchesRithikaDashboardScopeForMarketplace(scopeRow, "amazon");
  }
  if (workspace === CATALOG_WORKSPACE_PRAVIN) {
    return productMatchesPravinDashboardScopeForMarketplace(scopeRow, "amazon");
  }
  return productMatchesHariMonitorProjectorDashboardScope(scopeRow);
}

const DEFAULT =
  "c:/Users/Admin/Downloads/AZ(A) - Zebronics Sellout report till 24th May  & Warehouse Report as on 24th May 2026.xlsx";

function isSkipped(category: string, sub: string): boolean {
  const c = normalizeKey(category);
  if (!c || c === "na" || c === "n/a" || c === "nan") return true;
  return productMatchesDawgScope({ category, sub_category: sub });
}

function readRows(path: string) {
  const buf = fs.readFileSync(path).buffer;
  const wb = XLSX.read(buf, { type: "array", sheets: ["Ecom Sellout"] });
  const ws = wb.Sheets["Ecom Sellout"];
  if (!ws?.["!ref"]) return [];
  let maxR = 0;
  let maxC = 0;
  for (const k of Object.keys(ws)) {
    if (k[0] === "!") continue;
    const c = XLSX.utils.decode_cell(k);
    if (c.r > maxR) maxR = c.r;
    if (c.c > maxC) maxC = c.c;
  }
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxR, c: Math.min(maxC, 80) },
  });
  const matrix = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
  }) as unknown[][];
  let hi = 0;
  for (let i = 0; i < Math.min(10, matrix.length); i++) {
    const line = (matrix[i] ?? []).map((c) => normalizeKey(String(c)));
    if (line.some((c) => c === "category") && line.some((c) => c.includes("asin"))) {
      hi = i;
      break;
    }
  }
  const headers = (matrix[hi] ?? []).map((c) => normalizeKey(String(c)));
  const asinIdx = headers.findIndex((h) => h === "asin");
  const catIdx = headers.findIndex((h) => h === "category" || h.includes("product category"));
  const subIdx = headers.findIndex((h) => h.includes("sub category"));
  const nameIdx = headers.findIndex(
    (h) => h.includes("model name") || h.includes("product name") || h === "model",
  );
  const out: Array<{ category: string; sub: string; name: string }> = [];
  for (let r = hi + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const asin = asinIdx >= 0 ? String(row[asinIdx] ?? "").trim() : "";
    if (!asin) continue;
    const category = catIdx >= 0 ? String(row[catIdx] ?? "").trim() : "";
    const sub = subIdx >= 0 ? String(row[subIdx] ?? "").trim() : "";
    const name = nameIdx >= 0 ? String(row[nameIdx] ?? "").trim() : "";
    if (isSkipped(category, sub)) continue;
    out.push({ category, sub, name });
  }
  return out;
}

const path = process.argv[2] ?? DEFAULT;
const rows = readRows(path);

const byCategory = new Map<string, number>();
const categoryToManagers = new Map<string, Set<string>>();

for (const row of rows) {
  const cat = row.category || "(blank)";
  byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
  if (!categoryToManagers.has(cat)) categoryToManagers.set(cat, new Set());
  for (const ws of ADMIN_MANAGER_WORKSPACES) {
    if (rowBelongsToManager(row, ws)) {
      categoryToManagers.get(cat)!.add(catalogWorkspaceManagerName(ws));
    }
  }
}

/** Categories visible in user's screenshot */
const UI_CATEGORIES = new Set([
  "Cartridge",
  "Home Audio",
  "Home Automation",
  "Monitor & Acc.",
  "Personal Audio",
  "PowerBank",
  "Projector & Acc.",
  "ROMA",
]);

console.log("\n=== Sheet categories (mappable) vs admin UI ===\n");
console.log(
  "Category".padEnd(22),
  "SKUs".padStart(5),
  "Managers".padEnd(40),
  "In UI?",
);
console.log("-".repeat(80));

for (const [cat, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
  const mgrs = [...(categoryToManagers.get(cat) ?? [])].join(", ") || "—";
  const inUi = UI_CATEGORIES.has(cat) ? "yes" : "NO";
  console.log(cat.padEnd(22), String(n).padStart(5), mgrs.padEnd(40), inUi);
}

const missing = [...byCategory.keys()].filter((c) => !UI_CATEGORIES.has(c));
const extra = [...UI_CATEGORIES].filter((c) => !byCategory.has(c));

console.log("\n=== Missing from UI (in sheet, not in screenshot) ===");
for (const cat of missing.sort((a, b) => (byCategory.get(b) ?? 0) - (byCategory.get(a) ?? 0))) {
  console.log(`  ${(byCategory.get(cat) ?? 0).toString().padStart(4)}  ${cat}`);
}

console.log("\n=== In UI but not a sheet category (synthetic / stored label) ===");
for (const cat of extra) {
  console.log(`  ${cat}`);
}

console.log(
  `\nTotal mappable sheet categories: ${byCategory.size}`,
);
console.log(`Shown in UI: ${UI_CATEGORIES.size}`);
console.log(`Missing from UI: ${missing.length}`);
