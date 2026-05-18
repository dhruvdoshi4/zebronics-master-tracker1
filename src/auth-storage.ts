/** Set on first load in a tab; cleared when sessionStorage is wiped (tab/browser closed). */
export const TAB_SESSION_MARKER = "zebronics-tab-open";

/**
 * If the marker is missing, this is a new tab after a full close — drop any stale login
 * (including tokens left in localStorage by older builds).
 */
export async function ensureFreshBrowserSession(
  supabaseUrl: string,
  signOutLocal: () => Promise<void>,
): Promise<void> {
  if (typeof window === "undefined") return;

  if (!sessionStorage.getItem(TAB_SESSION_MARKER)) {
    clearLegacyLocalAuth(supabaseUrl);
    await signOutLocal();
  }
  sessionStorage.setItem(TAB_SESSION_MARKER, "1");
}

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
