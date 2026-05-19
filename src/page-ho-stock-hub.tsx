import { Link } from "react-router-dom";
import { Layers, Warehouse } from "lucide-react";
import { Card, PageTitle } from "./ui";
import { useHoStockUploadMeta } from "./use-ho-stock-upload";

export function HoStockHubPage() {
  const meta = useHoStockUploadMeta();

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
