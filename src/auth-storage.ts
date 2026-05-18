/** Supabase auth token key — sessionStorage only (cleared when the tab/browser closes). */
export function getAuthStorageKey(supabaseUrl: string): string {
  const ref = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  return ref ? `sb-${ref}-auth-token` : "sb-auth-token";
}

/** Remove old localStorage sessions so reopening the app does not restore a stale login. */
export function clearLegacyLocalAuth(supabaseUrl: string): void {
  if (typeof window === "undefined") return;

  const key = getAuthStorageKey(supabaseUrl);
  window.localStorage.removeItem(key);

  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const k = window.localStorage.key(i);
    if (k?.startsWith("sb-") && k.includes("auth")) {
      window.localStorage.removeItem(k);
    }
  }
}
