/**
 * CountUp — animated number that ticks from 0 → value with eased deceleration.
 * Handles currency + thousands separators. Used for earnings & view counters.
 */
import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { CLAMP } from "../theme";

export const CountUp: React.FC<{
  value: number;
  start?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  separator?: boolean;
  style?: React.CSSProperties;
}> = ({
  value,
  start = 0,
  duration = 50,
  prefix = "",
  suffix = "",
  decimals = 0,
  separator = true,
  style,
}) => {
  const frame = useCurrentFrame();
  const raw = interpolate(frame, [start, start + duration], [0, value], {
    ...CLAMP,
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  const fixed = raw.toFixed(decimals);
  const out = separator
    ? Number(fixed).toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : fixed;
  return (
    <span style={style}>
      {prefix}
      {out}
      {suffix}
    </span>
  );
};
