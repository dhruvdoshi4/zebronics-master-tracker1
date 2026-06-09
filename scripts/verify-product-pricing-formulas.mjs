/**
 * Verify pricing formulas against Jan ART_HA_2026 Excel ground truth.
 * Run: node scripts/verify-product-pricing-formulas.mjs
 */
import { readFileSync } from "fs";
import XLSX from "xlsx";

const GST = 1.18;
const TOL = 0.05;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function basicSp(bau, margin) {
  return round2((bau * (1 - margin)) / GST);
}

function eventBasic(event, margin) {
  return round2((event * (1 - margin)) / GST);
}

function basicSupport(basic, event, evMargin, flat) {
  if (flat) return 0;
  return round2(Math.max(basic - eventBasic(event, evMargin), 0));
}

function baseIbd(event) {
  if (event < 5000) return 0;
  return round2(Math.min(event * 0.1, 1250));
}

function netAz(basic, support, topUp) {
  return round2(basic * 0.95 - support - topUp);
}

function netFk(basic, support) {
  return round2(basic * 0.95 - support);
}

function assertClose(label, actual, expected) {
  const ok = Math.abs(actual - expected) <= TOL;
  if (!ok) {
    console.error(`FAIL ${label}: got ${actual}, expected ${expected}`);
    return false;
  }
  console.log(`OK   ${label}`);
  return true;
}

const path =
  process.argv[2] ||
  "C:/Users/Admin/Downloads/Jan ART_HA_2026____ (7).xlsx";
const wb = XLSX.read(readFileSync(path));
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Sheet1 (2)"], {
  header: 1,
  defval: "",
});

let passed = 0;
let failed = 0;

for (let r = 2; r < rows.length; r++) {
  const row = rows[r];
  const asin = String(row[1] ?? "").trim();
  const fsn = String(row[2] ?? "").trim();
  if (!asin && !fsn) continue;

  const bau = Number(row[5]);
  const mAz = Number(row[6]) || 0;
  const mFk = Number(row[7]) || 0;
  const basicAz = Number(row[8]) || 0;
  const basicFk = Number(row[9]) || 0;
  const event = Number(row[10]);
  const evAz = Number(row[11]) || 0;
  const evFk = Number(row[12]) || 0;
  const supAz = Number(row[13]) || 0;
  const supFk = Number(row[14]) || 0;
  const baseIbdVal = Number(row[15]) || 0;
  const topUp = Number(row[16]) || 0;
  const nep = Number(row[18]) || 0;
  const netAzVal = Number(row[19]) || 0;
  const netFkVal = Number(row[20]) || 0;
  const model = String(row[3] ?? "").trim() || asin || fsn;

  if (asin && mAz > 0 && basicAz > 0) {
    if (assertClose(`${model} Basic AZ`, basicSp(bau, mAz), basicAz)) passed++;
    else failed++;
    if (assertClose(`${model} Support AZ`, basicSupport(basicAz, event, evAz, false), supAz))
      passed++;
    else failed++;
    if (assertClose(`${model} Net AZ`, netAz(basicAz, supAz, topUp), netAzVal)) passed++;
    else failed++;
  }

  if (fsn && mFk > 0 && basicFk > 0) {
    if (assertClose(`${model} Basic FK`, basicSp(bau, mFk), basicFk)) passed++;
    else failed++;
    if (assertClose(`${model} Support FK`, basicSupport(basicFk, event, evFk, false), supFk))
      passed++;
    else failed++;
    if (assertClose(`${model} Net FK`, netFk(basicFk, supFk), netFkVal)) passed++;
    else failed++;
  }

  if (event > 0) {
    if (assertClose(`${model} Base IBD`, baseIbd(event), baseIbdVal)) passed++;
    else failed++;
    if (assertClose(`${model} NEP`, round2(event - baseIbdVal - topUp), nep)) passed++;
    else failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
