/* Ultra-light, precise line icons (stroke 1.2) for the Vello landing page.
   currentColor + non-scaling stroke so they stay hairline-thin at any size. */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

/** Autonomous agent — a spark / four-point star. */
export const IconAgent = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3c.4 4.6 1.4 5.6 6 6-4.6.4-5.6 1.4-6 6-.4-4.6-1.4-5.6-6-6 4.6-.4 5.6-1.4 6-6Z" /></svg>
);

/** Per-client learning — an orbiting loop. */
export const IconLearn = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3.2" /><path d="M12 3.5c4.7 0 8.5 3.8 8.5 8.5M12 20.5c-4.7 0-8.5-3.8-8.5-8.5" /><path d="M20.4 12 19 10.3 17.4 12M3.6 12 5 13.7 6.6 12" /></svg>
);

/** Investor-funded — a coin / token. */
export const IconFund = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9M14.4 9.3c-.6-.7-1.5-1-2.4-1-1.4 0-2.4.8-2.4 1.9 0 2.6 5 1.3 5 3.9 0 1.1-1.1 1.9-2.6 1.9-1 0-2-.4-2.6-1.1" /></svg>
);

/** On-chain reputation — a verified seal. */
export const IconReputation = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 2.8 14.2 5l3-.2.6 2.9 2.6 1.6-1.3 2.7 1.3 2.7-2.6 1.6-.6 2.9-3-.2L12 21.2 9.8 19l-3 .2-.6-2.9L3.6 14.7 4.9 12 3.6 9.3 6.2 7.7l.6-2.9 3 .2L12 2.8Z" /><path d="m9 12 2.2 2.2L15 10.4" /></svg>
);

/** AI Influencers — play / broadcast. */
export const IconInfluencer = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10.5 9.2 4 2.8-4 2.8V9.2Z" /></svg>
);

/** AI Workers — conversation. */
export const IconWorker = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v6A2.5 2.5 0 0 1 17.5 15H9l-4 3.5V15H6.5" /><path d="M8.5 8.2h7M8.5 11h4" /></svg>
);

/** AI Traders — chart line. */
export const IconTrader = (p: IconProps) => (
  <svg {...base(p)}><path d="M3.5 20.5h17" /><path d="m4.5 15 4-4 3 2.6L20 6" /><path d="M20 10V6h-4" /></svg>
);

/** Builder / SDK — stacked blocks. */
export const IconBuilder = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3 4.5 7.2 12 11.4l7.5-4.2L12 3Z" /><path d="m4.5 12 7.5 4.2L19.5 12M4.5 16.8 12 21l7.5-4.2" /></svg>
);

/** Trailing CTA arrow — diagonal up-right. */
export const IconArrowUpRight = (p: IconProps) => (
  <svg {...base(p)}><path d="M7 17 17 7M9 7h8v8" /></svg>
);

export const IconArrowRight = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 12h15M13 6l6 6-6 6" /></svg>
);
