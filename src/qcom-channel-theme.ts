import type { QuickCommerceChannel } from "./tenants";

/** Table / UI tints — keeps channel blocks visually distinct without heavy borders. */
export const QCOM_CHANNEL_TABLE_THEME: Record<
  QuickCommerceChannel,
  {
    label: string;
    header: string;
    subHeader: string;
    cell: string;
    cellMuted: string;
    empty: string;
  }
> = {
  zepto: {
    label: "Zepto",
    header: "bg-violet-100/90 text-violet-950 border-violet-200",
    subHeader: "bg-violet-50/90 text-violet-800 border-violet-100",
    cell: "bg-violet-50/40 text-zinc-900 border-violet-100/80",
    cellMuted: "text-zinc-300",
    empty: "bg-violet-50/25 text-zinc-400 border-violet-100/60",
  },
  blinkit: {
    label: "Blinkit",
    header: "bg-amber-100/90 text-amber-950 border-amber-200",
    subHeader: "bg-amber-50/90 text-amber-900 border-amber-100",
    cell: "bg-amber-50/40 text-zinc-900 border-amber-100/80",
    cellMuted: "text-zinc-300",
    empty: "bg-amber-50/25 text-zinc-400 border-amber-100/60",
  },
  instamart: {
    label: "Instamart",
    header: "bg-sky-100/90 text-sky-950 border-sky-200",
    subHeader: "bg-sky-50/90 text-sky-900 border-sky-100",
    cell: "bg-sky-50/40 text-zinc-900 border-sky-100/80",
    cellMuted: "text-zinc-300",
    empty: "bg-sky-50/25 text-zinc-400 border-sky-100/60",
  },
  bigbasket: {
    label: "Big Basket",
    header: "bg-emerald-100/90 text-emerald-950 border-emerald-200",
    subHeader: "bg-emerald-50/90 text-emerald-900 border-emerald-100",
    cell: "bg-emerald-50/40 text-zinc-900 border-emerald-100/80",
    cellMuted: "text-zinc-300",
    empty: "bg-emerald-50/25 text-zinc-400 border-emerald-100/60",
  },
};

export const QCOM_COMPARISON_CHANNEL_ORDER: readonly QuickCommerceChannel[] = [
  "zepto",
  "blinkit",
  "instamart",
  "bigbasket",
] as const;
