import type { CSSProperties } from "react";

/** Recharts axis tick — darker, slightly larger for readability. */
export const CHART_AXIS_TICK = { fill: "#3f3f46", fontSize: 13 } as const;

export const CHART_GRID_STROKE = "rgba(63,63,70,0.18)";

/** Legend text below charts (Recharts wrapperStyle). */
export const CHART_LEGEND_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#3f3f46",
};
