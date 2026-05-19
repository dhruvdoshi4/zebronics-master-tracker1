import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  findUnifiedProduct,
  searchUnifiedProducts,
  type UnifiedProductSuggestion,
} from "./data";
import { productIdHubPath, productWorkspacePath } from "./product-channel";
import {
  Button,
  Card,
  DataAsOnDualChannelBadge,
  EmptyState,
  FieldLabel,
  Input,
  PageTitle,
} from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

function openUnifiedProduct(
  navigate: ReturnType<typeof useNavigate>,
  row: UnifiedProductSuggestion,
) {
  if (row.erpProductId) {
    navigate(productIdHubPath(row.erpProductId));
    return;
  }
  if (row.asin) {
    navigate(productWorkspacePath("amazon", row.asin));
    return;
  }
  if (row.fsn) {
    navigate(productWorkspacePath("flipkart", row.fsn));
  }
}

export function AsinLookupPage() {
  const navigate = useNavigate();
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<UnifiedProductSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      void searchUnifiedProducts(trimmed)
        .then((rows) => {
          setSuggestions(rows);
          setSuggestionsOpen(rows.length > 0);
        })
        .catch(() => {
          setSuggestions([]);
          setSuggestionsOpen(false);
        });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setSuggestionsOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsLoading(true);
    setError(null);
    setSuggestionsOpen(false);
    void findUnifiedProduct(trimmed)
      .then((row) => {
        if (!row) {
          setError("No matching product found on Amazon or Flipkart.");
          return;
        }
        openUnifiedProduct(navigate, row);
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Product Lookup"
            subtitle="Search once by ASIN, FSN, product ID, or model — each product appears once, synced by Product ID."
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
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div ref={containerRef} className="relative">
            <FieldLabel>ASIN, FSN, product ID, or model name</FieldLabel>
            <Input
              placeholder="e.g. v19, B09GG4FT99, 47709"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSuggestionsOpen(true);
              }}
              onFocus={() => {
                if (suggestions.length > 0) setSuggestionsOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim() && !isLoading) {
                  e.preventDefault();
                  handleSearch();
                }
                if (e.key === "Escape") setSuggestionsOpen(false);
              }}
              autoComplete="off"
            />
            {suggestionsOpen && suggestions.length > 0 ? (
              <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
                {suggestions.map((row) => (
                  <li key={row.key}>
                    <button
                      type="button"
                      className="flex w-full flex-col gap-0.5 px-4 py-3 text-left transition hover:bg-violet-50"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setQuery(row.modelName);
                        setSuggestionsOpen(false);
                        openUnifiedProduct(navigate, row);
                      }}
                    >
                      <span className="text-sm font-semibold text-zinc-900">{row.modelName}</span>
                      {row.subtitle ? (
                        <span className="text-xs font-medium text-zinc-500">{row.subtitle}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Button
            type="button"
            disabled={isLoading || !query.trim()}
            onClick={handleSearch}
            className="h-[42px] shrink-0 md:self-end"
          >
            {isLoading ? "Searching..." : "Search"}
          </Button>
        </div>
      </Card>

      {error ? <EmptyState title="Lookup failed" description={error} /> : null}
    </div>
  );
}
