import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadProductIdMap, lookupErpProductId, resolveErpProductIdForListing } from "./product-id-map";
import { searchQcomProducts } from "./data-qcom";
import { marketplaceLabel } from "./marketplace-labels";
import { qcomSelloutPath } from "./qcom-paths";
import type { QcomMarketplace } from "./types";
import { productIdHubPath } from "./product-channel";
import {
  Button,
  Card,
  EmptyState,
  FieldLabel,
  Input,
  PageTitle,
} from "./ui";

type QcomSearchHit = {
  erpProductId: string | null;
  productCode: string;
  productName: string;
  category: string | null;
  marketplace: QcomMarketplace;
};

async function openQcomHit(hit: QcomSearchHit, navigate: ReturnType<typeof useNavigate>) {
  const map = await loadProductIdMap();
  let pid: string | null = hit.erpProductId;
  if (!pid && map && /^B0/i.test(hit.productCode)) {
    pid = lookupErpProductId(map, "amazon", hit.productCode);
  }
  if (!pid) {
    pid = await resolveErpProductIdForListing(hit.marketplace, hit.productCode);
  }
  if (pid) {
    navigate(productIdHubPath(pid));
    return;
  }
  navigate(qcomSelloutPath(hit.marketplace, hit.productCode));
}

export function QcomLookupPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<QcomSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchQcomProducts(trimmed)
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

  return (
    <div className="space-y-6">
      <PageTitle
        title="Product Lookup"
        subtitle="Search by ASIN, platform listing code, model name, or category. Names come from the Quick Commerce master upload."
      />

      <Card className="space-y-3">
        <div ref={ref}>
        <FieldLabel>Search</FieldLabel>
        <Input
          value={query}
          placeholder="ASIN, item code, model, or Audio…"
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => suggestions.length && setOpen(true)}
        />
        {open ? (
          <ul className="max-h-72 overflow-auto rounded-xl border border-zinc-200 bg-white shadow-lg">
            {suggestions.map((hit) => (
              <li key={`${hit.marketplace}:${hit.productCode}`}>
                <button
                  type="button"
                  className="block w-full px-4 py-3 text-left hover:bg-violet-50"
                  onClick={() => {
                    setOpen(false);
                    void openQcomHit(hit, navigate);
                  }}
                >
                  <p className="font-semibold text-zinc-900">{hit.productName}</p>
                  <p className="text-xs text-zinc-500">
                    {marketplaceLabel(hit.marketplace)} · {hit.productCode}
                    {hit.category ? ` · ${hit.category}` : ""}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Button
          type="button"
          disabled={query.trim().length < 2 || suggestions.length === 0}
          onClick={() => {
            const hit = suggestions[0];
            if (hit) void openQcomHit(hit, navigate);
          }}
        >
          Open first match
        </Button>
        </div>
      </Card>

      <EmptyState
        title="Tip"
        description="Upload the Quick Commerce master first. ASIN links to ERP Product ID via HO Stock when available."
      />
    </div>
  );
}
