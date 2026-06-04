/**
 * Compare Pravin PowerBank category-analysis roll-ups vs upload notes / daily_sales.
 *
 *   node scripts/diagnose-pravin-powerbank-category.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { applyEnvLocal, validateServiceRoleKey } from "./load-env-local.mjs";

applyEnvLocal();

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const keyCheck = validateServiceRoleKey(serviceKey, {
  anonKey: process.env.VITE_SUPABASE_ANON_KEY,
});
if (!url || !keyCheck.ok) {
  console.error(keyCheck.message ?? "Missing VITE_SUPABASE_URL");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WS = "roma_powerbank";
const PRIOR_FY_MONTHS = [
  "2025-04",
  "2025-05",
  "2025-06",
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
];

function normalizeKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[-_\s]+/g, " ")
    .replace(/[^\w\s/]/g, "")
    .trim();
}

function isPowerBankRow(row) {
  const sub = normalizeKey(row.sub_category);
  const cat = normalizeKey(row.category);
  const name = normalizeKey(row.product_name);
  if (sub === "powerbank" || sub === "power bank" || cat === "powerbank" || cat === "power bank") {
    return true;
  }
  return /\bpower\s*bank\b/.test(name);
}

function uploadBelongsToPravin(row) {
  if (row.catalog_workspace === WS) return true;
  const notes = String(row.notes ?? "");
  return notes.includes(`catalog_workspace=${WS}`) || notes.includes(`catalog_workspace: ${WS}`);
}

async function latestPravinUpload(marketplace) {
  const { data, error } = await admin
    .from("uploads")
    .select("id, file_name, snapshot_date, uploaded_at, catalog_workspace, notes, valid_row_count")
    .eq("marketplace", marketplace)
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []).find(uploadBelongsToPravin) ?? null;
}

async function sumMetrics(uploadId, snapshotDate, field) {
  let total = 0;
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await admin
      .from("computed_metrics")
      .select(`product_code, ${field}`)
      .eq("upload_id", uploadId)
      .eq("as_of_date", snapshotDate)
      .range(from, from + page - 1);
    if (error) throw error;
    const batch = data ?? [];
    if (batch.length === 0) break;
    const codes = [...new Set(batch.map((r) => String(r.product_code).trim()).filter(Boolean))];
    const { data: pmRows } = await admin
      .from("product_master")
      .select("product_code, category, sub_category, product_name, catalog_workspace")
      .eq("marketplace", "amazon")
      .in("product_code", codes);
    const pmBy = new Map((pmRows ?? []).map((r) => [String(r.product_code).toUpperCase(), r]));
    for (const row of batch) {
      const code = String(row.product_code ?? "").trim();
      const pm = pmBy.get(code.toUpperCase()) ?? pmBy.get(code);
      if (!pm || !isPowerBankRow(pm)) continue;
      const tagged = String(pm.catalog_workspace ?? "").trim();
      if (tagged && tagged !== WS) {
        console.log(
          `  [tag mismatch] ${code} workspace=${tagged} — still counted via sheet scope`,
        );
      }
      total += Number(row[field] ?? 0);
    }
    if (batch.length < page) break;
    from += page;
  }
  return total;
}

async function sumPriorFyMonths(uploadId) {
  const monthly = new Map();
  let from = 0;
  const page = 2000;
  for (;;) {
    const { data, error } = await admin
      .from("daily_sales")
      .select("product_code, sale_date, units_sold")
      .eq("marketplace", "amazon")
      .eq("upload_id", uploadId)
      .range(from, from + page - 1);
    if (error) throw error;
    const batch = data ?? [];
    if (batch.length === 0) break;
    const codes = [...new Set(batch.map((r) => String(r.product_code).trim()).filter(Boolean))];
    const { data: pmRows } = await admin
      .from("product_master")
      .select("product_code, category, sub_category, product_name, catalog_workspace")
      .eq("marketplace", "amazon")
      .in("product_code", codes);
    const pmBy = new Map((pmRows ?? []).map((r) => [String(r.product_code).toUpperCase(), r]));
    for (const row of batch) {
      const code = String(row.product_code ?? "").trim();
      const pm = pmBy.get(code.toUpperCase()) ?? pmBy.get(code);
      if (!pm || !isPowerBankRow(pm)) continue;
      const ym = String(row.sale_date).slice(0, 7);
      if (!PRIOR_FY_MONTHS.includes(ym)) continue;
      monthly.set(ym, (monthly.get(ym) ?? 0) + Number(row.units_sold ?? 0));
    }
    if (batch.length < page) break;
    from += page;
  }
  let total = 0;
  for (const ym of PRIOR_FY_MONTHS) total += monthly.get(ym) ?? 0;
  return { total, monthly };
}

function parseNotesBucket(notes) {
  try {
    const doc = JSON.parse(String(notes ?? ""));
    return doc?.sheetCategoryKpis?.byCategory?.powerbank ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const upload = await latestPravinUpload("amazon");
  if (!upload) {
    console.error("No Pravin Amazon sellout upload found.");
    process.exit(1);
  }
  console.log("Latest Pravin Amazon upload:");
  console.log(`  id=${upload.id}`);
  console.log(`  snapshot=${upload.snapshot_date}`);
  console.log(`  file=${upload.file_name}`);
  console.log(`  valid_rows=${upload.valid_row_count}`);

  const bucket = parseNotesBucket(upload.notes);
  if (bucket) {
    console.log("\nUpload notes PowerBank bucket:");
    console.log(`  sku_count=${bucket.sku_count}`);
    console.log(`  prior_fy_so_units (2025 SO col)=${bucket.prior_fy_so_units}`);
    console.log(`  current_fy_so_units (2026 SO col)=${bucket.current_fy_so_units}`);
    console.log(`  may_mtd_units=${bucket.may_mtd_units}`);
  }

  const [priorMonths, currentFy, mayMtd] = await Promise.all([
    sumPriorFyMonths(upload.id),
    sumMetrics(upload.id, upload.snapshot_date, "current_fy_so_units"),
    sumMetrics(upload.id, upload.snapshot_date, "may_mtd_units"),
  ]);

  console.log("\nPowerBank-scoped Amazon totals from DB (expected on dashboard after fix):");
  console.log(`  FY 25-26 (month sum Apr-25…Mar-26) = ${priorMonths.total}`);
  console.log(`  FY 26-27 (2026 SO column)         = ${currentFy}`);
  console.log(`  Jun/ report-month MTD             = ${mayMtd}`);
  console.log("\nMonth breakdown (prior FY):");
  for (const ym of PRIOR_FY_MONTHS) {
    console.log(`  ${ym}: ${priorMonths.monthly.get(ym) ?? 0}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
