/** GMS (Gross Merchandise Sales) = BAU × sellout ÷ 1.18 (GST-excluded). */
export const GMS_GST_DIVISOR = 1.18;

/** Flipkart: Mon–Thu at BAU SP, Fri–Sun at Event SP (per ops BAU sheet). */
export const FLIPKART_WEEKDAY_BAU_DAYS = 4;
export const FLIPKART_WEEKEND_EVENT_DAYS = 3;
export const FLIPKART_WEEK_DAYS = 7;

/** @deprecated Use calendar weekday split — kept for tests referencing 18:12 label only. */
export const FLIPKART_BAU_PRICING_DAYS = 18;
export const FLIPKART_EVENT_PRICING_DAYS = 12;
export const FLIPKART_PRICING_MONTH_DAYS = 30;

export type FlipkartWeekdayDayCounts = {
  monThuDays: number;
  friSunDays: number;
};

/** Count Mon–Thu vs Fri–Sun days from month start through `asOfDate` (inclusive). */
export function flipkartWeekdayDayCountsThrough(asOfDate: string): FlipkartWeekdayDayCounts {
  const iso = String(asOfDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { monThuDays: 0, friSunDays: 0 };
  }
  const monthStart = `${iso.slice(0, 7)}-01`;
  let monThuDays = 0;
  let friSunDays = 0;
  const cursor = new Date(`${monthStart}T12:00:00.000Z`);
  const end = new Date(`${iso}T12:00:00.000Z`);
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    if (dow >= 1 && dow <= 4) monThuDays += 1;
    else friSunDays += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { monThuDays, friSunDays };
}

/** All days in a calendar month (for completed-month sellout roll-ups). */
export function flipkartWeekdayDayCountsForMonthYm(monthYm: string): FlipkartWeekdayDayCounts {
  const ym = monthYm.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    return { monThuDays: 0, friSunDays: 0 };
  }
  const [year, month] = ym.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return flipkartWeekdayDayCountsThrough(`${ym}-${String(lastDay).padStart(2, "0")}`);
}

function flipkartEffectiveEventSp(bauPrice: number, eventSp: number): number {
  const bau = Math.max(0, Number(bauPrice) || 0);
  const event = Math.max(0, Number(eventSp) || 0);
  return event > 0 ? event : bau;
}

/**
 * Flipkart daily GMS rate from 7-day DRR (fallback when May MTD SO is blank):
 *   (4×BAU + 3×Event) × DRR ÷ (7 × 1.18)
 */
export function gmsFromFlipkartDrr(
  bauPrice: number,
  eventSp: number,
  drrUnits: number,
  _asOfDate?: string | null,
): number {
  const drr = Math.max(0, Number(drrUnits) || 0);
  if (drr <= 0) return 0;
  const bau = Math.max(0, Number(bauPrice) || 0);
  const eventEffective = flipkartEffectiveEventSp(bau, eventSp);
  if (bau <= 0 && eventEffective <= 0) return 0;
  return (
    (FLIPKART_WEEKDAY_BAU_DAYS * bau * drr + FLIPKART_WEEKEND_EVENT_DAYS * eventEffective * drr) /
    (FLIPKART_WEEK_DAYS * GMS_GST_DIVISOR)
  );
}

/** Completed month: sellout units × weekday-weighted SP ÷ 1.18. */
export function gmsFromFlipkartSellout(
  bauPrice: number,
  eventSp: number,
  selloutUnits: number,
  monthYmOrAsOf?: string | null,
): number {
  const units = Math.max(0, Number(selloutUnits) || 0);
  if (units <= 0) return 0;
  const bau = Math.max(0, Number(bauPrice) || 0);
  const eventEffective = flipkartEffectiveEventSp(bau, eventSp);
  if (bau <= 0 && eventEffective <= 0) return 0;

  const ref = String(monthYmOrAsOf ?? "").trim();
  const counts =
    ref.length >= 10
      ? flipkartWeekdayDayCountsThrough(ref.slice(0, 10))
      : ref.length >= 7
        ? flipkartWeekdayDayCountsForMonthYm(ref.slice(0, 7))
        : null;

  if (counts && counts.monThuDays + counts.friSunDays > 0) {
    const totalDays = counts.monThuDays + counts.friSunDays;
    return (
      (units * (counts.monThuDays * bau + counts.friSunDays * eventEffective)) /
      (totalDays * GMS_GST_DIVISOR)
    );
  }

  const blended =
    (FLIPKART_WEEKDAY_BAU_DAYS * bau + FLIPKART_WEEKEND_EVENT_DAYS * eventEffective) /
    FLIPKART_WEEK_DAYS;
  return (blended * units) / GMS_GST_DIVISOR;
}

/** Weighted selling price per unit (4×BAU + 3×Event) ÷ 7 — display / docs only. */
export function flipkartBlendedSellingPrice(bauPrice: number, eventSp: number): number {
  const bau = Math.max(0, Number(bauPrice) || 0);
  const eventEffective = flipkartEffectiveEventSp(bau, eventSp);
  if (bau <= 0 && eventEffective <= 0) return 0;
  return (
    (FLIPKART_WEEKDAY_BAU_DAYS * bau + FLIPKART_WEEKEND_EVENT_DAYS * eventEffective) /
    FLIPKART_WEEK_DAYS
  );
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
