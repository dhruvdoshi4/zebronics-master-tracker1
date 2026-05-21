import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Activity, Box, ClipboardList } from "lucide-react";
import { findUnifiedQcomByCanonicalCode, type UnifiedQcomProductSuggestion } from "./data-qcom";
import { qcomLookupPath, qcomProductWorkspacePath } from "./qcom-paths";
import { QCOM_CHANNEL_LABELS, QCOM_WORKSPACE_LABELS, type QcomWorkspaceKey } from "./tenants";
import { Card, EmptyState, InlineLoader, PageTitle } from "./ui";

export function QcomProductHubPage() {
  const { code } = useParams<{ code: string }>();
  const canonicalCode = decodeURIComponent(code ?? "").trim();
  const [product, setProduct] = useState<UnifiedQcomProductSuggestion | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canonicalCode) {
      setProduct(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void findUnifiedQcomByCanonicalCode(canonicalCode)
      .then(setProduct)
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [canonicalCode]);

  if (loading) return <InlineLoader text="Loading model workspace…" />;
  if (!product) {
    return (
      <EmptyState
        title="Model not found"
        description={
          canonicalCode
            ? `No Quick Commerce listing for "${canonicalCode}". Upload the master with Consolidated ASIN links, or search again.`
            : "Search from Product Lookup to open a model."
        }
      />
    );
  }

  const poPath = qcomProductWorkspacePath(
    product.canonicalProductCode,
    "po",
    product.defaultWorkspace,
  );
  const selloutPath = qcomProductWorkspacePath(
    product.canonicalProductCode,
    "sellout-growth",
    product.defaultWorkspace,
  );

  return (
    <div className="space-y-6">
      <PageTitle
        title="Model Workspace"
        subtitle="Choose PO metrics or Sellout & Growth — switch Consolidated network totals or each channel inside each report."
      />

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {product.asin ? (
            <span className="rounded-full bg-violet-100 px-3 py-1 font-mono text-xs font-semibold text-violet-700">
              ASIN {product.asin}
            </span>
          ) : (
            <span className="rounded-full bg-zinc-100 px-3 py-1 font-mono text-xs font-semibold text-zinc-700">
              {product.canonicalProductCode}
            </span>
          )}
          {product.erpProductId ? (
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700">
              Product ID {product.erpProductId}
            </span>
          ) : null}
          {product.category ? (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-800">
              {product.category}
            </span>
          ) : null}
        </div>
        <h2 className="text-lg font-bold text-zinc-900">{product.modelName}</h2>
        {product.subtitle ? (
          <p className="text-sm font-medium text-zinc-600">{product.subtitle}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {product.workspaces.map((ws) => (
            <WorkspaceBadge key={ws} workspace={ws} />
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          to={poPath}
          className="rounded-2xl border border-amber-300 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm transition hover:shadow-md"
        >
          <ClipboardList className="h-6 w-6 text-amber-700" />
          <h3 className="mt-3 text-xl font-bold tracking-tight">PO</h3>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            Inventory, DOC, DRR, and suggested purchase order from the latest channel upload.
          </p>
        </Link>

        <Link
          to={selloutPath}
          className="rounded-2xl border border-violet-300 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm transition hover:shadow-md"
        >
          <Activity className="h-6 w-6 text-violet-700" />
          <h3 className="mt-3 text-xl font-bold tracking-tight">Sellout &amp; Growth</h3>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            FY trend, MoM bars, and MTD sellout — switch quick-commerce channels inside.
          </p>
        </Link>
      </div>

      <Link
        to={qcomLookupPath()}
        className="inline-flex items-center gap-2 text-base font-semibold text-violet-700 hover:underline"
      >
        <Box className="h-4 w-4" />
        Search another model
      </Link>
    </div>
  );
}

function WorkspaceBadge({ workspace }: { workspace: QcomWorkspaceKey }) {
  const styles: Record<QcomWorkspaceKey, string> = {
    consolidated: "border-indigo-200 bg-indigo-50 text-indigo-900",
    zepto: "border-violet-200 bg-violet-50 text-violet-800",
    blinkit: "border-amber-200 bg-amber-50 text-amber-900",
    bigbasket: "border-emerald-200 bg-emerald-50 text-emerald-900",
    instamart: "border-sky-200 bg-sky-50 text-sky-900",
  };
  const label =
    workspace === "consolidated"
      ? QCOM_WORKSPACE_LABELS.consolidated
      : QCOM_CHANNEL_LABELS[workspace];
  return (
    <span
      className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${styles[workspace]}`}
    >
      {label}
    </span>
  );
}
