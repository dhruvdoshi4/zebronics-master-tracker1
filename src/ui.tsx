import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Clock, LoaderCircle } from "lucide-react";
import { ZEBRONICS_LOGO_SRC } from "./brand-logo";
import {
  SUB_CATEGORY_FILTER_LABELS,
  SUB_CATEGORY_FILTER_OPTIONS,
  TRACKED_SUB_CATEGORIES,
  type SubCategoryFilter,
} from "./types";
import { cn, formatCoverageDataAsOf } from "./utils";

/** Form field caption — bold, high contrast (matches PO / dashboard tone). */
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.08em] text-zinc-700 dark:text-zinc-300">
      {children}
    </p>
  );
}

interface RechartsTooltipPayload {
  name?: string | number;
  value?: number | string;
  dataKey?: string | number;
  color?: string;
  payload?: Record<string, unknown>;
}

export function Logo({
  size = 36,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={ZEBRONICS_LOGO_SRC}
      alt="Zebronics"
      width={size}
      height={size}
      className={cn("bg-white object-contain", className)}
      style={{ width: size, height: "auto", maxHeight: size * 2.2 }}
    />
  );
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

export function SubCategoryFilterSelect({
  value,
  onChange,
  className,
  selectClassName,
  label = "Sub-category",
  includeAll = true,
}: {
  value: SubCategoryFilter;
  onChange: (value: SubCategoryFilter) => void;
  className?: string;
  selectClassName?: string;
  label?: string;
  includeAll?: boolean;
}) {
  const includeAllOption = includeAll ?? true;
  const options = includeAllOption ? SUB_CATEGORY_FILTER_OPTIONS : TRACKED_SUB_CATEGORIES;
  return (
    <div className={className}>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value as SubCategoryFilter)}
        className={cn("min-w-[220px] w-auto font-bold", selectClassName)}
        aria-label={label}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {SUB_CATEGORY_FILTER_LABELS[option]}
          </option>
        ))}
      </Select>
    </div>
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
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
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
    <div className="space-y-1.5">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
        {title}
      </h1>
      <p className="max-w-3xl text-sm font-medium leading-relaxed text-zinc-500 dark:text-zinc-400">
        {subtitle}
      </p>
    </div>
  );
}

export function InlineLoader({ text = "Loading..." }: { text?: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-base font-semibold text-zinc-700 dark:text-zinc-300">
      <LoaderCircle className="h-5 w-5 animate-spin text-violet-600" />
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
    label: "text-zinc-600 dark:text-zinc-400",
    value: "text-zinc-900 dark:text-zinc-100",
    hint: "text-zinc-600 dark:text-zinc-400",
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
          "text-xs font-bold uppercase tracking-[0.1em]",
          styles.label,
        )}
      >
        {label}
      </p>
      <p className={cn("mt-2 text-3xl font-extrabold tracking-tight tabular-nums", styles.value)}>
        {value}
      </p>
      {hint ? (
        <p className={cn("mt-2 text-sm font-semibold leading-snug", styles.hint)}>{hint}</p>
      ) : null}
    </div>
  );
}

const DATA_AS_ON_WRAP =
  "flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100";

/** Report period for displayed figures (not the upload clock). */
export function DataAsOnBadge({
  isoDate,
  className,
}: {
  isoDate: string;
  className?: string;
}) {
  return (
    <div className={cn(DATA_AS_ON_WRAP, className)}>
      <Clock className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden />
      <span>Figures through {formatCoverageDataAsOf(isoDate)}</span>
    </div>
  );
}

/** When products in view were refreshed on slightly different report dates. */
export function DataAsOnRangeBadge({
  min,
  max,
  scopeLabel,
}: {
  min: string | null;
  max: string | null;
  scopeLabel?: string;
}) {
  if (!min || !max) return null;
  if (min === max) return <DataAsOnBadge isoDate={min} />;
  return (
    <div className={DATA_AS_ON_WRAP}>
      <Clock className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden />
      <span className="leading-snug">
        {scopeLabel ? <span className="font-semibold text-zinc-600 dark:text-zinc-300">{scopeLabel} · </span> : null}
        {formatCoverageDataAsOf(min)} – {formatCoverageDataAsOf(max)}
      </span>
    </div>
  );
}

/** Latest saved report date per marketplace (uploads can differ by channel). */
export function DataAsOnDualChannelBadge({
  amazon,
  flipkart,
}: {
  amazon: string | null;
  flipkart: string | null;
}) {
  if (!amazon && !flipkart) return null;
  const parts: string[] = [];
  if (amazon) parts.push(`Amazon ${formatCoverageDataAsOf(amazon)}`);
  if (flipkart) parts.push(`Flipkart ${formatCoverageDataAsOf(flipkart)}`);
  return (
    <div className={DATA_AS_ON_WRAP}>
      <Clock className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden />
      <span className="leading-snug">{parts.join(" · ")}</span>
    </div>
  );
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
  labelPrefix,
  labelKey,
}: {
  active?: boolean;
  payload?: RechartsTooltipPayload[];
  label?: string | number;
  formatValue: (value: number | string | undefined) => string;
  labelPrefix?: string;
  labelKey?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rowPayload = payload[0]?.payload;
  const fromPayload =
    labelKey && rowPayload && rowPayload[labelKey] != null
      ? String(rowPayload[labelKey]).trim()
      : "";
  const resolvedLabel =
    fromPayload && fromPayload !== "—" ? fromPayload : fromPayload || label;
  return (
    <div className="min-w-[220px] rounded-xl border-2 border-zinc-200 bg-white px-4 py-3 text-sm shadow-lg dark:border-zinc-600 dark:bg-zinc-900">
      {resolvedLabel ? (
        <p className="mb-2 border-b border-zinc-100 pb-2 text-xs font-bold uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {labelPrefix ? `${labelPrefix}: ` : ""}
          {resolvedLabel}
        </p>
      ) : null}
      {payload.map((entry, index) => (
        <div
          key={`${entry.dataKey ?? entry.name ?? index}`}
          className="flex items-center gap-2.5 py-0.5"
        >
          {entry.color ? (
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-zinc-200 dark:ring-zinc-600"
              style={{ background: entry.color }}
            />
          ) : null}
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">{entry.name}</span>
          <span className="ml-auto text-base font-extrabold tabular-nums text-zinc-950 dark:text-zinc-50">
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
      <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      <p className="mt-3 text-base font-semibold leading-relaxed text-zinc-600 dark:text-zinc-400">
        {description}
      </p>
    </Card>
  );
}

