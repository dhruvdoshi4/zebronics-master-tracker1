import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @returns {Record<string, string>} */
export function readEnvLocal() {
  const path = resolve(root, ".env.local");
  const keys = {};
  if (!existsSync(path)) return keys;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 1) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    keys[key] = value;
  }
  return keys;
}

export function applyEnvLocal() {
  for (const [key, value] of Object.entries(readEnvLocal())) {
    if (!process.env[key]) process.env[key] = value;
  }
}

const PLACEHOLDER_RE =
  /^(your_|YOUR_|changeme|replace_me|xxx+|paste_|example)/i;

export function isPlaceholderSecret(value) {
  if (!value) return true;
  if (PLACEHOLDER_RE.test(value)) return true;
  if (/your_supabase|YOUR_PROJECT/i.test(value)) return true;
  return false;
}

export function validateServiceRoleKey(serviceKey, { anonKey } = {}) {
  if (!serviceKey) {
    return {
      ok: false,
      message:
        "SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.\n\n" +
        "Add it from Supabase Dashboard → Project Settings → API → service_role (secret).\n" +
        "Never put this key in Vercel or the browser — local/scripts only.",
    };
  }
  if (isPlaceholderSecret(serviceKey)) {
    return {
      ok: false,
      message:
        "SUPABASE_SERVICE_ROLE_KEY in .env.local is still the placeholder from .env.example.\n\n" +
        "Replace it with the real service_role secret from:\n" +
        "  https://supabase.com/dashboard/project/niaexyzfpuzidgrzjhlo/settings/api\n\n" +
        "Or create the user manually: Authentication → Users → Add user →\n" +
        "  qcom@zebronics.com / admin (enable Auto Confirm).",
    };
  }
  if (anonKey && serviceKey === anonKey) {
    return {
      ok: false,
      message:
        "SUPABASE_SERVICE_ROLE_KEY must be the service_role secret, not the anon/publishable key.\n" +
        "In API settings, copy the key labeled service_role (secret), not anon.",
    };
  }
  return { ok: true };
}
