import { getDashboardRecords } from "./data";
import type { DashboardRecord } from "./types";
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
  const hasData =
    row.total_so_units > 0 ||
    row.may_mtd_units > 0 ||
    row.drr_units > 0 ||
    row.doc_days > 0;
  if (!hasData) return null;
  return {
    totalSo: row.total_so_units,
    mtd: row.may_mtd_units,
    drr: row.drr_units,
    doc: row.doc_days,
    listingCode: row.listing_code?.trim() || null,
  };
}

type RowBuilder = {
  canonicalCode: string;
  modelName: string;
  category: string | null;
  channels: Record<QuickCommerceChannel, DashboardRecord | undefined>;
};

function rowKeyForRecord(
  channel: QuickCommerceChannel,
  row: DashboardRecord,
): string {
  const asin = cleanAsin(row.product_code);
  if (asin) return `asin:${asin}`;
  const model = displayModelName(row.product_name, row.product_code);
  const norm = model.toLowerCase().replace(/\s+/g, " ");
  if (norm && norm !== "—") return `model:${norm}`;
  return `solo:${channel}:${row.product_code}`;
}

function mergeRecord(
  builders: Map<string, RowBuilder>,
  channel: QuickCommerceChannel,
  row: DashboardRecord,
) {
  const key = rowKeyForRecord(channel, row);
  const asin = cleanAsin(row.product_code);
  const modelName = displayModelName(row.product_name, row.product_code);

  let builder = builders.get(key);
  if (!builder && asin) {
    builder = builders.get(`asin:${asin}`);
  }

  if (!builder) {
    builder = {
      canonicalCode: asin ?? row.product_code,
      modelName: modelName === "—" ? row.product_name || row.product_code : modelName,
      category: row.category?.trim() || null,
      channels: {
        zepto: undefined,
        blinkit: undefined,
        instamart: undefined,
        bigbasket: undefined,
      },
    };
    builders.set(key, builder);
    if (asin) {
      for (const [k, b] of builders) {
        if (k !== key && k.startsWith("model:") && cleanAsin(b.canonicalCode) === asin) {
          builders.delete(k);
        }
      }
    }
  }

  if (!builder.category && row.category?.trim()) {
    builder.category = row.category.trim();
  }
  if (asin) builder.canonicalCode = asin;

  const prev = builder.channels[channel];
  if (!prev || row.as_of_date >= prev.as_of_date) {
    builder.channels[channel] = row;
  }
}

/** One row per model (ASIN), metrics side-by-side for each quick-commerce channel. */
export async function getQcomParallelDashboardRows(): Promise<QcomParallelModelRow[]> {
  const byChannel = await Promise.all(
    QCOM_CHANNELS.map(async (channel) => ({
      channel,
      records: await getDashboardRecords(channel),
    })),
  );

  const builders = new Map<string, RowBuilder>();

  for (const { channel, records } of byChannel) {
    for (const row of records) {
      mergeRecord(builders, channel, row);
    }
  }

  const out: QcomParallelModelRow[] = [];

  for (const builder of builders.values()) {
    const channels = {} as Record<QuickCommerceChannel, QcomChannelMetricsSlice | null>;
    let listedOnCount = 0;
    let totalMtdAcrossChannels = 0;

    for (const ch of QCOM_CHANNELS) {
      const slice = sliceFromRecord(builder.channels[ch]);
      channels[ch] = slice;
      if (slice) {
        listedOnCount += 1;
        totalMtdAcrossChannels += slice.mtd;
      }
    }

    if (listedOnCount === 0) continue;

    out.push({
      canonicalCode: builder.canonicalCode,
      modelName: builder.modelName,
      category: builder.category,
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
