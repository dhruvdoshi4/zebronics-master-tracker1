import { useState } from "react";
import { ImageIcon, Sparkles } from "lucide-react";
import { findProductWithMetrics } from "./data";
import type { Marketplace } from "./types";
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageTitle,
  Select,
} from "./ui";
import { formatDecimal, formatInteger } from "./utils";

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

export function AsinLookupPage() {
  const [marketplace, setMarketplace] = useState<Marketplace>("amazon");
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    productName: string;
    productCode: string;
    imageUrl: string | null;
    subCategory: string | null;
    inventory: number;
    totalSo: number;
    mayMtd: number;
    aprSo: number;
    drr: number;
    doc: number;
    po: number;
    targetStock: number;
  } | null>(null);

  const codeLabel = getCodeLabel(marketplace);

  return (
    <div className="space-y-6">
      <PageTitle
        title={`${codeLabel} Lookup`}
        subtitle={`Get instant inventory, sell-out and PO recommendation by ${codeLabel}.`}
      />

      <Card className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
          <Select
            value={marketplace}
            onChange={(event) =>
              setMarketplace(event.target.value as Marketplace)
            }
          >
            <option value="amazon">Amazon</option>
            <option value="flipkart">Flipkart</option>
          </Select>
          <Input
            placeholder={`Enter ${codeLabel}`}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button
            disabled={isLoading || !code.trim()}
            onClick={() => {
              setIsLoading(true);
              setError(null);
              setResult(null);
              void findProductWithMetrics(marketplace, code.trim())
                .then((data) => {
                  if (!data) {
                    setError("No matching product found.");
                    return;
                  }
                  const drr = data.metric?.drr_units ?? 0;
                  const inv = data.metric?.inventory_units ?? 0;
                  const po =
                    data.metric?.purchase_order_units ?? Math.max(0, drr * 45 - inv);
                  setResult({
                    productName: data.product.product_name,
                    productCode: data.product.product_code,
                    imageUrl: data.product.image_url,
                    subCategory: data.product.sub_category,
                    inventory: inv,
                    totalSo: data.metric?.total_so_units ?? 0,
                    mayMtd: data.metric?.may_mtd_units ?? 0,
                    aprSo: data.metric?.apr_so_units ?? 0,
                    drr,
                    doc: data.metric?.doc_days ?? 0,
                    po,
                    targetStock: Number((drr * 45).toFixed(2)),
                  });
                })
                .catch((e: unknown) => {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Failed to fetch product details.",
                  );
                })
                .finally(() => setIsLoading(false));
            }}
          >
            {isLoading ? "Searching..." : "Search"}
          </Button>
        </div>
      </Card>

      {error ? <EmptyState title="Lookup failed" description={error} /> : null}

      {result ? (
        <>
          <Card className="grid gap-5 md:grid-cols-[180px_1fr]">
            <div className="flex h-44 w-44 items-center justify-center overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-50 to-zinc-100 text-zinc-400 dark:border-zinc-700 dark:from-zinc-900 dark:to-zinc-950">
              {result.imageUrl ? (
                <img
                  src={result.imageUrl}
                  alt={result.productName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-1 text-xs text-zinc-400">
                  <ImageIcon className="h-6 w-6" />
                  No Image
                </div>
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                  {codeLabel}
                </span>
                <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
                  {result.productCode}
                </span>
                {result.subCategory ? (
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                    {result.subCategory}
                  </span>
                ) : null}
              </div>
              <h3 className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                {result.productName}
              </h3>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <Metric
                  label="Inventory"
                  value={formatInteger(result.inventory)}
                  accent="sky"
                />
                <Metric
                  label="Total SO"
                  value={formatInteger(result.totalSo)}
                  accent="emerald"
                />
                <Metric
                  label="DOC"
                  value={`${formatDecimal(result.doc)} days`}
                  accent="violet"
                />
                <Metric
                  label="May MTD"
                  value={formatInteger(result.mayMtd)}
                />
                <Metric label="Apr SO" value={formatInteger(result.aprSo)} />
                <Metric
                  label="DRR"
                  value={formatDecimal(result.drr)}
                  hint="units / day"
                />
              </div>
            </div>
          </Card>

          <Card className="border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:border-amber-800/70 dark:from-amber-950/40 dark:via-zinc-900 dark:to-orange-950/30">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-300" />
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Purchase Order Recommendation
                  </p>
                </div>
                <p className="mt-2 text-5xl font-bold text-amber-700 dark:text-amber-200">
                  {formatInteger(result.po)}
                  <span className="ml-1 text-base font-medium text-amber-600 dark:text-amber-300">
                    units
                  </span>
                </p>
                <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-200/80">
                  Target stock = {formatInteger(result.targetStock)} units (DRR x
                  45)
                </p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-white/70 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-zinc-900/40 dark:text-amber-100">
                <p>
                  <span className="font-semibold">Formula:</span> max(0, DRR x
                  45 - Inventory)
                </p>
                <p className="mt-1 font-mono text-[11px]">
                  max(0, {formatDecimal(result.drr)} x 45 -{" "}
                  {formatInteger(result.inventory)}) ={" "}
                  {formatInteger(result.po)}
                </p>
              </div>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

const ACCENT: Record<string, string> = {
  default: "border-zinc-200 dark:border-zinc-800",
  violet:
    "border-violet-200 bg-violet-50/60 text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-200",
  emerald:
    "border-emerald-200 bg-emerald-50/60 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200",
  sky: "border-sky-200 bg-sky-50/60 text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200",
};

function Metric({
  label,
  value,
  hint,
  accent = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "default" | "violet" | "emerald" | "sky";
}) {
  return (
    <div
      className={`rounded-xl border p-3 dark:border-zinc-800 ${ACCENT[accent]}`}
    >
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {hint ? <p className="text-[11px] opacity-70">{hint}</p> : null}
    </div>
  );
}
