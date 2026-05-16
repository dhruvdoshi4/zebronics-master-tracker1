import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Briefcase, Crown, Sparkles } from "lucide-react";
import { useAuth } from "./use-auth";
import {
  clearWelcomeShown,
  getPendingWelcomeEmail,
  getWelcomeConfig,
  isWelcomePending,
  type WelcomeUserConfig,
} from "./welcome-users";

const SPLASH_MS = 6000;
const EXIT_MS = 550;

function ParticleField({ theme }: { theme: WelcomeUserConfig["theme"] }) {
  const particles = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        left: `${(i * 17 + 7) % 100}%`,
        top: `${(i * 23 + 11) % 100}%`,
        size: 4 + (i % 5) * 2,
        delay: `${(i % 7) * 0.35}s`,
        duration: `${4 + (i % 4)}s`,
      })),
    [],
  );

  const color =
    theme === "boss"
      ? "bg-amber-300/70 shadow-amber-400/50"
      : "bg-cyan-300/70 shadow-cyan-400/50";

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p) => (
        <span
          key={p.id}
          className={`welcome-particle absolute rounded-full ${color} shadow-lg`}
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            animationDelay: p.delay,
            animationDuration: p.duration,
          }}
        />
      ))}
    </div>
  );
}

function WelcomeIcon({ theme }: { theme: WelcomeUserConfig["theme"] }) {
  const isBoss = theme === "boss";
  const MainIcon = isBoss ? Crown : Briefcase;

  return (
    <div className="welcome-splash__icon-ring relative mx-auto mb-8 flex h-24 w-24 items-center justify-center">
      <MainIcon className="welcome-splash__icon h-11 w-11" strokeWidth={1.6} />
      <Sparkles
        className="welcome-splash__icon-spark absolute -right-1 -top-1 h-6 w-6"
        strokeWidth={2}
      />
    </div>
  );
}

export function WelcomeSplashPage() {
  const navigate = useNavigate();
  const { user, isLoading, session } = useAuth();
  const [phase, setPhase] = useState<"show" | "exit">("show");

  const welcomeEmail =
    getPendingWelcomeEmail() ?? user?.email ?? session?.user?.email ?? null;
  const config = getWelcomeConfig(welcomeEmail);
  const shouldShow = isWelcomePending() && Boolean(config);

  useEffect(() => {
    if (!shouldShow || !config) return;

    const exitTimer = window.setTimeout(() => setPhase("exit"), SPLASH_MS - EXIT_MS);
    const doneTimer = window.setTimeout(() => {
      clearWelcomeShown();
      navigate("/app/upload", { replace: true });
    }, SPLASH_MS);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, [shouldShow, config, navigate]);

  if (!isLoading && !session) {
    return <Navigate to="/login" replace />;
  }

  if (!isLoading && (!shouldShow || !config)) {
    return <Navigate to="/app/upload" replace />;
  }

  if (!config) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950 text-white">
        <p className="text-sm opacity-70">Preparing your welcome…</p>
      </div>
    );
  }

  return (
    <div
      className={`welcome-splash welcome-splash--active welcome-splash--${config.theme} fixed inset-0 z-[100] flex items-center justify-center overflow-hidden ${
        phase === "exit" ? "welcome-splash--exit" : ""
      }`}
      aria-live="polite"
      aria-label={`Welcome ${config.firstName}`}
    >
      <div className="welcome-splash__aurora" aria-hidden />
      <div className="welcome-splash__grid" aria-hidden />
      <ParticleField theme={config.theme} />

      <div className="welcome-splash__card relative z-10 mx-4 max-w-lg px-6 text-center">
        <WelcomeIcon theme={config.theme} />

        <p className="welcome-splash__eyebrow mb-3 text-xs font-bold uppercase tracking-[0.35em]">
          Zebronics Master Tracker
        </p>

        <h1 className="welcome-splash__heading mb-5 text-5xl font-black tracking-tight sm:text-6xl">
          <span className="welcome-splash__greeting block text-2xl font-bold uppercase tracking-[0.2em] text-zinc-400 sm:text-3xl">
            Welcome,
          </span>
          <span
            className={`welcome-splash__name welcome-splash__name--${config.theme} mt-2 inline-block`}
          >
            {config.firstName}
          </span>
        </h1>

        <p
          className={`welcome-splash__subtitle welcome-splash__subtitle--epic welcome-splash__subtitle--${config.theme} text-xl font-bold sm:text-3xl`}
        >
          <span className="welcome-splash__subtitle-inner">{config.title}</span>
        </p>

        <div className="welcome-splash__progress mt-10 h-1 overflow-hidden rounded-full">
          <div
            className="welcome-splash__progress-bar h-full rounded-full"
            style={{ animationDuration: `${SPLASH_MS}ms` }}
          />
        </div>

        <p className="mt-4 text-xs font-medium opacity-60">Launching your workspace…</p>
      </div>
    </div>
  );
}
