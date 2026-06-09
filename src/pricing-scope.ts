import type { CatalogWorkspace } from "./catalog-workspace";
import {
  DEFAULT_NET_REAL_FACTOR,
  type PricingNetAdjustments,
  normalizeNetRealFactor,
  normalizeMarginFraction,
  roundPricingInr,
} from "./pricing";
import type { LegacyMarketplace } from "./types";

export type PricingScopeLevel = "workspace" | "category" | "sub_category";

export type PricingScopeDefaultRecord = {
  catalog_workspace: string;
  marketplace: LegacyMarketplace | "all";
  scope_level: PricingScopeLevel;
  scope_key: string;
  net_real_factor: number | null;
  coupon_value: number | null;
  coupon_support_pct: number | null;
  updated_at: string;
};

export type PricingSkuOverrideFields = {
  net_real_factor: number | null;
  coupon_value: number | null;
  coupon_support_pct: number | null;
};

export type ResolvedPricingScope = PricingNetAdjustments & {
  net_real_factor_source: PricingScopeLevel | "sku" | "default";
  coupon_value_source: PricingScopeLevel | "sku" | "default";
  coupon_support_pct_source: PricingScopeLevel | "sku" | "default";
};

type ScopeProduct = {
  category?: string | null;
  sub_category?: string | null;
};

function scopeRowKey(
  marketplace: LegacyMarketplace | "all",
  level: PricingScopeLevel,
  scopeKey: string,
): string {
  return `${marketplace}|${level}|${scopeKey}`;
}

export function indexPricingScopeDefaults(
  rows: PricingScopeDefaultRecord[],
): Map<string, PricingScopeDefaultRecord> {
  const map = new Map<string, PricingScopeDefaultRecord>();
  for (const row of rows) {
    map.set(
      scopeRowKey(row.marketplace, row.scope_level, row.scope_key),
      row,
    );
  }
  return map;
}

function pickScopedValue(
  sku: number | null | undefined,
  levels: Array<{
    level: PricingScopeLevel | "sku" | "default";
    value: number | null | undefined;
  }>,
  fallback: number,
): { value: number; source: PricingScopeLevel | "sku" | "default" } {
  if (sku != null && Number.isFinite(sku)) {
    return { value: sku, source: "sku" };
  }
  for (const entry of levels) {
    if (entry.value != null && Number.isFinite(entry.value)) {
      return { value: entry.value, source: entry.level };
    }
  }
  return { value: fallback, source: "default" };
}

export function resolvePricingScopeForProduct(
  product: ScopeProduct,
  marketplace: LegacyMarketplace,
  skuOverrides: PricingSkuOverrideFields | null | undefined,
  defaultsByKey: Map<string, PricingScopeDefaultRecord>,
  catalogWorkspace: CatalogWorkspace,
): ResolvedPricingScope {
  const category = (product.category ?? "").trim();
  const subCategory = (product.sub_category ?? "").trim();

  function scopeValue(
    field: "net_real_factor" | "coupon_support_pct",
  ): Array<{ level: PricingScopeLevel; value: number | null | undefined }> {
    const channels: Array<LegacyMarketplace | "all"> = [marketplace, "all"];
    const out: Array<{ level: PricingScopeLevel; value: number | null | undefined }> = [];
    for (const channel of channels) {
      if (subCategory) {
        const sub = defaultsByKey.get(
          scopeRowKey(channel, "sub_category", subCategory),
        );
        if (sub) out.push({ level: "sub_category", value: sub[field] });
      }
      if (category) {
        const cat = defaultsByKey.get(scopeRowKey(channel, "category", category));
        if (cat) out.push({ level: "category", value: cat[field] });
      }
      const ws = defaultsByKey.get(
        scopeRowKey(channel, "workspace", catalogWorkspace),
      );
      if (ws) out.push({ level: "workspace", value: ws[field] });
    }
    return out;
  }

  const netPick = pickScopedValue(
    skuOverrides?.net_real_factor,
    scopeValue("net_real_factor"),
    DEFAULT_NET_REAL_FACTOR,
  );
  /** Coupon face value is per-SKU only — not inherited from scope defaults. */
  const couponPick = pickScopedValue(skuOverrides?.coupon_value, [], 0);
  const supportPick = pickScopedValue(
    skuOverrides?.coupon_support_pct,
    scopeValue("coupon_support_pct"),
    0,
  );

  return {
    net_real_factor: normalizeNetRealFactor(netPick.value),
    coupon_value: roundPricingInr(couponPick.value),
    coupon_support_pct: normalizeMarginFraction(supportPick.value),
    net_real_factor_source: netPick.source,
    coupon_value_source: couponPick.source,
    coupon_support_pct_source: supportPick.source,
  };
}
