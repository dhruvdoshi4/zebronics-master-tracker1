/** GMS (Gross Merchandise Sales) = BAU × SO ÷ 1.18 (GST-excluded). */
export const GMS_GST_DIVISOR = 1.18;

/** Flipkart pricing split: 18 calendar days at BAU, 12 at event SP (not day-of-week). */
export const FLIPKART_BAU_PRICING_DAYS = 18;
export const FLIPKART_EVENT_PRICING_DAYS = 12;
export const FLIPKART_PRICING_MONTH_DAYS =
  FLIPKART_BAU_PRICING_DAYS + FLIPKART_EVENT_PRICING_DAYS;

/** Weighted selling price per unit for Flipkart (18×BAU + 12×event) ÷ 30. */
export function flipkartBlendedSellingPrice(bauPrice: number, eventSp: number): number {
  const bau = Math.max(0, Number(bauPrice) || 0);
  const event = Math.max(0, Number(eventSp) || 0);
  const eventEffective = event > 0 ? event : bau;
  if (bau <= 0 && eventEffective <= 0) return 0;
  return (
    (FLIPKART_BAU_PRICING_DAYS * bau + FLIPKART_EVENT_PRICING_DAYS * eventEffective) /
    FLIPKART_PRICING_MONTH_DAYS
  );
}

/** Completed month: sellout units × blended price ÷ 1.18. */
export function gmsFromFlipkartSellout(
  bauPrice: number,
  eventSp: number,
  selloutUnits: number,
): number {
  const units = Math.max(0, Number(selloutUnits) || 0);
  if (units <= 0) return 0;
  const blended = flipkartBlendedSellingPrice(bauPrice, eventSp);
  if (blended <= 0) return 0;
  return (blended * units) / GMS_GST_DIVISOR;
}

/** MTD snapshot: DRR × blended price ÷ 1.18. */
export function gmsFromFlipkartDrr(bauPrice: number, eventSp: number, drrUnits: number): number {
  const drr = Math.max(0, Number(drrUnits) || 0);
  if (drr <= 0) return 0;
  const blended = flipkartBlendedSellingPrice(bauPrice, eventSp);
  if (blended <= 0) return 0;
  return (blended * drr) / GMS_GST_DIVISOR;
}

export function gmsFromBauAndSo(bauPrice: number, selloutUnits: number): number {
  const bau = Math.max(0, Number(bauPrice) || 0);
  const so = Math.max(0, Number(selloutUnits) || 0);
  if (bau <= 0 || so <= 0) return 0;
  return (bau * so) / GMS_GST_DIVISOR;
}

export function effectiveBauPrice(
  override: number | null | undefined,
  benchmark: number | null | undefined,
): number {
  const o = Number(override);
  if (Number.isFinite(o) && o > 0) return o;
  const b = Number(benchmark);
  if (Number.isFinite(b) && b > 0) return b;
  return 0;
}

export type GmsGapSuggestion = {
  gapGms: number;
  gapUnits: number;
  message: string;
};

/** Compare planned vs actual MTD GMS; suggest extra units at BAU if behind. */
export function buildGmsGapSuggestion(
  plannedGms: number,
  actualGms: number,
  bauPrice: number,
): GmsGapSuggestion {
  const gapGms = plannedGms - actualGms;
  const bau = Math.max(0, bauPrice);
  const gapUnits =
    bau > 0 ? Math.ceil((Math.abs(gapGms) * GMS_GST_DIVISOR) / bau) : 0;
  let message: string;
  if (plannedGms <= 0 && actualGms <= 0) {
    message = "Set planned GMS on the GMS plan sheet to track gap.";
  } else if (gapGms > 0) {
    message = `Behind plan by ${gapUnits.toLocaleString("en-IN")} units (≈ at current BAU).`;
  } else if (gapGms < 0) {
    message = `Ahead of plan by ${gapUnits.toLocaleString("en-IN")} units equivalent.`;
  } else {
    message = "On plan for the month.";
  }
  return { gapGms, gapUnits, message };
}
