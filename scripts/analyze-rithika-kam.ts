/**
 * One-off: map KAM / Account Manager names in sellout masters to Rithika bucket categories.
 * Run: npx tsx scripts/analyze-rithika-kam.ts
 */
import XLSX from "xlsx";
import { normalizedRithikaSubCategory, RITHIKA_SUB_CATEGORY_LABELS } from "../src/rithika-category-scope";
import { normalizeKey } from "../src/utils";

const AZ_PATH =
  "c:/Users/Admin/Downloads/AZ(A) - Zebronics Sellout report till 20th May  & Warehouse Report as on 20th May 2026.xlsx";
const FK_IT_PATH =
  "c:/Users/Admin/Downloads/FK Sellout Report till 25th May 2026 (IT_Accessories & Gaming).xlsx";

type Mp = "amazon" | "flipkart";

function rows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }) as unknown[][];
}

function findHeaderRow(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(8, matrix.length); i++) {
    const line = (matrix[i] ?? []).map((c) => normalizeKey(String(c)));
    const hasCat = line.some((c) => c === "category" || c.includes("product category"));
    const hasCode = line.some((c) => c === "asin" || c === "fsn" || c.includes("product id"));
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

const KAM_ALIASES = [
  "kam",
  "account manager",
  "account mgr",
  "key account manager",
  "ecom manager",
  "manager",
];

type RowRec = {
  kam: string;
  category: string;
  subCategory: string;
  productName: string;
  rithikaBucket: string | null;
};

function parseSheet(
  sheet: XLSX.WorkSheet,
  marketplace: Mp,
  sheetLabel: string,
): RowRec[] {
  const matrix = rows(sheet);
  const headerIdx = findHeaderRow(matrix);
  const headers = (matrix[headerIdx] ?? []).map((c) => normalizeKey(String(c)));
  const kamIdx = findCol(headers, KAM_ALIASES);
  const catIdx = findCol(headers, ["category", "product category", "vertical"]);
  const subIdx = findCol(headers, ["sub category", "subcategory", "sub-category"]);
  const nameIdx = findCol(headers, [
    "model name",
    "product name",
    "model",
    "title",
    "description",
    "madel name",
  ]);
  const asinIdx = findCol(headers, ["asin"]);
  const fsnIdx = findCol(headers, ["fsn"]);

  if (catIdx < 0 && subIdx < 0) return [];

  const out: RowRec[] = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const code = String(row[asinIdx >= 0 ? asinIdx : fsnIdx] ?? "").trim();
    if (!code) continue;
    const category = String(row[catIdx] ?? "").trim();
    const subCategory = String(row[subIdx] ?? "").trim();
    const productName = String(row[nameIdx] ?? "").trim();
    if (!category && !subCategory && !productName) continue;

    const kam = kamIdx >= 0 ? String(row[kamIdx] ?? "").trim() : "";
    const bucket = normalizedRithikaSubCategory(subCategory, category, productName, marketplace);
    out.push({
      kam: kam || "(blank)",
      category,
      subCategory,
      productName,
      rithikaBucket: bucket ? RITHIKA_SUB_CATEGORY_LABELS[bucket] : null,
    });
  }
  return out;
}

function summarize(fileLabel: string, marketplace: Mp, sheetName: string, recs: RowRec[]) {
  const byKam = new Map<string, { total: number; rithika: number; buckets: Map<string, number>; cats: Map<string, number> }>();

  for (const rec of recs) {
    const key = rec.kam || "(blank)";
    let agg = byKam.get(key);
    if (!agg) {
      agg = { total: 0, rithika: 0, buckets: new Map(), cats: new Map() };
      byKam.set(key, agg);
    }
    agg.total += 1;
    const catKey = `${rec.category} / ${rec.subCategory}`.slice(0, 80);
    agg.cats.set(catKey, (agg.cats.get(catKey) ?? 0) + 1);
    if (rec.rithikaBucket) {
      agg.rithika += 1;
      agg.buckets.set(rec.rithikaBucket, (agg.buckets.get(rec.rithikaBucket) ?? 0) + 1);
    }
  }

  console.log(`\n### ${fileLabel} — ${sheetName} (${marketplace}) — ${recs.length} SKU rows`);
  const sorted = [...byKam.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [kam, agg] of sorted) {
    const pct = agg.total ? ((agg.rithika / agg.total) * 100).toFixed(0) : "0";
    console.log(`\n**${kam}** — ${agg.total} rows, ${agg.rithika} in Rithika scope (${pct}%)`);
    if (agg.buckets.size) {
      console.log("  Rithika buckets:");
      for (const [b, n] of [...agg.buckets.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    - ${b}: ${n}`);
      }
    }
    const topCats = [...agg.cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (topCats.length) {
      console.log("  Top sheet Category / Sub category:");
      for (const [c, n] of topCats) console.log(`    - ${c}: ${n}`);
    }
  }
}

function analyzeWorkbook(path: string, label: string, marketplace: Mp, sheetNames: string[]) {
  const wb = XLSX.readFile(path, { cellDates: true });
  console.log(`\n# ${label}`);
  console.log(`File: ${path.split("/").pop()}`);
  console.log(`Sheets: ${wb.SheetNames.join(", ")}`);

  for (const name of sheetNames) {
    const exact = wb.SheetNames.find((s) => normalizeKey(s) === normalizeKey(name));
    const sheet = exact ? wb.Sheets[exact] : undefined;
    if (!sheet) {
      console.log(`\n(Sheet "${name}" not found)`);
      continue;
    }
    summarize(label, marketplace, exact ?? name, parseSheet(sheet, marketplace, name));
  }

  // Auto-detect Ecom / FK SO tabs if not listed
  for (const sn of wb.SheetNames) {
    const k = normalizeKey(sn);
    if (
      sheetNames.some((n) => normalizeKey(n) === k) ||
      (!k.includes("sellout") && !k.includes("ecom") && !k.includes("gmv") && k !== "consolidated (tez + ecom)")
    ) {
      continue;
    }
    if (sheetNames.length > 0 && sheetNames.includes(sn)) continue;
    const recs = parseSheet(wb.Sheets[sn]!, marketplace, sn);
    if (recs.length > 20) summarize(label, marketplace, sn, recs);
  }
}

console.log("Rithika scope = classifier in rithika-category-scope.ts (not KAM column in app today).\n");

analyzeWorkbook(AZ_PATH, "Amazon master", "amazon", [
  "Zebronics and Zebster GMV",
  "Ecom Sellout",
  "Consolidated (TEZ + Ecom)",
  "GMS_AVS",
]);

analyzeWorkbook(FK_IT_PATH, "Flipkart IT & Gaming master", "flipkart", []);

// List all KAM names on Amazon Ecom Sellout for reference
const azWb = XLSX.readFile(AZ_PATH);
const ecom = azWb.Sheets["Ecom Sellout"];
if (ecom) {
  const recs = parseSheet(ecom, "amazon", "Ecom Sellout");
  const kams = new Set(recs.map((r) => r.kam));
  console.log("\n# All KAM values on Amazon Ecom Sellout");
  console.log([...kams].sort().join(", "));
}
