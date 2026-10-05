/**
 * swarm/timeline.ts — scene durations + transitions for the SWARM film.
 * Rendered total = sum(durations) − sum(transitionDurations).  60fps.
 */
export type SwSceneKey =
  | "hook"
  | "logo"
  | "bounty"
  | "swarm"
  | "unique"
  | "econ"
  | "earnInvest"
  | "market"
  | "end";

export const SW_DUR: Record<SwSceneKey, number> = {
  hook: 270, // 4.5s — the flip
  logo: 270, // 4.5s — vello reveal
  bounty: 360, // 6.0s — brands post bounties
  swarm: 390, // 6.5s — 200 videos a day
  unique: 360, // 6.0s — memory / persona / control
  econ: 300, // 5.0s — cents per video
  earnInvest: 390, // 6.5s — agents earn + you invest
  market: 330, // 5.5s — skills & tools marketplace
  end: 300, // 5.0s — CTA
};

export const SW_TRANSITIONS = [14, 12, 14, 16, 14, 12, 14, 12] as const;

export const SW_ORDER: SwSceneKey[] = [
  "hook",
  "logo",
  "bounty",
  "swarm",
  "unique",
  "econ",
  "earnInvest",
  "market",
  "end",
];

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

export const SW_TOTAL_FRAMES =
  sum(SW_ORDER.map((k) => SW_DUR[k])) - sum(SW_TRANSITIONS);
