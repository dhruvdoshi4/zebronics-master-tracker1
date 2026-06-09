import { GMS_GST_DIVISOR } from "./gms";
import type { LegacyMarketplace } from "./types";

/** GST divisor for Basic SP (same as GMS). */
export const PRICING_GST_DIVISOR = GMS_GST_DIVISOR;

export const BASE_IBD_MIN_EVENT_SP = 5000;
export const BASE_IBD_RATE = 0.1;
export const BASE_IBD_CAP_INR = 1250;
export const DEFAULT_NET_REAL_FACTOR = 0.95;

/** @deprecated Use per-scope net_real_factor; kept as fallback only. */
export const NET_REALISATION_BASIC_FACTOR = DEFAULT_NET_REAL_FACTOR;

export type ProductPricingInputs = {
  bau_sp: number;
  bau_margin_pct: number;
  event_sp: number;
  event_margin_pct: number;
  is_flat_price: boolean;
  top_up_ibd: number;
};

/** Resolved net-real inputs (SKU override → sub-category → category → workspace → default). */
export type PricingNetAdjustments = {
  net_real_factor: number;
  coupon_value: number;
  coupon_support_pct: number;
};

export type ProductPricingComputed = {
  /** BAU Basic = Basic SP (per channel). */
  basic_sp: number;
  event_basic: number;
  basic_support_pu: number;
  base_ibd: number;
  top_up_ibd_support: number;
  nep: number;
  net_realisation: number;
  /** Effective values used in net-real (after scope cascade). */
  net_real_factor: number;
  coupon_value: number;
  coupon_support_pct: number;
  coupon_deduction: number;
};

export type ProductPricingRow = ProductPricingInputs & ProductPricingComputed;

/**
 * Margin from sheet: decimal fraction (0.185) or whole percent (18.5).
 * Values > 1 are treated as percent points and divided by 100.
 */
export function normalizeMarginFraction(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1) return Math.min(n / 100, 1);
  return Math.min(n, 1);
}

export function roundPricingInr(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * Flat-price SKUs only: Event SP / margin default to BAU when event columns are blank.
 * MF_HA has no event columns — non-flat SKUs keep event blank until Jan ART or manual entry.
 */
export function normalizePricingInputs(inputs: ProductPricingInputs): ProductPricingInputs {
  if (!inputs.is_flat_price || inputs.bau_sp <= 0) return inputs;
  return {
    ...inputs,
    event_sp: inputs.event_sp > 0 ? inputs.event_sp : inputs.bau_sp,
    event_margin_pct:
      inputs.event_margin_pct > 0 ? inputs.event_margin_pct : inputs.bau_margin_pct,
  };
}

/** Net-real factor: 0.95 or whole percent 95 → 0.95. */
export function normalizeNetRealFactor(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_NET_REAL_FACTOR;
  if (n > 1) return Math.min(n / 100, 1);
  return Math.min(n, 1);
}

export function computeCouponDeduction(
  couponValue: number,
  couponSupportFraction: number,
): number {
  const value = Math.max(0, Number(couponValue) || 0);
  const support = normalizeMarginFraction(couponSupportFraction);
  return roundPricingInr(value * support);
}

/** Basic SP = (BAU SP × (1 − margin)) ÷ 1.18 */
export function computeBasicSp(bauSp: number, marginFraction: number): number {
  const bau = Math.max(0, Number(bauSp) || 0);
  const margin = normalizeMarginFraction(marginFraction);
  if (bau <= 0) return 0;
  return roundPricingInr((bau * (1 - margin)) / PRICING_GST_DIVISOR);
}

/** Event basic = (Event SP × (1 − event margin)) ÷ 1.18 */
export function computeEventBasic(eventSp: number, eventMarginFraction: number): number {
  const event = Math.max(0, Number(eventSp) || 0);
  const margin = normalizeMarginFraction(eventMarginFraction);
  if (event <= 0) return 0;
  return roundPricingInr((event * (1 - margin)) / PRICING_GST_DIVISOR);
}

/** Basic Support PU = MAX(Basic SP − Event basic, 0); flat price → 0. */
export function computeBasicSupportPu(
  basicSp: number,
  eventSp: number,
  eventMarginFraction: number,
  isFlatPrice: boolean,
): number {
  if (isFlatPrice) return 0;
  if (Math.max(0, Number(eventSp) || 0) <= 0) return 0;
  const basic = Math.max(0, Number(basicSp) || 0);
  const eventBasic = computeEventBasic(eventSp, eventMarginFraction);
  return roundPricingInr(Math.max(basic - eventBasic, 0));
}

/** Base IBD = IF(Event SP < 5000, 0, MIN(Event SP × 10%, 1250)). */
export function computeBaseIbd(eventSp: number): number {
  const event = Math.max(0, Number(eventSp) || 0);
  if (event < BASE_IBD_MIN_EVENT_SP) return 0;
  return roundPricingInr(Math.min(event * BASE_IBD_RATE, BASE_IBD_CAP_INR));
}

export function computeTopUpIbdSupport(topUpIbd: number): number {
  return roundPricingInr(Math.max(0, Number(topUpIbd) || 0));
}

/** NEP = Event SP − Base IBD − Top up IBD. */
export function computeNep(eventSp: number, baseIbd: number, topUpIbd: number): number {
  const event = Math.max(0, Number(eventSp) || 0);
  return roundPricingInr(event - baseIbd - topUpIbd);
}

/** Amazon: (Basic SP × factor) − Basic Support − Top up − coupon deduction. */
export function computeNetRealisationAmazon(
  basicSp: number,
  basicSupportPu: number,
  topUpIbdSupport: number,
  adjustments: PricingNetAdjustments = {
    net_real_factor: DEFAULT_NET_REAL_FACTOR,
    coupon_value: 0,
    coupon_support_pct: 0,
  },
): number {
  const basic = Math.max(0, Number(basicSp) || 0);
  const factor = normalizeNetRealFactor(adjustments.net_real_factor);
  const coupon = computeCouponDeduction(
    adjustments.coupon_value,
    adjustments.coupon_support_pct,
  );
  return roundPricingInr(
    basic * factor - basicSupportPu - topUpIbdSupport - coupon,
  );
}

/** Flipkart: (Basic SP × factor) − Basic Support − coupon (no Top up term). */
export function computeNetRealisationFlipkart(
  basicSp: number,
  basicSupportPu: number,
  adjustments: PricingNetAdjustments = {
    net_real_factor: DEFAULT_NET_REAL_FACTOR,
    coupon_value: 0,
    coupon_support_pct: 0,
  },
): number {
  const basic = Math.max(0, Number(basicSp) || 0);
  const factor = normalizeNetRealFactor(adjustments.net_real_factor);
  const coupon = computeCouponDeduction(
    adjustments.coupon_value,
    adjustments.coupon_support_pct,
  );
  return roundPricingInr(basic * factor - basicSupportPu - coupon);
}

export function computeNetRealisation(
  marketplace: LegacyMarketplace,
  basicSp: number,
  basicSupportPu: number,
  topUpIbdSupport: number,
  adjustments?: PricingNetAdjustments,
): number {
  if (marketplace === "amazon") {
    return computeNetRealisationAmazon(basicSp, basicSupportPu, topUpIbdSupport, adjustments);
  }
  return computeNetRealisationFlipkart(basicSp, basicSupportPu, adjustments);
}

export function computeProductPricingChannel(
  marketplace: LegacyMarketplace,
  inputs: ProductPricingInputs,
  adjustments?: PricingNetAdjustments,
): ProductPricingRow {
  const normalized = normalizePricingInputs(inputs);
  const basic_sp = computeBasicSp(normalized.bau_sp, normalized.bau_margin_pct);
  const event_basic = computeEventBasic(normalized.event_sp, normalized.event_margin_pct);
  const basic_support_pu = computeBasicSupportPu(
    basic_sp,
    normalized.event_sp,
    normalized.event_margin_pct,
    normalized.is_flat_price,
  );
  const base_ibd = computeBaseIbd(normalized.event_sp);
  const top_up_ibd_support = computeTopUpIbdSupport(normalized.top_up_ibd);
  const nep = computeNep(normalized.event_sp, base_ibd, normalized.top_up_ibd);
  const resolvedAdjustments: PricingNetAdjustments = adjustments ?? {
    net_real_factor: DEFAULT_NET_REAL_FACTOR,
    coupon_value: 0,
    coupon_support_pct: 0,
  };
  const net_realisation = computeNetRealisation(
    marketplace,
    basic_sp,
    basic_support_pu,
    top_up_ibd_support,
    resolvedAdjustments,
  );

  return {
    ...normalized,
    basic_sp,
    event_basic,
    basic_support_pu,
    base_ibd,
    top_up_ibd_support,
    nep,
    net_realisation,
    coupon_deduction: computeCouponDeduction(
      resolvedAdjustments.coupon_value,
      resolvedAdjustments.coupon_support_pct,
    ),
  };
}

/** Display margin as percent string (18.5%). */
export function formatMarginPercent(marginFraction: number): string {
  const pct = normalizeMarginFraction(marginFraction) * 100;
  if (pct <= 0) return "—";
  const rounded = Math.round(pct * 100) / 100;
  return `${rounded}%`;
}

export function parseMarginPercentInput(raw: string): number {
  const cleaned = String(raw ?? "").replace(/%/g, "").trim();
  if (!cleaned) return 0;
  return normalizeMarginFraction(Number(cleaned));
}
