import { getDashboardRecords } from "./data";
import { normalizeQcomCategoryLabel } from "./parsers-qcom";
import type { DashboardRecord } from "./types";
import { QCOM_HO_STOCK_CATALOG_MARKETPLACE } from "./types";
import { QCOM_CHANNELS, type QuickCommerceChannel } from "./tenants";
import { displayModelName } from "./product-display";

export type QcomChannelMetricsSlice = {
  totalSo: number;
  mtd: number;
  drr: number;
  doc: number;
  listingCode: string | null;
};

export type QcomParallelModelRow = {
  canonicalCode: string;
  modelName: string;
  category: string | null;
  subCategory: string | null;
  channels: Record<QuickCommerceChannel, QcomChannelMetricsSlice | null>;
  /** Channels with any metric present (for badges). */
  listedOnCount: number;
  /** Sum of MTD across listed channels — default sort. */
  totalMtdAcrossChannels: number;
};

function cleanAsin(code: string): string | null {
  const v = code.trim().toUpperCase();
  return /^B0[A-Z0-9]{8,}$/i.test(v) ? v : null;
}

function sliceFromRecord(row: DashboardRecord | undefined): QcomChannelMetricsSlice | null {
  if (!row) return null;
  return {
    totalSo: row.total_so_units,
    mtd: row.may_mtd_units,
    drr: row.drr_units,
    doc: row.doc_days,
    listingCode: row.listing_code?.trim() || null,
  };
}

function normalizeSubCategoryLabel(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function indexChannelRecordsByAsin(
  records: DashboardRecord[],
): Map<string, DashboardRecord> {
  const byAsin = new Map<string, DashboardRecord>();
  for (const row of records) {
    const asin = cleanAsin(row.product_code);
    if (asin) {
      byAsin.set(asin, row);
      continue;
    }
    byAsin.set(row.product_code, row);
  }
  return byAsin;
}

/** One row per Consolidated catalogue SKU (427), channel metrics side-by-side where listed. */
export async function getQcomParallelDashboardRows(): Promise<QcomParallelModelRow[]> {
  const [byChannel, consolidatedRecords] = await Promise.all([
    Promise.all(
      QCOM_CHANNELS.map(async (channel) => ({
        channel,
        records: await getDashboardRecords(channel),
      })),
    ),
    getDashboardRecords(QCOM_HO_STOCK_CATALOG_MARKETPLACE),
  ]);

  const channelByAsin = new Map<QuickCommerceChannel, Map<string, DashboardRecord>>();
  for (const ch of QCOM_CHANNELS) {
    channelByAsin.set(ch, new Map());
  }
  for (const { channel, records } of byChannel) {
    channelByAsin.set(channel, indexChannelRecordsByAsin(records));
  }

  const out: QcomParallelModelRow[] = [];

  for (const consolidated of consolidatedRecords) {
    const asin = cleanAsin(consolidated.product_code);
    const canonicalCode = asin ?? consolidated.product_code;
    const modelName = displayModelName(consolidated.product_name, consolidated.product_code);

    const channels = {} as Record<QuickCommerceChannel, QcomChannelMetricsSlice | null>;
    let listedOnCount = 0;
    let totalMtdAcrossChannels = 0;

    for (const ch of QCOM_CHANNELS) {
      const chMap = channelByAsin.get(ch)!;
      const row = asin ? chMap.get(asin) : chMap.get(consolidated.product_code);
      const slice = sliceFromRecord(row);
      channels[ch] = slice;
      if (slice) {
        listedOnCount += 1;
        totalMtdAcrossChannels += slice.mtd;
      }
    }

    out.push({
      canonicalCode,
      modelName: modelName === "—" ? consolidated.product_name || canonicalCode : modelName,
      category: normalizeQcomCategoryLabel(consolidated.category),
      subCategory: normalizeSubCategoryLabel(consolidated.sub_category),
      channels,
      listedOnCount,
      totalMtdAcrossChannels,
    });
  }

  out.sort((a, b) => {
    const mtd = b.totalMtdAcrossChannels - a.totalMtdAcrossChannels;
    if (mtd !== 0) return mtd;
    return a.modelName.localeCompare(b.modelName);
  });

  return out;
}
