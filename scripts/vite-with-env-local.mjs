/**
 * Run Vite with .env.local winning over machine-level VITE_SUPABASE_* placeholders
 * (some Windows setups set VITE_SUPABASE_URL=http://localhost, which breaks login).
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvLocal } from "./load-env-local.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const local = readEnvLocal();

const env = { ...process.env };
for (const [key, value] of Object.entries(local)) {
  if (value) env[key] = value;
}

const viteArgs = process.argv.slice(2);
const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", ...viteArgs],
  {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
