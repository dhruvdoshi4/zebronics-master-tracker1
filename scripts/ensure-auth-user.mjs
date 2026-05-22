/**
 * Create or update a Supabase Auth user (email confirmed) + ensure profiles row.
 *
 * Requires in .env.local (or env):
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (Dashboard → Project Settings → API → service_role / secret)
 *
 * Usage:
 *   node scripts/ensure-auth-user.mjs --email lovlesh@zeb.com --password '...' --name Lovlesh
 */

import { createClient } from "@supabase/supabase-js";
import { applyEnvLocal, validateServiceRoleKey } from "./load-env-local.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) return undefined;
  return process.argv[i + 1];
}

applyEnvLocal();

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const email = (arg("email") ?? "").trim().toLowerCase();
const password = arg("password");
const fullName = arg("name") ?? email.split("@")[0] ?? "User";
const role = arg("role") ?? "viewer";
const dataScope = arg("scope") === "dawg" ? "dawg" : "default";

if (!url) {
  console.error("Missing VITE_SUPABASE_URL in .env.local");
  process.exit(1);
}

const keyCheck = validateServiceRoleKey(serviceKey, { anonKey });
if (!keyCheck.ok) {
  console.error(keyCheck.message);
  process.exit(1);
}

if (!email || !password) {
  console.error(
    "Usage: --email user@example.com --password 'secret' [--name Full Name] [--role viewer|admin] [--scope default|dawg]",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(targetEmail) {
  let page = 1;
  const perPage = 200;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === targetEmail);
    if (hit) return hit;
    if (data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function main() {
  let user = await findUserByEmail(email);

  if (user) {
    const { data, error } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { ...user.user_metadata, full_name: fullName },
    });
    if (error) throw error;
    user = data.user;
    console.log("Updated existing user:", user.id, user.email);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    user = data.user;
    console.log("Created user:", user.id, user.email);
  }

  const profileRow = {
    id: user.id,
    full_name: fullName,
    role,
    data_scope: dataScope,
  };
  let { error: profileError } = await admin.from("profiles").upsert(profileRow, {
    onConflict: "id",
  });
  if (profileError && /data_scope/i.test(profileError.message ?? "")) {
    ({ error: profileError } = await admin.from("profiles").upsert(
      { id: user.id, full_name: fullName, role },
      { onConflict: "id" },
    ));
    console.warn(
      "profiles.data_scope column missing — run supabase/migrations/011_data_scope.sql first, then re-run with --scope dawg.",
    );
  }
  if (profileError) throw profileError;

  const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey ?? serviceKey,
      Authorization: `Bearer ${anonKey ?? serviceKey}`,
    },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await login.json();
  if (!login.ok) {
    console.error("Login check failed:", login.status, loginBody);
    process.exit(1);
  }

  console.log("Login OK for", email, "| role:", role, "| data_scope:", dataScope);
}

main().catch((err) => {
  const msg = err?.message ?? String(err);
  if (/invalid api key/i.test(msg)) {
    console.error(
      "Invalid API key — SUPABASE_SERVICE_ROLE_KEY in .env.local is wrong or still a placeholder.\n" +
        "Get the service_role secret from:\n" +
        "  https://supabase.com/dashboard/project/niaexyzfpuzidgrzjhlo/settings/api\n" +
        "Then run this script again.\n",
    );
    process.exit(1);
  }
  console.error(msg);
  process.exit(1);
});
