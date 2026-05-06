import { createContext } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { Profile } from "./types";

export interface AuthContextValue {
  isLoading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

