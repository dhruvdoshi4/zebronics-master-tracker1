/**
 * Diagnose Pravin Amazon/Flipkart dashboard metrics in Supabase.
 *
 * Requires .env.local with VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 *   node scripts/diagnose-pravin-dashboard.mjs
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

function parseWs(row) {
  if (row.catalog_workspace === WS) return true;
  const notes = String(row.notes ?? "");
  return notes.includes(`catalog_workspace=${WS}`) || notes.includes(`catalog_workspace: ${WS}`);
}

async function channelDiag(marketplace) {
  console.log(`\n=== ${marketplace.toUpperCase()} ===`);

  const { data: uploads, error: uErr } = await admin
    .from("uploads")
    .select("id, file_name, snapshot_date, upload_kind, catalog_workspace, notes, valid_row_count, uploaded_at, status")
    .eq("marketplace", marketplace)
    .eq("upload_kind", "sellout")
    .order("uploaded_at", { ascending: false })
    .limit(10);
  if (uErr) throw uErr;

  const scoped = (uploads ?? []).filter(parseWs);
  console.log(`Sellout uploads (workspace ${WS}):`, scoped.length);
  for (const u of scoped.slice(0, 3)) {
    console.log(
      `  • ${u.uploaded_at?.slice(0, 19)} | ${u.status} | valid=${u.valid_row_count} | ${u.file_name}`,
    );
    const { count: mCount } = await admin
      .from("computed_metrics")
      .select("product_code", { count: "exact", head: true })
      .eq("upload_id", u.id);
    const { count: dCount } = await admin
      .from("daily_sales")
      .select("product_code", { count: "exact", head: true })
      .eq("upload_id", u.id);
    console.log(`      computed_metrics: ${mCount ?? 0} | daily_sales: ${dCount ?? 0}`);
    if ((mCount ?? 0) > 0) {
      const { data: sample } = await admin
        .from("computed_metrics")
        .select("product_code, inventory_units, may_mtd_units, total_so_units")
        .eq("upload_id", u.id)
        .limit(3);
      console.log("      sample:", sample);
    }
  }

  const { count: pmCount } = await admin
    .from("product_master")
    .select("product_code", { count: "exact", head: true })
    .eq("marketplace", marketplace)
    .eq("catalog_workspace", WS);
  console.log(`product_master (${WS}):`, pmCount ?? 0);
}

await channelDiag("amazon");
await channelDiag("flipkart");
console.log("\nDone. If computed_metrics is 0 for latest uploads, KPI save failed — run supabase/run-pravin-metrics-complete.sql and re-upload.\n");
