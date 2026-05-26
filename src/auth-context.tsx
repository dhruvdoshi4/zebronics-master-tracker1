import {
  type PropsWithChildren,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { ensureFreshBrowserSession } from "./auth-storage";
import { supabase } from "./supabase";
import { AuthContext, type AuthContextValue } from "./auth-store";
import { effectiveAppRole } from "./catalog-workspace";
import { ensureProfileDataScopeForEmail } from "./data-scope";
import type { Profile } from "./types";
import { clearWelcomeShown } from "./welcome-users";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

async function getProfile(
  userId: string,
  email: string | null | undefined,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    return null;
  }
  const row = data as Profile;
  const withRole: Profile = {
    ...row,
    role: effectiveAppRole(email, row.role),
  };
  return ensureProfileDataScopeForEmail(userId, email, withRole);
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const init = async () => {
      await ensureFreshBrowserSession(supabaseUrl, async () => {
        await supabase.auth.signOut({ scope: "local" });
      });

      const {
        data: { session: initialSession },
      } = await supabase.auth.getSession();
      setSession(initialSession);
      if (initialSession?.user) {
        const profileData = await getProfile(
          initialSession.user.id,
          initialSession.user.email,
        );
        setProfile(profileData);
      }
      setIsLoading(false);
    };

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        void getProfile(nextSession.user.id, nextSession.user.email).then((nextProfile) => {
          setProfile(nextProfile);
        });
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      session,
      user: session?.user ?? null,
      profile,
      signIn: async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        setSession(data.session);
        if (data.session?.user) {
          void getProfile(data.session.user.id, data.session.user.email).then(setProfile);
        }
      },
      signOut: async () => {
        clearWelcomeShown();
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    }),
    [isLoading, profile, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

