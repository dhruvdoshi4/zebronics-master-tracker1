import { marketplaceLabel } from "./marketplace-labels";
import type { QcomChannelUnits } from "./qcom-category-sellout-insights";
import type { QcomMarketplace } from "./types";
import { QCOM_MARKETPLACES } from "./types";
import { formatInteger } from "./utils";

export function formatQcomChannelUnitsLine(
  units: QcomChannelUnits,
  channelsActive: Record<QcomMarketplace, boolean>,
): string | undefined {
  const parts = QCOM_MARKETPLACES.filter((ch) => channelsActive[ch]).map(
    (ch) => `${formatInteger(units[ch] ?? 0)} ${marketplaceLabel(ch)}`,
  );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
