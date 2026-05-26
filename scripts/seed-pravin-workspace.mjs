/**
 * Provision Pravin workspace (ROMA + PowerBank, global HO stock).
 *
 * 1. Run supabase/run-pravin-catalog-workspace.sql in Supabase SQL Editor (once).
 * 2. Ensure supabase/run-ho-stock-global.sql is applied (global HO stock).
 * 3. node scripts/seed-pravin-workspace.mjs
 * 4. Sign in as pravin@zebronics.com / admin and upload:
 *    - Sellout → Amazon → ROMA & Powerbank workbook (Cocoblu_SO + Click_tect_SO tabs)
 *    - Sellout → Flipkart → same workbook (Flipkart tab)
 *    - Ratings → Amazon → Amazon Ratings & Ranking ROMA workbook
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ensureScript = resolve(root, "scripts/ensure-auth-user.mjs");

const sellout = resolve(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  "Downloads/ROMA & Powerbank Sellout Report of AZ & Flipkart till 25th May 2026.xlsx",
);
const ratings = resolve(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  "Downloads/Amazon Ratings & Ranking ROMA as on 26th May 2026.xlsx",
);

console.log(
  "Step 1: Run supabase/run-pravin-catalog-workspace.sql and run-ho-stock-global.sql in Supabase SQL Editor if not done.\n",
);

const result = spawnSync(
  process.execPath,
  [
    ensureScript,
    "--email",
    "pravin@zebronics.com",
    "--password",
    "admin",
    "--name",
    "Pravin",
    "--role",
    "admin",
    "--scope",
    "default",
  ],
  { stdio: "inherit", cwd: root },
);

if (result.status !== 0) process.exit(result.status ?? 1);

console.log("\nStep 2: Upload as pravin@zebronics.com (password: admin)");
console.log("  • Sellout → Amazon →", existsSync(sellout) ? sellout : "(your ROMA & Powerbank sellout .xlsx)");
console.log("  • Sellout → Flipkart → same file");
console.log(
  "  • Ratings → Amazon →",
  existsSync(ratings) ? ratings : "(Amazon Ratings & Ranking ROMA .xlsx)",
);
console.log("\nHO Stock uses the latest company-wide upload (not workspace-scoped).");
