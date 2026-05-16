/** GMS (Gross Merchandise Sales) = BAU × SO ÷ 1.18 (GST-excluded). */
export const GMS_GST_DIVISOR = 1.18;

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

/** Compare target vs actual MTD GMS; suggest extra units at BAU if behind. */
export function buildGmsGapSuggestion(
  targetGms: number,
  actualGms: number,
  bauPrice: number,
): GmsGapSuggestion {
  const gapGms = targetGms - actualGms;
  const bau = Math.max(0, bauPrice);
  const gapUnits =
    bau > 0 ? Math.ceil((Math.abs(gapGms) * GMS_GST_DIVISOR) / bau) : 0;
  let message: string;
  if (targetGms <= 0 && actualGms <= 0) {
    message = "Set a target on the GMS plan sheet to track gap.";
  } else if (gapGms > 0) {
    message = `Behind target by ${gapUnits.toLocaleString("en-IN")} units (≈ at current BAU).`;
  } else if (gapGms < 0) {
    message = `Ahead of target by ${gapUnits.toLocaleString("en-IN")} units equivalent.`;
  } else {
    message = "On target for the month.";
  }
  return { gapGms, gapUnits, message };
}
