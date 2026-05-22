import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useCatalogScope } from "./catalog-scope-context";
import { findProductWithMetrics, searchProductSuggestions } from "./data";
import { productWorkspacePath } from "./product-channel";
import type { Marketplace } from "./types";
import {
  Button,
  Card,
  DataAsOnDualChannelBadge,
  EmptyState,
  FieldLabel,
  Input,
  PageTitle,
  Select,
} from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

export function AnalysisSelloutLookupPage() {
  const navigate = useNavigate();
  const { routePrefix } = useCatalogScope();
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const [marketplace, setMarketplace] = useState<Marketplace>("amazon");
  const [code, setCode] = useState("");
  const [suggestions, setSuggestions] = useState<
    Array<{ productCode: string; productName: string }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeLabel = getCodeLabel(marketplace);
  const inputListId = `analysis-sellout-suggestions-${marketplace}`;

  useEffect(() => {
    setCode("");
    setSuggestions([]);
    setError(null);
  }, [marketplace]);

  useEffect(() => {
    const query = code.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchProductSuggestions(marketplace, query)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [marketplace, code]);

  function handleSearch() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setIsLoading(true);
    setError(null);
    void findProductWithMetrics(marketplace, trimmed)
      .then((data) => {
        if (!data) {
          setError("No matching product found.");
          return;
        }
        navigate(
          `${productWorkspacePath(marketplace, data.product.product_code, "sellout-growth", routePrefix)}?from=analysis`,
        );
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to fetch product details.");
      })
      .finally(() => setIsLoading(false));
  }

  return (
    <div className="space-y-6">
      <Link
        to="/app/analysis"
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Data analysis
      </Link>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Sellout & growth analysis"
            subtitle={`Search by ${codeLabel} or model name — opens sellout charts directly.`}
          />
        </div>
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      <Card className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[200px_1fr_auto] md:items-end">
          <div>
            <FieldLabel>Marketplace</FieldLabel>
            <Select
              value={marketplace}
              onChange={(event) => setMarketplace(event.target.value as Marketplace)}
            >
              <option value="amazon">Amazon</option>
              <option value="flipkart">Flipkart</option>
            </Select>
          </div>
          <div>
            <FieldLabel>{codeLabel} or model name</FieldLabel>
            <Input
              placeholder={`Type ${codeLabel} or model name`}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.trim() && !isLoading) {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              list={inputListId}
            />
            <datalist id={inputListId}>
              {suggestions.map((item) => (
                <option
                  key={`${item.productCode}-${item.productName}`}
                  value={item.productName}
                  label={`${item.productName} (${item.productCode})`}
                />
              ))}
              {suggestions.map((item) => (
                <option
                  key={`${item.productCode}-code`}
                  value={item.productCode}
                  label={`${item.productCode} — ${item.productName}`}
                />
              ))}
            </datalist>
          </div>
          <Button
            type="button"
            disabled={isLoading || !code.trim()}
            onClick={handleSearch}
            className="h-[42px] shrink-0"
          >
            {isLoading ? "Opening…" : "Open Sellout"}
          </Button>
        </div>
      </Card>

      {error ? <EmptyState title="Lookup failed" description={error} /> : null}
    </div>
  );
}
