import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Warehouse } from "lucide-react";
import { productWorkspacePath } from "./product-channel";
import type { Marketplace } from "./types";
import { Card, PageTitle } from "./ui";

export function HoStockPage() {
  const params = useParams<{ marketplace: string; code: string }>();
  const marketplace = (params.marketplace as Marketplace) ?? "amazon";
  const productCode = params.code ?? "";
  return (
    <div className="space-y-6">
      <Link
        to={productWorkspacePath(marketplace, productCode)}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Model Workspace
      </Link>
      <PageTitle
        title="HO Stock"
        subtitle="Central stock planning and warehouse coverage insights."
      />
      <Card className="flex items-center gap-3">
        <Warehouse className="h-5 w-5 text-sky-600 dark:text-sky-300" />
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Reserved for HO stock logic.
        </p>
      </Card>
    </div>
  );
}
