/**
 * Provision global admin account (Marketplace_Global + QCOM realm toggle in app).
 *
 *   npm run seed:admin
 *
 * Sign in as admin@zebronics.com / admin
 * Use the header toggle to switch Amazon + Flipkart vs Quick Commerce.
 */

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ensureScript = resolve(root, "scripts/ensure-auth-user.mjs");

const password = process.env.ADMIN_PASSWORD ?? "admin";

console.log("Creating or updating admin@zebronics.com (role=admin, data_scope=default)…\n");

const result = spawnSync(
  process.execPath,
  [
    ensureScript,
    "--email",
    "admin@zebronics.com",
    "--password",
    password,
    "--name",
    "Master Tracker Admin",
    "--role",
    "admin",
    "--scope",
    "default",
  ],
  { stdio: "inherit", cwd: root },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(
  "\nDone. Sign in at the app with admin@zebronics.com and use the purple header toggle for QCOM vs Amazon + Flipkart.",
);
