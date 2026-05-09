import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { findProductWithMetrics, searchProductSuggestions } from "./data";
import type { Marketplace } from "./types";
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageTitle,
  Select,
} from "./ui";

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

export function AsinLookupPage() {
  const navigate = useNavigate();
  const [marketplace, setMarketplace] = useState<Marketplace>("amazon");
  const [code, setCode] = useState("");
  const [suggestions, setSuggestions] = useState<
    Array<{ productCode: string; productName: string }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeLabel = getCodeLabel(marketplace);
  const inputListId = `lookup-suggestions-${marketplace}`;

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
          `/app/product/${marketplace}/${encodeURIComponent(data.product.product_code)}`,
        );
      })
      .catch((e: unknown) => {
        setError(
          e instanceof Error ? e.message : "Failed to fetch product details.",
        );
      })
      .finally(() => setIsLoading(false));
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title={`${codeLabel} Lookup`}
        subtitle={`Search by ${codeLabel}, model name, or partial text — then open the model workspace.`}
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
          <Button
            type="button"
            disabled={isLoading || !code.trim()}
            onClick={handleSearch}
          >
            {isLoading ? "Searching..." : "Search"}
          </Button>
        </div>
      </Card>

      {error ? <EmptyState title="Lookup failed" description={error} /> : null}
    </div>
  );
}
