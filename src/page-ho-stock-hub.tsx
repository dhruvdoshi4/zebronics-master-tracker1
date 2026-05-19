import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Layers, Search, Warehouse } from "lucide-react";
import { searchHoStockProducts, type HoStockSearchRow } from "./data-ho-stock";
import { productIdHubPath } from "./product-channel";
import { Card, EmptyState, FieldLabel, Input, PageTitle } from "./ui";
import { useHoStockUploadMeta } from "./use-ho-stock-upload";
import { formatInteger } from "./utils";

function listingCodes(row: HoStockSearchRow): string {
  const parts: string[] = [];
  if (row.asin) parts.push(`ASIN ${row.asin}`);
  if (row.fsn) parts.push(`FSN ${row.fsn}`);
  return parts.join(" · ") || "—";
}

export function HoStockHubPage() {
  const meta = useHoStockUploadMeta();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HoStockSearchRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const hasUpload = Boolean(meta.snapshotDate);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || !hasUpload) {
      setResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      void searchHoStockProducts(trimmed)
        .then(setResults)
        .catch((e: unknown) => {
          setResults([]);
          setSearchError(e instanceof Error ? e.message : "Search failed.");
        })
        .finally(() => setIsSearching(false));
    }, 220);

    return () => window.clearTimeout(timer);
  }, [query, hasUpload]);

  const showResults = query.trim().length >= 2 && hasUpload;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <PageTitle
          title="HO Stock"
          subtitle="Consolidated head-office inventory — matched to your Amazon ASINs and Flipkart FSNs by category."
        />
        {meta.snapshotDate ? (
          <div className="rounded-xl border border-sky-200 bg-sky-50/90 px-4 py-2 text-sm font-medium text-sky-950">
            <p className="text-[10px] font-bold uppercase tracking-wide text-sky-700">Stock as on</p>
            <p>{meta.label}</p>
            {meta.fileName ? (
              <p className="mt-0.5 truncate text-xs font-normal text-sky-800/80">{meta.fileName}</p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-2 text-sm text-amber-950">
            No HO stock report uploaded yet. Upload from{" "}
            <Link to="/app/upload" className="font-semibold underline">
              Upload Center
            </Link>
            .
          </div>
        )}
      </div>

      <Card className="flex items-start gap-3 text-sm text-zinc-700">
        <Warehouse className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
        <p>
          Use the consolidated workbook sheet <strong>Consolidated HO Stock Report</strong> (ASIN, FSN,
          ERP model name, HO, Gurgaon, Total). Only rows whose ASIN or FSN exist in Product Master for
          the selected category are shown.
        </p>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-start gap-3">
          <Search className="mt-1 h-5 w-5 shrink-0 text-sky-600" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <FieldLabel>Search product</FieldLabel>
              <Input
                type="search"
                placeholder={
                  hasUpload
                    ? "Model name, ASIN, FSN, or Product ID…"
                    : "Upload HO stock report to enable search"
                }
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={!hasUpload}
              />
              <p className="mt-1.5 text-xs font-medium text-zinc-500">
                Search the full stock report — not limited to a single category.
              </p>
            </div>
          </div>
        </div>

        {showResults ? (
          <div className="space-y-3 border-t border-zinc-100 pt-4">
            <p className="text-sm font-semibold text-zinc-800">
              {isSearching
                ? "Searching…"
                : searchError
                  ? "Search error"
                  : `${results.length} result${results.length === 1 ? "" : "s"}`}
            </p>
            {searchError ? (
              <EmptyState title="Search failed" description={searchError} />
            ) : !isSearching && results.length === 0 ? (
              <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500">
                No products match &ldquo;{query.trim()}&rdquo; in the latest HO stock report.
              </p>
            ) : results.length > 0 ? (
              <div className="overflow-auto rounded-xl border border-zinc-200">
                <table className="min-w-full divide-y divide-zinc-200 text-sm">
                  <thead className="bg-zinc-50 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-3 py-2.5">Model</th>
                      <th className="px-3 py-2.5">Product ID</th>
                      <th className="px-3 py-2.5">Listing</th>
                      <th className="px-3 py-2.5 text-right">HO</th>
                      <th className="px-3 py-2.5 text-right">Gurgaon</th>
                      <th className="px-3 py-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {results.map((row) => {
                      const rowKey = row.erp_product_id || `${row.asin}:${row.fsn}:${row.model_name}`;
                      const modelCell =
                        row.erp_product_id ? (
                          <Link
                            to={productIdHubPath(row.erp_product_id)}
                            className="font-medium text-violet-700 hover:underline"
                          >
                            {row.model_name}
                          </Link>
                        ) : (
                          <span className="font-medium text-zinc-900">{row.model_name}</span>
                        );
                      return (
                        <tr key={rowKey} className="hover:bg-sky-50/40">
                          <td className="max-w-xs px-3 py-2.5">{modelCell}</td>
                          <td className="px-3 py-2.5 font-mono text-xs text-zinc-600">
                            {row.erp_product_id || "—"}
                          </td>
                          <td className="max-w-[10rem] px-3 py-2.5 text-xs font-medium text-zinc-600">
                            {listingCodes(row)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {formatInteger(row.ho_units)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {formatInteger(row.gurgaon_units)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-zinc-900">
                            {formatInteger(row.total_units)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Link
        to="/app/ho-stock/category"
        className="block rounded-2xl border-2 border-sky-300 bg-gradient-to-br from-sky-50 to-white p-6 shadow-sm transition hover:shadow-md"
      >
        <Layers className="h-8 w-8 text-sky-700" />
        <h2 className="mt-4 text-xl font-bold text-zinc-900">Category wise</h2>
        <p className="mt-2 text-sm font-medium text-zinc-600">
          Monitors, projectors, arms, screens, stands, cartridges — HO + Gurgaon + total per listing.
        </p>
        <p className="mt-4 text-sm font-bold text-sky-700">Choose category →</p>
      </Link>
    </div>
  );
}
