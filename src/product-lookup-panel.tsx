import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  findUnifiedProduct,
  searchUnifiedProducts,
  type UnifiedProductSuggestion,
} from "./data";
import {
  navigateFromUnifiedProductLookup,
  type ProductLookupDestination,
} from "./product-lookup-nav";
import { useCatalogScope } from "./catalog-scope-context";
import { Button, FieldLabel, Input } from "./ui";

export type ProductLookupPanelProps = {
  destination: ProductLookupDestination;
  routePrefix: string;
  fieldLabel?: string;
  placeholder?: string;
  searchButtonLabel?: string;
  searchingButtonLabel?: string;
};

/**
 * Unified product search (ASIN / FSN / Product ID / model) — one row per ERP-linked model.
 * Use on Product Lookup, Sellout & growth entry, and GMS product search.
 */
export function ProductLookupPanel({
  destination,
  routePrefix,
  fieldLabel = "ASIN, FSN, product ID, or model name",
  placeholder = "e.g. v19, B09GG4FT99, 47709",
  searchButtonLabel = "Search",
  searchingButtonLabel = "Searching...",
}: ProductLookupPanelProps) {
  const navigate = useNavigate();
  const { workspace: catalogWorkspace } = useCatalogScope();
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
  }, [query, catalogWorkspace]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setSuggestionsOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function openRow(row: UnifiedProductSuggestion) {
    setError(null);
    void navigateFromUnifiedProductLookup(
      navigate,
      row,
      destination,
      routePrefix,
      catalogWorkspace,
      query.trim(),
    ).then((result) => {
      if (!result.ok) setError(result.message);
    });
  }

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
        openRow(row);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to fetch product details.");
      })
      .finally(() => setIsLoading(false));
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isLoading && query.trim()) handleSearch();
      }}
    >
      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div ref={containerRef} className="relative">
          <FieldLabel>{fieldLabel}</FieldLabel>
          <Input
            placeholder={placeholder}
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
                      openRow(row);
                    }}
                  >
                    <span className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-900">
                      {row.modelName}
                    </span>
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
          type="submit"
          disabled={isLoading || !query.trim()}
          className="h-[42px] shrink-0 md:self-end"
        >
          {isLoading ? searchingButtonLabel : searchButtonLabel}
        </Button>
      </div>
      {error ? (
        <p className="text-sm font-semibold text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
