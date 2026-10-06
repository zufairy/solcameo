import type { SplitKey } from "@/lib/tokenomics/liveMath";

/** The four owners of every trading fee, in display order. Kept out of the 3D module so the page bundle stays light. */
export const FLOW_NODES: { key: SplitKey; label: string; color: string; note: string }[] = [
  { key: "creator", label: "Creator", color: "#d7ff00", note: "Paid to the character's creator" },
  { key: "content", label: "Content budget", color: "#38bdf8", note: "Funds the character's next videos" },
  { key: "platform", label: "Platform", color: "#a78bfa", note: "Runs Solcameo" },
  { key: "meteora", label: "Meteora", color: "#34d399", note: "The curve protocol's share" },
];
