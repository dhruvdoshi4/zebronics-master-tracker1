import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "./use-auth";
import { Button, Card, Input, Logo } from "./ui";
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 via-violet-50/40 to-sky-50/40 p-4 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-900">
      <Card className="w-full max-w-md space-y-6 p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo size={64} className="ring-1 ring-zinc-200 dark:ring-zinc-700" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
              Zebronics
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              Master Tracker
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Sign in to continue
            </p>
          </div>
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
                setError(
                  e instanceof Error
                    ? e.message
                    : "Unable to sign in with given credentials.",
                );
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
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
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
