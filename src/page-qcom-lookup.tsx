import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  findUnifiedQcomProduct,
  searchUnifiedQcomProducts,
  type UnifiedQcomProductSuggestion,
} from "./data-qcom";
import { qcomSelloutPath } from "./qcom-paths";
import {
  Button,
  Card,
  EmptyState,
  FieldLabel,
  Input,
  PageTitle,
} from "./ui";

function openUnifiedQcomProduct(
  navigate: ReturnType<typeof useNavigate>,
  row: UnifiedQcomProductSuggestion,
) {
  navigate(
    qcomSelloutPath(row.defaultMarketplace, row.canonicalProductCode),
  );
}

export function QcomLookupPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<UnifiedQcomProductSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchUnifiedQcomProducts(trimmed)
        .then((rows) => {
          setSuggestions(rows);
          setOpen(rows.length > 0);
        })
        .catch(() => setSuggestions([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsLoading(true);
    setError(null);
    setOpen(false);
    void findUnifiedQcomProduct(trimmed)
      .then((row) => {
        if (!row) {
          setError("No matching product found on Quick Commerce channels.");
          return;
        }
        openUnifiedQcomProduct(navigate, row);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Lookup failed.");
      })
      .finally(() => setIsLoading(false));
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Product Lookup"
        subtitle="Search once by ASIN, listing code, or model — each product appears once, linked by ASIN across Zepto, Blinkit, Instamart, and BigBasket."
      />

      <Card className="space-y-3">
        <div ref={ref}>
          <FieldLabel>ASIN, listing code, or model name</FieldLabel>
          <Input
            value={query}
            placeholder="e.g. v19, B09GG4FT99, item code…"
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => suggestions.length && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim() && !isLoading) {
                e.preventDefault();
                handleSearch();
              }
              if (e.key === "Escape") setOpen(false);
            }}
            autoComplete="off"
          />
          {open && suggestions.length > 0 ? (
            <ul className="mt-1 max-h-72 overflow-auto rounded-xl border border-zinc-200 bg-white shadow-lg">
              {suggestions.map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    className="block w-full px-4 py-3 text-left hover:bg-violet-50"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setOpen(false);
                      openUnifiedQcomProduct(navigate, row);
                    }}
                  >
                    <p className="font-semibold text-zinc-900">{row.modelName}</p>
                    {row.subtitle ? (
                      <p className="text-xs text-zinc-500">{row.subtitle}</p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            type="button"
            className="mt-3"
            disabled={isLoading || query.trim().length < 2}
            onClick={handleSearch}
          >
            {isLoading ? "Opening…" : "Open product"}
          </Button>
        </div>
      </Card>

      {error ? <EmptyState title="Lookup failed" description={error} /> : null}

      <EmptyState
        title="Tip"
        description="Upload the Quick Commerce master with a filled Consolidated tab so listing codes map to one ASIN. Re-upload if you still see duplicate Zepto rows for the same model."
      />
    </div>
  );
}
