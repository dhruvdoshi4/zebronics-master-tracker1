import type { ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Info,
  MinusCircle,
  TrendingUp,
} from "lucide-react";
import { cn, formatDecimal, formatGmsCr } from "./utils";

export function GmsFormulaPill({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-900 shadow-sm",
        className,
      )}
    >
      <Info className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
      <span>
        Formula: <span className="font-bold">GMS = SO × BAU ÷ 1.18</span>
      </span>
    </div>
  );
}

export function GmsTrendBadge({
  pct,
  label,
}: {
  pct: number | null;
  label: string;
}) {
  if (pct === null || !Number.isFinite(pct)) return null;
  const up = pct >= 0;
  return (
    <span
      className={cn(
        "mt-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold",
        up
          ? "bg-emerald-100 text-emerald-800"
          : "bg-rose-100 text-rose-800",
      )}
    >
      {up ? (
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
      )}
      {up ? "↑" : "↓"} {formatDecimal(Math.abs(pct))}% {label}
    </span>
  );
}

export function formatGmsChannelHint(
  ch: { amazon: number; flipkart: number } | undefined,
  channels: { amazon: boolean; flipkart: boolean },
  opts?: { showPct?: boolean },
): string | undefined {
  if (!ch) return undefined;
  const parts: string[] = [];
  const total =
    (channels.amazon ? ch.amazon : 0) + (channels.flipkart ? ch.flipkart : 0);
  if (channels.amazon) {
    const bit = formatGmsCr(ch.amazon);
    parts.push(
      opts?.showPct && total > 0
        ? `${bit} Amazon (${Math.round((ch.amazon / total) * 100)}%)`
        : `${bit} Amazon`,
    );
  }
  if (channels.flipkart) {
    const bit = formatGmsCr(ch.flipkart);
    parts.push(
      opts?.showPct && total > 0
        ? `${bit} Flipkart (${Math.round((ch.flipkart / total) * 100)}%)`
        : `${bit} Flipkart`,
    );
  }
  return parts.length ? parts.join(" · ") : undefined;
}

export function GmsKpiCard({
  label,
  value,
  hint,
  trend,
  accent = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: { pct: number | null; label: string };
  accent?: "default" | "emerald" | "amber" | "violet" | "sky";
}) {
  const accentRing: Record<string, string> = {
    default: "border-zinc-200",
    emerald: "border-emerald-200/80",
    amber: "border-amber-200/80",
    violet: "border-violet-200/80",
    sky: "border-sky-200/80",
  };
  return (
    <div
      className={cn(
        "flex min-h-[148px] flex-col rounded-2xl border bg-white p-5 shadow-sm",
        accentRing[accent],
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums text-zinc-950">
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-xs font-semibold leading-relaxed text-zinc-600">{hint}</p>
      ) : null}
      {trend ? <GmsTrendBadge pct={trend.pct} label={trend.label} /> : null}
    </div>
  );
}

export function GmsMiniStat({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50/80 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={cn("mt-1 text-xl font-extrabold tabular-nums text-zinc-900", valueClassName)}>
        {value}
      </p>
      <p className="mt-1 text-xs font-semibold text-zinc-600">{sub}</p>
    </div>
  );
}

export function GmsInsightsPanel({
  items,
  onViewReport,
}: {
  items: Array<{ tone: "down" | "up" | "neutral"; text: ReactNode }>;
  onViewReport?: () => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h4 className="text-sm font-bold text-zinc-900">Insights</h4>
      <ul className="mt-4 flex-1 space-y-4">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 text-sm font-medium leading-snug text-zinc-700">
            <span className="mt-0.5 shrink-0" aria-hidden>
              {item.tone === "down" ? (
                <ArrowDownRight className="h-5 w-5 text-rose-500" />
              ) : item.tone === "up" ? (
                <TrendingUp className="h-5 w-5 text-emerald-500" />
              ) : (
                <MinusCircle className="h-5 w-5 text-violet-500" />
              )}
            </span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
      {onViewReport ? (
        <button
          type="button"
          onClick={onViewReport}
          className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-violet-700 hover:text-violet-900"
        >
          View detailed report
          <ChevronRight className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export function GmsPageFooter({
  sourceLabel,
  updatedLabel,
}: {
  sourceLabel: string;
  updatedLabel: string;
}) {
  return (
    <footer className="flex flex-col gap-2 border-t border-zinc-200 pt-4 text-xs font-medium text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
      <p className="inline-flex items-center gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
        All values use: <span className="font-bold text-zinc-700">GMS = SO × BAU ÷ 1.18</span>
      </p>
      <p>
        Source: {sourceLabel} · Last updated: {updatedLabel}
      </p>
    </footer>
  );
}
