import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isPlaceholderSecret,
  readEnvLocal,
  validateServiceRoleKey,
} from "./load-env-local.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = resolve(root, ".env.local");

if (!existsSync(path)) {
  console.error("Missing .env.local — copy .env.example and fill in Supabase keys.");
  process.exit(1);
}

const keys = readEnvLocal();
let failed = false;

for (const name of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]) {
  const v = keys[name];
  if (!v) {
    console.error(`${name}: missing`);
    failed = true;
  } else if (isPlaceholderSecret(v)) {
    console.error(`${name}: placeholder — set a real value`);
    failed = true;
  } else {
    console.log(`${name}: ok`);
  }
}

const serviceCheck = validateServiceRoleKey(keys.SUPABASE_SERVICE_ROLE_KEY, {
  anonKey: keys.VITE_SUPABASE_ANON_KEY,
});
if (!serviceCheck.ok) {
  console.error("SUPABASE_SERVICE_ROLE_KEY:", serviceCheck.message.split("\n")[0]);
  failed = true;
} else {
  console.log("SUPABASE_SERVICE_ROLE_KEY: ok");
}

process.exit(failed ? 1 : 0);
