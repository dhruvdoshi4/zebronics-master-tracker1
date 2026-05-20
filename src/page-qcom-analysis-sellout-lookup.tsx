import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { findQcomProductWithMetrics, searchQcomSelloutSuggestions } from "./data-qcom";
import { marketplaceLabel } from "./marketplace-labels";
import { qcomSelloutPath } from "./qcom-paths";
import type { QcomMarketplace } from "./types";
import { QCOM_MARKETPLACES } from "./types";
import {
  Button,
  Card,
  EmptyState,
  FieldLabel,
  Input,
  PageTitle,
  Select,
} from "./ui";

export function QcomAnalysisSelloutLookupPage() {
  const navigate = useNavigate();
  const [marketplace, setMarketplace] = useState<QcomMarketplace>("zepto");
  const [code, setCode] = useState("");
  const [suggestions, setSuggestions] = useState<
    Array<{ productCode: string; productName: string }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputListId = `qcom-analysis-sellout-suggestions-${marketplace}`;

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
      void searchQcomSelloutSuggestions(marketplace, query)
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
    void findQcomProductWithMetrics(marketplace, trimmed)
      .then((data) => {
        if (!data) {
          setError(
            "No matching product on this channel. Try the ASIN, channel listing code (Item ID / PVID), or the full model name from the master sheet.",
          );
          return;
        }
        navigate(
          `${qcomSelloutPath(marketplace, data.product.product_code)}?from=analysis`,
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
        to="/app/qcom/analysis"
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Data analysis
      </Link>

      <PageTitle
        title="Sellout & growth analysis"
        subtitle="Search by ASIN, listing code, or model name — same FY and MoM charts as marketplace sellout."
      />

      <Card className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[200px_1fr_auto] md:items-end">
          <div>
            <FieldLabel>Channel</FieldLabel>
            <Select
              value={marketplace}
              onChange={(event) => setMarketplace(event.target.value as QcomMarketplace)}
            >
              {QCOM_MARKETPLACES.map((ch) => (
                <option key={ch} value={ch}>
                  {marketplaceLabel(ch)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel>ASIN, listing code, or model</FieldLabel>
            <Input
              placeholder="Type ASIN, channel SKU, or model name"
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
