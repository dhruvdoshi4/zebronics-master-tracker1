import { createClient } from "@supabase/supabase-js";
import { clearLegacyLocalAuth, getAuthStorageKey } from "./auth-storage";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
  );
}

clearLegacyLocalAuth(supabaseUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: window.sessionStorage,
    storageKey: getAuthStorageKey(supabaseUrl),
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

