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
  subCategory: string | null;
  channels: Record<QuickCommerceChannel, DashboardRecord | undefined>;
};

function normalizeSubCategoryLabel(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function pickBetterCategoryLabel(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  const a = normalizeQcomCategoryLabel(existing);
  const b = normalizeQcomCategoryLabel(incoming);
  if (!a) return b;
  if (!b) return a;
  if (a.toLowerCase() === "audio" && b.toLowerCase() !== "audio") return b;
  if (b.toLowerCase() === "audio" && a.toLowerCase() !== "audio") return a;
  return a.localeCompare(b, "en-IN", { sensitivity: "base" }) <= 0 ? a : b;
}

/** Consolidated tab Category column is authoritative per ASIN; else best label across channels. */
function resolveParallelRowCategory(
  builder: RowBuilder,
  consolidatedCategoryByAsin: Map<string, string>,
): string | null {
  const asin = cleanAsin(builder.canonicalCode);
  if (asin) {
    const fromConsolidated = consolidatedCategoryByAsin.get(asin);
    if (fromConsolidated) return fromConsolidated;
  }

  let best = normalizeQcomCategoryLabel(builder.category);
  for (const ch of QCOM_CHANNELS) {
    best = pickBetterCategoryLabel(
      best,
      builder.channels[ch]?.category ?? null,
    );
  }
  return best;
}

/** Consolidated tab Sub Category column is authoritative per ASIN. */
function resolveParallelRowSubCategory(
  builder: RowBuilder,
  consolidatedSubCategoryByAsin: Map<string, string>,
): string | null {
  const asin = cleanAsin(builder.canonicalCode);
  if (asin) {
    const fromConsolidated = consolidatedSubCategoryByAsin.get(asin);
    if (fromConsolidated) return fromConsolidated;
  }

  for (const ch of QCOM_CHANNELS) {
    const sub = normalizeSubCategoryLabel(builder.channels[ch]?.sub_category);
    if (sub) return sub;
  }
  return normalizeSubCategoryLabel(builder.subCategory);
}

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
      subCategory: row.sub_category?.trim() || null,
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

  builder.category = pickBetterCategoryLabel(
    builder.category,
    row.category?.trim() || null,
  );
  if (!builder.subCategory && row.sub_category?.trim()) {
    builder.subCategory = row.sub_category.trim();
  }
  if (asin) builder.canonicalCode = asin;

  const prev = builder.channels[channel];
  if (!prev || row.as_of_date >= prev.as_of_date) {
    builder.channels[channel] = row;
  }
}

/** One row per model (ASIN), metrics side-by-side for each quick-commerce channel. */
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

  const consolidatedCategoryByAsin = new Map<string, string>();
  const consolidatedSubCategoryByAsin = new Map<string, string>();
  for (const row of consolidatedRecords) {
    const asin = cleanAsin(row.product_code);
    const cat = normalizeQcomCategoryLabel(row.category);
    const sub = normalizeSubCategoryLabel(row.sub_category);
    if (asin && cat) consolidatedCategoryByAsin.set(asin, cat);
    if (asin && sub) consolidatedSubCategoryByAsin.set(asin, sub);
  }

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
      category: resolveParallelRowCategory(builder, consolidatedCategoryByAsin),
      subCategory: resolveParallelRowSubCategory(
        builder,
        consolidatedSubCategoryByAsin,
      ),
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
