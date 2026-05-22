/**
 * Provision daWg isolated workspace user.
 *
 * 1. Run supabase/migrations/011_data_scope.sql in Supabase SQL Editor (once).
 * 2. node scripts/seed-dawg-workspace.mjs
 * 3. Sign in as dawg@zebronics.com / admin and upload:
 *    - Sellout: Amazon tab from daWg workbook (same file, marketplace Amazon)
 *    - Sellout: Flipkart tab from same workbook
 *    - HO stock: consolidated HO report when available
 *
 * Optional sellout seed (signed in as dawg via browser Upload Center is easiest).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ensureScript = resolve(root, "scripts/ensure-auth-user.mjs");

const workbook = resolve(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  "Downloads/daWg Sellout Report till 20th May 2026.xlsx",
);

console.log("Step 1: Apply supabase/migrations/011_data_scope.sql in Supabase SQL Editor if not done.\n");

const result = spawnSync(
  process.execPath,
  [
    ensureScript,
    "--email",
    "dawg@zebronics.com",
    "--password",
    "admin",
    "--name",
    "daWg",
    "--role",
    "viewer",
    "--scope",
    "dawg",
  ],
  { stdio: "inherit", cwd: root },
);

if (result.status !== 0) process.exit(result.status ?? 1);

console.log("\nStep 2: Upload data as dawg@zebronics.com (password: admin)");
console.log("  • Upload Center → Sellout → Amazon →", existsSync(workbook) ? workbook : "(your daWg sellout .xlsx)");
console.log("  • Upload Center → Sellout → Flipkart → same file");
console.log("  • Upload Center → HO stock → consolidated HO Stock report");
console.log("\nThen open HO Stock — category wise (Gaming - daWg, Personal Audio).");
