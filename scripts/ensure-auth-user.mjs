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
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvLocal() {
  const path = resolve(root, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 1) continue;
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) return undefined;
  return process.argv[i + 1];
}

loadEnvLocal();

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (arg("email") ?? "").trim().toLowerCase();
const password = arg("password");
const fullName = arg("name") ?? email.split("@")[0] ?? "User";
const role = arg("role") ?? "viewer";

if (!url || !serviceKey) {
  console.error(
    "Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}
if (!email || !password) {
  console.error("Usage: --email user@example.com --password 'secret' [--name Full Name] [--role viewer|admin]");
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

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: user.id,
      full_name: fullName,
      role,
    },
    { onConflict: "id" },
  );
  if (profileError) throw profileError;

  const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.VITE_SUPABASE_ANON_KEY ?? serviceKey,
      Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY ?? serviceKey}`,
    },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await login.json();
  if (!login.ok) {
    console.error("Login check failed:", login.status, loginBody);
    process.exit(1);
  }

  console.log("Login OK for", email, "| role:", role);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
