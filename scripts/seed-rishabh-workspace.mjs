/**
 * Provision Rishabh Home Audio workspace.
 *
 * 1. Run supabase/run-rishabh-catalog-workspace.sql in Supabase SQL Editor (once).
 * 2. node scripts/seed-rishabh-workspace.mjs
 * 3. Sign in as rishabh@zebronics.com / admin and upload:
 *    - Sellout → Amazon → Home Audio sellout workbook (Ecom Sellout tab)
 *    - Sellout → Flipkart → same format when available
 *    - Ratings, GMS plan, HO stock (company-wide HO upload)
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ensureScript = resolve(root, "scripts/ensure-auth-user.mjs");

const sellout = resolve(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  "Downloads/AZ(A) - Zebronics Sellout report till 24th May  & Warehouse Report as on 24th May 2026.xlsx",
);

console.log(
  "Step 1: Run supabase/run-rishabh-catalog-workspace.sql in Supabase SQL Editor if not done.\n",
);

const result = spawnSync(
  process.execPath,
  [
    ensureScript,
    "--email",
    "rishabh@zebronics.com",
    "--password",
    "admin",
    "--name",
    "Rishabh",
    "--role",
    "admin",
    "--scope",
    "default",
  ],
  { stdio: "inherit", cwd: root },
);

if (result.status !== 0) process.exit(result.status ?? 1);

console.log("\nStep 2: Upload as rishabh@zebronics.com (password: admin)");
console.log(
  "  • Sellout → Amazon →",
  existsSync(sellout) ? sellout : "(your Home Audio AZ sellout .xlsx)",
);
console.log("  • Sellout → Flipkart → same workbook format when ready");
console.log("  • Optional: Ratings, GMS plan sheets for this workspace");
console.log("\nOpen /app/ha/amazon after uploads complete.");
