/**
 * Diagnose Rishabh Home Audio lookup for a specific ASIN/FSN.
 *
 *   node scripts/diagnose-rishabh-lookup.mjs B0DB29X1YX
 */

import { createClient } from "@supabase/supabase-js";
import { applyEnvLocal, validateServiceRoleKey } from "./load-env-local.mjs";

const code = (process.argv[2] ?? "B0DB29X1YX").trim().toUpperCase();
const WS = "home_audio";

applyEnvLocal();
const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const keyCheck = validateServiceRoleKey(serviceKey, {
  anonKey: process.env.VITE_SUPABASE_ANON_KEY,
});
if (!url || !keyCheck.ok) {
  console.error(keyCheck.message ?? "Missing env");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function wsMatch(row) {
  if (row.catalog_workspace === WS) return true;
  const notes = String(row.notes ?? "");
  return notes.includes(`catalog_workspace=${WS}`);
}

async function main() {
  console.log("Lookup code:", code, "| workspace:", WS);

  for (const mp of ["amazon", "flipkart"]) {
    console.log(`\n=== ${mp} ===`);

    const { data: uploads } = await admin
      .from("uploads")
      .select("id, file_name, status, valid_row_count, catalog_workspace, notes, uploaded_at")
      .eq("marketplace", mp)
      .eq("upload_kind", "sellout")
      .order("uploaded_at", { ascending: false })
      .limit(15);

    const scoped = (uploads ?? []).filter(wsMatch);
    console.log("home_audio sellout uploads:", scoped.length);
    for (const u of scoped.slice(0, 3)) {
      console.log(
        `  ${u.status} valid=${u.valid_row_count} ${u.file_name} @ ${u.uploaded_at?.slice(0, 19)}`,
      );
      if (u.status !== "completed") continue;
      const { data: hit } = await admin
        .from("computed_metrics")
        .select("product_code")
        .eq("upload_id", u.id)
        .ilike("product_code", code)
        .limit(3);
      console.log("    metric hit:", hit?.length ? hit : "none");
    }

    const latest = scoped.find((u) => u.status === "completed");
    if (latest) {
      const { count } = await admin
        .from("computed_metrics")
        .select("product_code", { count: "exact", head: true })
        .eq("upload_id", latest.id);
      console.log("Latest upload metric rows:", count ?? 0);
    } else {
      console.log("NO completed home_audio sellout upload for", mp);
    }

    const { data: pm } = await admin
      .from("product_master")
      .select("product_code, category, sub_category, catalog_workspace, product_name")
      .eq("marketplace", mp)
      .ilike("product_code", code)
      .limit(5);
    console.log("product_master matches:", pm ?? []);

    const { data: anyPm } = await admin
      .from("product_master")
      .select("product_code, category, sub_category, catalog_workspace")
      .eq("marketplace", mp)
      .ilike("product_code", `%${code.slice(0, 8)}%`)
      .limit(5);
    if ((pm ?? []).length === 0 && (anyPm ?? []).length) {
      console.log("Similar codes:", anyPm);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
