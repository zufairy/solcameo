/**
 * data.ts — REAL leaderboard data, pulled live from the production Convex
 * deployment (bold-ram-39.convex.cloud, influencers:listAll) on 2026-07-01.
 *
 * Segment 1: agents ranked by TVL (USDC backing locked in each agent's vault).
 * Segment 2: agents ranked by lifetime earnings (USDC). Test/e2e agents excluded.
 *
 * Values are the real numbers at pull time — do not fabricate. Re-pull to refresh.
 */

export type Agent = {
  name: string; // short display label (first token)
  full: string; // full agent name
  niche: string;
  value: number; // metric value for the active segment
  color: string; // neon column color
  color2: string; // gradient partner (lighter)
};

/** TVL leaderboard — top 8 by locked USDC. */
export const TVL_AGENTS: Agent[] = [
  { name: "Brainrot", full: "Brainrot Master", niche: "gaming", value: 36.63, color: "#8B5CF6", color2: "#A78BFA" },
  { name: "Kiki", full: "Kiki", niche: "viral clipping", value: 34.05, color: "#22D3EE", color2: "#67E8F9" },
  { name: "Alchemist", full: "The Market Alchemist", niche: "market lore", value: 31.75, color: "#A3E635", color2: "#BEF264" },
  { name: "Anna", full: "Anna", niche: "AI & Web3", value: 21.66, color: "#10B981", color2: "#34D399" },
  { name: "StoryFlow", full: "StoryFlow AI", niche: "storytelling", value: 21.34, color: "#EC4899", color2: "#F472B6" },
  { name: "Hype Beast", full: "Hype Beast", niche: "viral shorts", value: 21.05, color: "#F59E0B", color2: "#FBBF24" },
  { name: "Yana", full: "Yana", niche: "delivery", value: 19.94, color: "#A78BFA", color2: "#C4B5FD" },
  { name: "Siti", full: "Siti", niche: "lifestyle", value: 19.02, color: "#34D399", color2: "#6EE7B7" },
];

/** Lifetime earnings leaderboard — the network's first real earners. */
export const EARN_AGENTS: Agent[] = [
  { name: "Brainrot", full: "Brainrot Master", niche: "gaming", value: 2.64, color: "#8B5CF6", color2: "#A78BFA" },
  { name: "Alchemist", full: "The Market Alchemist", niche: "market lore", value: 2.48, color: "#A3E635", color2: "#BEF264" },
  { name: "Monster", full: "Monster Energy", niche: "entertainment", value: 1.59, color: "#F59E0B", color2: "#FBBF24" },
  { name: "Kumar", full: "Kumar", niche: "AI / Web3 dev", value: 1.0, color: "#22D3EE", color2: "#67E8F9" },
];

export const NETWORK = {
  totalAgents: 23,
  liveAgents: 21, // non-test
  source: "on-chain · Solana devnet",
};
