import { type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "./utils";

interface RechartsTooltipPayload {
  name?: string | number;
  value?: number | string;
  dataKey?: string | number;
  color?: string;
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white/95 p-5 shadow-sm backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/85",
        className,
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-violet-900",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-violet-900",
        className,
      )}
      {...props}
    />
  );
}

export function Button({
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition",
        disabled
          ? "cursor-not-allowed bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
          : "bg-violet-600 text-white shadow-sm hover:bg-violet-700 active:bg-violet-800",
        className,
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function PageTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {title}
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
    </div>
  );
}

export function InlineLoader({ text = "Loading..." }: { text?: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-sm text-zinc-500">
      <LoaderCircle className="h-4 w-4 animate-spin" />
      {text}
    </div>
  );
}

const STAT_VARIANT: Record<
  string,
  { card: string; label: string; value: string; hint: string }
> = {
  default: {
    card: "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
    label: "text-zinc-500 dark:text-zinc-400",
    value: "text-zinc-900 dark:text-zinc-100",
    hint: "text-zinc-500 dark:text-zinc-400",
  },
  violet: {
    card: "border-violet-200 bg-violet-50/80 dark:border-violet-700/50 dark:bg-violet-950/40",
    label: "text-violet-600 dark:text-violet-300",
    value: "text-violet-900 dark:text-violet-100",
    hint: "text-violet-700/70 dark:text-violet-200/70",
  },
  emerald: {
    card: "border-emerald-200 bg-emerald-50/80 dark:border-emerald-700/50 dark:bg-emerald-950/40",
    label: "text-emerald-700 dark:text-emerald-300",
    value: "text-emerald-900 dark:text-emerald-100",
    hint: "text-emerald-700/70 dark:text-emerald-200/70",
  },
  amber: {
    card: "border-amber-300 bg-amber-50/80 dark:border-amber-700/60 dark:bg-amber-950/40",
    label: "text-amber-700 dark:text-amber-300",
    value: "text-amber-900 dark:text-amber-100",
    hint: "text-amber-700/70 dark:text-amber-200/70",
  },
  sky: {
    card: "border-sky-200 bg-sky-50/80 dark:border-sky-700/50 dark:bg-sky-950/40",
    label: "text-sky-700 dark:text-sky-300",
    value: "text-sky-900 dark:text-sky-100",
    hint: "text-sky-700/70 dark:text-sky-200/70",
  },
};

export function StatCard({
  label,
  value,
  variant = "default",
  hint,
}: {
  label: string;
  value: string;
  variant?: "default" | "violet" | "emerald" | "amber" | "sky";
  hint?: string;
}) {
  const styles = STAT_VARIANT[variant];
  return (
    <div className={cn("rounded-2xl border p-5 shadow-sm", styles.card)}>
      <p
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.14em]",
          styles.label,
        )}
      >
        {label}
      </p>
      <p className={cn("mt-1 text-2xl font-bold tracking-tight", styles.value)}>
        {value}
      </p>
      {hint ? (
        <p className={cn("mt-1 text-xs", styles.hint)}>{hint}</p>
      ) : null}
    </div>
  );
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
  labelPrefix,
}: {
  active?: boolean;
  payload?: RechartsTooltipPayload[];
  label?: string | number;
  formatValue: (value: number | string | undefined) => string;
  labelPrefix?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      {label ? (
        <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {labelPrefix ? `${labelPrefix} - ` : ""}
          {label}
        </p>
      ) : null}
      {payload.map((entry, index) => (
        <div
          key={`${entry.dataKey ?? entry.name ?? index}`}
          className="flex items-center gap-2"
        >
          {entry.color ? (
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: entry.color }}
            />
          ) : null}
          <span className="text-zinc-600 dark:text-zinc-300">{entry.name}</span>
          <span className="ml-auto font-semibold text-zinc-900 dark:text-zinc-100">
            {formatValue(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="text-center">
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        {description}
      </p>
    </Card>
  );
}

