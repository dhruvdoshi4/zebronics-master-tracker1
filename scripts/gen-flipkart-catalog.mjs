import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const xlsxPath =
  process.argv[2] ??
  "C:/Users/Admin/Downloads/FK SO Report - Monitors & Projectors till 13th May 2026.xlsx";

/** Same families as TRACKED_SUB_CATEGORIES in src/types.ts */
function isTrackedFlipkartRow(category, subCategory) {
  const hay = `${String(category).toLowerCase()} ${String(subCategory).toLowerCase()}`;
  return (
    hay.includes("monitor") ||
    hay.includes("projector") ||
    hay.includes("cartridge")
  );
}

const wb = XLSX.readFile(xlsxPath);
const sheetName =
  wb.SheetNames.find((n) => /sellout/i.test(n)) ?? wb.SheetNames[0];
const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
  header: 1,
  defval: "",
});

const map = {};
for (let i = 2; i < data.length; i++) {
  const [fsn, cat, sub, model] = data[i];
  if (!fsn) continue;
  if (!isTrackedFlipkartRow(cat, sub)) continue;
  const f = String(fsn).trim().toUpperCase();
  const m = String(model ?? "").trim();
  if (f && m) map[f] = m;
}

const entries = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
const body = entries
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  .join("\n");

const out = `/** FSN → model name (Flipkart Sellout master — tracked categories). */
export const FLIPKART_FSN_MODEL_NAMES: Record<string, string> = {
${body}
};

export function lookupFlipkartModelName(fsn: string): string | undefined {
  const key = String(fsn ?? "").trim().toUpperCase();
  if (!key) return undefined;
  return FLIPKART_FSN_MODEL_NAMES[key];
}

export function enrichFlipkartProductName(
  productCode: string,
  productName: string | null | undefined,
): string {
  const code = String(productCode ?? "").trim();
  const name = String(productName ?? "").trim();
  const fromCatalog = lookupFlipkartModelName(code);
  if (fromCatalog) return fromCatalog;
  return name;
}
`;

fs.writeFileSync(path.join(__dirname, "../src/flipkart-fsn-catalog.ts"), out);
console.log(`Wrote ${entries.length} FSN entries to src/flipkart-fsn-catalog.ts`);
