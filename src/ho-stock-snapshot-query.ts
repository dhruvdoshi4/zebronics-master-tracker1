import { supabase } from "./supabase";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Unknown error";
}

const PAGE_SIZE = 1000;

/** Supabase returns at most 1000 rows per request — paginate for full HO stock snapshots. */
export async function fetchAllHoStockSnapshotRows<T extends string>(
  uploadId: string,
  columns: T,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("ho_stock_snapshot")
      .select(columns)
      .eq("upload_id", uploadId)
      .order("row_key", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(getErrorMessage(error));

    const batch = (data ?? []) as Record<string, unknown>[];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

/** Direct ASIN / FSN lookup when the in-memory map may be stale. */
export async function fetchHoStockRowByListingCode(
  uploadId: string,
  marketplace: "amazon" | "flipkart",
  productCode: string,
): Promise<{
  asin: string;
  fsn: string;
  erp_product_id: string;
  model_name: string;
  ho_units: number;
  gurgaon_units: number;
  total_units: number;
} | null> {
  const code = productCode.trim();
  if (!code) return null;

  const column = marketplace === "amazon" ? "asin" : "fsn";
  const filterValue = code.toUpperCase();
  const select =
    "asin, fsn, erp_product_id, model_name, ho_units, gurgaon_units, total_units";

  const { data, error } = await supabase
    .from("ho_stock_snapshot")
    .select(select)
    .eq("upload_id", uploadId)
    .eq(column, filterValue)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(getErrorMessage(error));
  if (data) {
    return data as {
      asin: string;
      fsn: string;
      erp_product_id: string;
      model_name: string;
      ho_units: number;
      gurgaon_units: number;
      total_units: number;
    };
  }

  if (marketplace === "flipkart") {
    const { data: ilikeRows, error: ilikeErr } = await supabase
      .from("ho_stock_snapshot")
      .select(select)
      .eq("upload_id", uploadId)
      .ilike("fsn", `%${filterValue}%`)
      .limit(5);
    if (ilikeErr) throw new Error(getErrorMessage(ilikeErr));
    for (const row of (ilikeRows ?? []) as Array<{
      fsn: string;
      asin: string;
      erp_product_id: string;
      model_name: string;
      ho_units: number;
      gurgaon_units: number;
      total_units: number;
    }>) {
      const parts = String(row.fsn ?? "")
        .split(/\s*\/\s*/)
        .map((part) => part.trim().toUpperCase());
      if (parts.includes(filterValue)) return row;
    }
  }

  return null;
}

export type HoStockUnits = {
  ho_units: number;
  gurgaon_units: number;
  total_units: number;
  snapshotDate: string | null;
  fileName: string | null;
};

async function getLatestHoStockUploadMeta(): Promise<{
  id: string;
  snapshot_date: string | null;
  file_name: string;
} | null> {
  const { data, error } = await supabase
    .from("uploads")
    .select("id, snapshot_date, file_name")
    .eq("upload_kind", "ho_stock")
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    const msg = getErrorMessage(error).toLowerCase();
    if (msg.includes("upload_kind") || msg.includes("ho_stock_snapshot")) return null;
    throw new Error(getErrorMessage(error));
  }
  return data as { id: string; snapshot_date: string | null; file_name: string } | null;
}

function normalizeProductId(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) return String(Math.trunc(asNumber));
  return value;
}

/** HO + Gurgaon warehouse stock from the latest uploaded HO stock report. */
export async function fetchHoStockUnits(opts: {
  erpProductId?: string | null;
  marketplace?: "amazon" | "flipkart";
  productCode?: string;
}): Promise<HoStockUnits | null> {
  const upload = await getLatestHoStockUploadMeta();
  if (!upload) return null;

  type StockRow = {
    ho_units: number;
    gurgaon_units: number;
    total_units: number;
  };

  let row: StockRow | null = null;

  const pid = opts.erpProductId ? normalizeProductId(opts.erpProductId) : "";
  if (pid) {
    const { data, error } = await supabase
      .from("ho_stock_snapshot")
      .select("ho_units, gurgaon_units, total_units")
      .eq("upload_id", upload.id)
      .eq("erp_product_id", pid)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(getErrorMessage(error));
    row = (data as StockRow | null) ?? null;
  }

  if (!row && opts.marketplace && opts.productCode?.trim()) {
    const listingRow = await fetchHoStockRowByListingCode(
      upload.id,
      opts.marketplace,
      opts.productCode,
    );
    if (listingRow) {
      row = {
        ho_units: listingRow.ho_units,
        gurgaon_units: listingRow.gurgaon_units,
        total_units: listingRow.total_units,
      };
    }
  }

  if (!row) return null;

  return {
    ho_units: Number(row.ho_units ?? 0),
    gurgaon_units: Number(row.gurgaon_units ?? 0),
    total_units: Number(row.total_units ?? 0),
    snapshotDate: upload.snapshot_date,
    fileName: upload.file_name,
  };
}
