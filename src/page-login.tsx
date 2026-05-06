import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "./use-auth";
import { Button, Card, Input } from "./ui";

export function LoginPage() {
  const navigate = useNavigate();
  const { signIn, session, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isLoading && session) {
    return <Navigate to="/app/amazon" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-950">
      <Card className="w-full max-w-md space-y-5">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-violet-500">
            Zebronics
          </p>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            Master Tracker Login
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Email/password login via Supabase Auth.
          </p>
        </div>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setIsSubmitting(true);
            void signIn(email, password)
              .then(() => navigate("/app/amazon"))
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

