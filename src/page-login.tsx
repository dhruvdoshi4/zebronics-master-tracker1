import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { OfficialBrandBackground } from "./brand-background";
import { useAuth } from "./use-auth";
import { Button, Card, Input } from "./ui";
import {
  getWelcomeConfig,
  isWelcomePending,
  markWelcomePending,
  normalizeLoginEmail,
} from "./welcome-users";

export function LoginPage() {
  const navigate = useNavigate();
  const { signIn, session, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isLoading && session) {
    const normalized = normalizeLoginEmail(session.user.email ?? "");
    if (getWelcomeConfig(normalized) && isWelcomePending()) {
      return <Navigate to="/welcome" replace />;
    }
    return <Navigate to="/app/upload" replace />;
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <OfficialBrandBackground />
      <div className="login-page__scrim pointer-events-none absolute inset-0" aria-hidden />
      <Card className="relative z-10 w-full max-w-md space-y-6 border-zinc-200/80 bg-white/90 p-8 shadow-xl backdrop-blur-md">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-zinc-900">Master Tracker</h1>
          <p className="mt-1 text-sm text-zinc-500">Sign in to continue</p>
        </div>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setIsSubmitting(true);
            void signIn(email, password)
              .then(() => {
                const normalized = normalizeLoginEmail(email);
                const welcome = getWelcomeConfig(normalized);
                if (welcome) markWelcomePending(normalized);
                navigate(welcome ? "/welcome" : "/app/upload", { replace: true });
              })
              .catch((e: unknown) => {
                const message =
                  e instanceof Error ? e.message : "Unable to sign in with given credentials.";
                if (/failed to fetch/i.test(message)) {
                  setError(
                    "Cannot reach the login server. Check your internet connection, VPN, or Supabase settings in .env.local (local) or Vercel env vars (live site), then refresh and try again.",
                  );
                  return;
                }
                setError(message);
              })
              .finally(() => setIsSubmitting(false));
          }}
        >
          <Input
            type="email"
            required
            value={email}
            placeholder="name@company.com"
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            type="password"
            required
            value={password}
            placeholder="Password"
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
