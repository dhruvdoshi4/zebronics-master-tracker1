/**
 * Audit consolidated Amazon Ecom Sellout routing against manager scopes.
 * Run: npx tsx scripts/analyze-consolidated-amazon.ts [path-to-xlsx]
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
import {
  KARAN_TRACKED_SUB_CATEGORY_SET,
  normalizedKaranSubCategory,
  productMatchesKaranDashboardScopeForMarketplace,
} from "../src/karan-category-scope";
import {
  normalizedPravinSubCategory,
  productMatchesPravinDashboardScopeForMarketplace,
  rowPassesPravinCategoryScope,
  rowPassesPravinConsolidatedCategoryScope,
} from "../src/pravin-category-scope";
import {
  normalizedRishabhSubCategory,
  productMatchesRishabhDashboardScopeForMarketplace,
  rowPassesRishabhCategoryScope,
} from "../src/rishabh-category-scope";
import {
  normalizedRithikaSubCategory,
  productMatchesRithikaDashboardScopeForMarketplace,
} from "../src/rithika-category-scope";
import { isCartridgeSheetCategory } from "../src/sellout-category-scope";
import { normalizeKey } from "../src/utils";

type ScopeRow = {
  category: string;
  sub_category: string;
  product_name: string;
};

function isSkippedRow(category: string, subCategory: string): boolean {
  const c = normalizeKey(category);
  if (!c || c === "na" || c === "n/a" || c === "nan") return true;
  return productMatchesDawgScope({ category, sub_category: subCategory });
}

/** Mirrors admin-consolidated-sellout.ts without pulling manager-dashboard-scope → supabase. */
function rowPassesManagerSelloutIngest(
  row: ScopeRow,
  workspace: CatalogWorkspace,
): boolean {
  const category = String(row.category ?? "");
  const subCategory = String(row.sub_category ?? "");
  const productName = String(row.product_name ?? "");

  if (workspace === CATALOG_WORKSPACE_MONITOR) {
    return (
      isCartridgeSheetCategory(category) ||
      productMatchesHariMonitorProjectorDashboardScope({
        category,
        sub_category: subCategory,
        product_name: productName,
      })
    );
  }
  if (workspace === CATALOG_WORKSPACE_PERSONAL_AUDIO) {
    const sub = normalizedKaranSubCategory(subCategory, category, productName, "amazon");
    return sub !== null && KARAN_TRACKED_SUB_CATEGORY_SET.has(sub);
  }
  if (workspace === CATALOG_WORKSPACE_RITHIKA) {
    const bucket = normalizedRithikaSubCategory(subCategory, category, productName, "amazon");
    return bucket !== null;
  }
  if (workspace === CATALOG_WORKSPACE_HOME_AUDIO) {
    return (
      normalizedRishabhSubCategory(subCategory, category, productName) !== null &&
      rowPassesRishabhCategoryScope(category, subCategory, productName)
    );
  }
  if (workspace === CATALOG_WORKSPACE_PRAVIN) {
    return (
      rowPassesPravinConsolidatedCategoryScope(category, subCategory, productName) &&
      normalizedPravinSubCategory(subCategory, category, productName) !== null
    );
  }
  return false;
}

function rowBelongsToManagerDashboard(row: ScopeRow, workspace: CatalogWorkspace): boolean {
  const scopeRow = {
    category: row.category,
    sub_category: row.sub_category,
    product_name: row.product_name,
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

function resolveAdminConsolidatedCatalogWorkspace(
  row: ScopeRow,
): CatalogWorkspace | null {
  const category = String(row.category ?? "").trim();
  const subCategory = String(row.sub_category ?? "").trim();
  const productName = String(row.product_name ?? "").trim();
  if (isSkippedRow(category, subCategory)) return null;

  const scopeRow: ScopeRow = { category, sub_category: subCategory, product_name: productName };
  for (const workspace of ADMIN_MANAGER_WORKSPACES) {
    if (!rowBelongsToManagerDashboard(scopeRow, workspace)) continue;
    if (!rowPassesManagerSelloutIngest(scopeRow, workspace)) continue;
    return workspace;
  }
  return null;
}

const DEFAULT_PATH =
  "c:/Users/Admin/Downloads/AZ(A) - Zebronics Sellout report till 24th May  & Warehouse Report as on 24th May 2026.xlsx";

const ECOM_SELLOUT = "Ecom Sellout";

const FAST_READ_OPTS = {
  cellFormula: false,
  cellHTML: false,
  cellNF: false,
  cellStyles: false,
  cellDates: false,
} as const;

function tightenWorksheetRange(ws: XLSX.WorkSheet): void {
  let maxR = 0;
  let maxC = 0;
  for (const key of Object.keys(ws)) {
    if (key[0] === "!") continue;
    const cell = XLSX.utils.decode_cell(key);
    if (cell.r >= 100_000) continue;
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c > maxC) maxC = cell.c;
  }
  if (maxC < 0) return;
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxR, c: maxC },
  });
}

function readWorksheetRowSlice(
  worksheet: XLSX.WorkSheet,
  row: number,
  maxCol: number,
): unknown[] {
  const out = new Array<unknown>(maxCol + 1);
  for (let col = 0; col <= maxCol; col += 1) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
    if (!cell) {
      out[col] = "";
      continue;
    }
    if (cell.t === "n" && typeof cell.v === "number") out[col] = cell.v;
    else if (cell.w != null) out[col] = cell.w;
    else out[col] = cell.v ?? "";
  }
  return out;
}

function readEcomSelloutMatrix(buffer: ArrayBuffer): unknown[][] {
  const names = XLSX.read(buffer, { type: "array", bookSheets: true }).SheetNames;
  if (!names.includes(ECOM_SELLOUT)) {
    throw new Error(`Sheet "${ECOM_SELLOUT}" not found. Available: ${names.join(", ")}`);
  }
  const workbook = XLSX.read(buffer, {
    type: "array",
    sheets: [ECOM_SELLOUT],
    ...FAST_READ_OPTS,
  });
  const worksheet = workbook.Sheets[ECOM_SELLOUT];
  if (!worksheet?.["!ref"]) return [];
  tightenWorksheetRange(worksheet);
  const range = XLSX.utils.decode_range(worksheet["!ref"]!);
  const lastCol = Math.min(range.e.c, 120);
  const rows: unknown[][] = [];
  for (let row = 0; row <= range.e.r; row += 1) {
    rows.push(readWorksheetRowSlice(worksheet, row, lastCol));
  }
  return rows;
}

function findHeaderRow(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(10, matrix.length); i++) {
    const line = (matrix[i] ?? []).map((c) => normalizeKey(String(c)));
    const hasCat = line.some((c) => c === "category" || c.includes("product category"));
    const hasCode = line.some((c) => c === "asin" || c.includes("product id"));
    if (hasCat && hasCode) return i;
  }
  return 0;
}

function findCol(headers: string[], aliases: string[]): number {
  for (const a of aliases) {
    const i = headers.findIndex((h) => h === a || h.includes(a));
    if (i >= 0) return i;
  }
  return -1;
}

type RowRec = {
  asin: string;
  category: string;
  subCategory: string;
  productName: string;
  kam: string;
};

function parseEcomSellout(buffer: ArrayBuffer): RowRec[] {
  const matrix = readEcomSelloutMatrix(buffer);
  const headerIdx = findHeaderRow(matrix);
  const headers = (matrix[headerIdx] ?? []).map((c) => normalizeKey(String(c)));
  const asinIdx = findCol(headers, ["asin"]);
  const catIdx = findCol(headers, ["category", "product category"]);
  const subIdx = findCol(headers, ["sub category", "subcategory"]);
  const nameIdx = findCol(headers, ["model name", "product name", "model", "title", "madel name"]);
  const kamIdx = findCol(headers, ["kam", "account manager", "key account manager"]);

  const out: RowRec[] = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const asin = asinIdx >= 0 ? String(row[asinIdx] ?? "").trim().toUpperCase() : "";
    const category = catIdx >= 0 ? String(row[catIdx] ?? "").trim() : "";
    const subCategory = subIdx >= 0 ? String(row[subIdx] ?? "").trim() : "";
    const productName = nameIdx >= 0 ? String(row[nameIdx] ?? "").trim() : "";
    const kam = kamIdx >= 0 ? String(row[kamIdx] ?? "").trim() : "";
    if (!asin && !category && !subCategory && !productName) continue;
    if (!asin) continue;
    out.push({ asin, category, subCategory, productName, kam });
  }
  return out;
}

function bump(map: Map<string, number>, key: string, n = 1) {
  map.set(key, (map.get(key) ?? 0) + n);
}

const filePath = process.argv[2] ?? DEFAULT_PATH;
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const buffer = fs.readFileSync(filePath).buffer;
const allRows = parseEcomSellout(buffer);
const uniqueAsins = new Set(allRows.map((r) => r.asin));

const byManager = new Map<string, number>();
const byCategory = new Map<string, number>();
const unmappedByCategory = new Map<string, number>();
const pravinWouldSolo: RowRec[] = [];
const unmappedRows: RowRec[] = [];
const skippedRows: RowRec[] = [];

let mapped = 0;
let skipped = 0;
let unmapped = 0;

for (const row of allRows) {
  bump(byCategory, row.category || "(blank)", 1);

  if (isSkippedRow(row.category, row.subCategory)) {
    skipped += 1;
    skippedRows.push(row);
    continue;
  }

  const ws = resolveAdminConsolidatedCatalogWorkspace({
    category: row.category,
    sub_category: row.subCategory,
    product_name: row.productName,
    kam: row.kam,
  });

  if (rowPassesPravinCategoryScope(row.category, row.subCategory, row.productName) &&
      !rowPassesPravinConsolidatedCategoryScope(row.category, row.subCategory, row.productName)) {
    pravinWouldSolo.push(row);
  }

  if (ws) {
    mapped += 1;
    bump(byManager, catalogWorkspaceManagerName(ws), 1);
  } else {
    unmapped += 1;
    unmappedRows.push(row);
    bump(unmappedByCategory, row.category || "(blank)", 1);
  }
}

// Per-manager dashboard-only (no ingest gate) for unmapped diagnosis
const unmappedDashboardHits = new Map<string, number>();
for (const row of unmappedRows) {
  const scopeRow: ScopeRow = {
    category: row.category,
    sub_category: row.subCategory,
    product_name: row.productName,
  };
  for (const ws of ADMIN_MANAGER_WORKSPACES) {
    if (rowBelongsToManagerDashboard(scopeRow, ws)) {
      bump(unmappedDashboardHits, catalogWorkspaceManagerName(ws), 1);
    }
  }
}

console.log("\n=== Consolidated Amazon Ecom Sellout audit ===");
console.log(`File: ${filePath}`);
console.log(`Sheet rows with ASIN: ${allRows.length}`);
console.log(`Unique ASINs:           ${uniqueAsins.size}`);
console.log("");
console.log(`Skipped (N/A + daWg):   ${skipped}`);
console.log(`Should map (rows):      ${allRows.length - skipped}`);
console.log(`Mapped (current rules): ${mapped}`);
console.log(`Unmapped (dropped):     ${unmapped}`);
console.log("");

console.log("--- Mapped by manager (current consolidated rules) ---");
for (const ws of ADMIN_MANAGER_WORKSPACES) {
  const name = catalogWorkspaceManagerName(ws);
  const n = byManager.get(name) ?? 0;
  if (n > 0) console.log(`  ${name}: ${n}`);
}
console.log(`  TOTAL: ${mapped}`);

console.log("\n--- All Category values (row counts) ---");
[...byCategory.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([cat, n]) => console.log(`  ${n.toString().padStart(4)}  ${cat}`));

console.log("\n--- Unmapped rows: top Category values ---");
[...unmappedByCategory.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([cat, n]) => console.log(`  ${n.toString().padStart(4)}  ${cat}`));

console.log("\n--- Pravin solo-upload would take, consolidated rejects ---");
console.log(`  Count: ${pravinWouldSolo.length}`);
const pravinSoloByCat = new Map<string, number>();
for (const r of pravinWouldSolo) bump(pravinSoloByCat, r.category || "(blank)", 1);
[...pravinSoloByCat.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([cat, n]) => console.log(`  ${n.toString().padStart(4)}  ${cat}`));

console.log("\n--- Unmapped: which manager DASHBOARD scope matched (ingest failed) ---");
[...unmappedDashboardHits.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([name, n]) => console.log(`  ${name}: ${n} dashboard hits among unmapped`));

console.log("\n--- Sample unmapped rows (first 15) ---");
for (const r of unmappedRows.slice(0, 15)) {
  console.log(
    `  ASIN=${r.asin} Cat="${r.category}" Sub="${r.subCategory}" KAM="${r.kam}"`,
  );
}

// Category-column routing (business rule sketch)
function categoryFirstManager(row: RowRec): string | null {
  const c = normalizeKey(row.category);
  if (!c || c === "na" || c === "n/a") return null;
  if (productMatchesDawgScope({ category: row.category, sub_category: row.subCategory })) {
    return "SKIP (daWg)";
  }
  if (c === "home audio") return "Rishabh";
  if (c === "roma" || c === "power bank" || c === "powerbank") return "Pravin (category)";
  if (
    c.includes("monitor") ||
    c.includes("projector") ||
    c === "cartridge" ||
    c === "monitors" ||
    c === "projectors"
  ) {
    return "Hari";
  }
  if (
    c === "home automation" ||
    c === "personal audio" ||
    c === "audio" ||
    (c.includes("personal audio") && c.includes("auto"))
  ) {
    return "Karan";
  }
  if (
    c.includes("it") ||
    c.includes("gaming") ||
    c === "pc" ||
    c.includes("complete it")
  ) {
    return "Rithika";
  }
  return null;
}

const catFirst = new Map<string, number>();
let catFirstUnmapped = 0;
for (const row of allRows) {
  if (isSkippedRow(row.category, row.subCategory)) continue;
  const mgr = categoryFirstManager(row);
  if (!mgr) {
    catFirstUnmapped += 1;
    bump(catFirst, "UNMAPPED", 1);
  } else {
    bump(catFirst, mgr, 1);
  }
}

console.log("\n--- Category-column routing (simple business rule) ---");
[...catFirst.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([name, n]) => console.log(`  ${name}: ${n}`));
const catFirstTotal = [...catFirst.entries()]
  .filter(([k]) => k !== "UNMAPPED")
  .reduce((s, [, n]) => s + n, 0);
console.log(`  TOTAL mapped: ${catFirstTotal} (unmapped ${catFirstUnmapped})`);

const romaRows = allRows.filter(
  (r) =>
    !isSkippedRow(r.category, r.subCategory) &&
    (normalizeKey(r.category) === "roma" ||
      normalizeKey(r.category) === "power bank" ||
      normalizeKey(r.category) === "powerbank"),
);
console.log(`\n--- ROMA / Power Bank category rows (non-skipped): ${romaRows.length} ---`);
const romaByCurrent = new Map<string, number>();
for (const r of romaRows) {
  const ws = resolveAdminConsolidatedCatalogWorkspace({
    category: r.category,
    sub_category: r.subCategory,
    product_name: r.productName,
    kam: r.kam,
  });
  bump(romaByCurrent, ws ? catalogWorkspaceManagerName(ws) : "UNMAPPED", 1);
}
[...romaByCurrent.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([name, n]) => console.log(`  ${name}: ${n}`));

const skipByCat = new Map<string, number>();
for (const r of skippedRows) bump(skipByCat, r.category || "(blank)", 1);
console.log("\n--- Skipped rows by Category ---");
[...skipByCat.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([cat, n]) => console.log(`  ${n.toString().padStart(4)}  ${cat}`));

console.log("\n--- Unmapped: why Rithika ingest failed (sample) ---");
let rithikaFailSamples = 0;
for (const r of unmappedRows) {
  const scopeRow: ScopeRow = {
    category: r.category,
    sub_category: r.subCategory,
    product_name: r.productName,
  };
  if (!rowBelongsToManagerDashboard(scopeRow, CATALOG_WORKSPACE_RITHIKA)) continue;
  const bucket = normalizedRithikaSubCategory(
    r.subCategory,
    r.category,
    r.productName,
    "amazon",
  );
  if (rithikaFailSamples < 12) {
    console.log(
      `  Cat="${r.category}" Sub="${r.subCategory}" bucket=${bucket ?? "null"}`,
    );
    rithikaFailSamples += 1;
  }
}
