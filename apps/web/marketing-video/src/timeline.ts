/**
 * timeline.ts — single source of truth for scene durations + transitions.
 * Shared by both the landscape and vertical masters so they stay frame-locked.
 *
 * TransitionSeries note: a transition overlaps the two sequences it joins, so
 * the rendered total = sum(durations) − sum(transitionDurations).
 */
export type SceneKey =
  | "hook"
  | "problem"
  | "reveal"
  | "howItWorks"
  | "magic"
  | "earns"
  | "vision"
  | "end";

/** On-screen budget per scene, in frames @ 60fps. */
export const SCENE_DUR: Record<SceneKey, number> = {
  hook: 180, // 3.0s
  problem: 240, // 4.0s
  reveal: 300, // 5.0s
  howItWorks: 360, // 6.0s
  magic: 360, // 6.0s
  earns: 300, // 5.0s
  vision: 240, // 4.0s
  end: 180, // 3.0s
};

/** Transition lengths between consecutive scenes (7 joins). */
export const TRANSITIONS = [12, 14, 12, 12, 16, 12, 14] as const;

export const SCENE_ORDER: SceneKey[] = [
  "hook",
  "problem",
  "reveal",
  "howItWorks",
  "magic",
  "earns",
  "vision",
  "end",
];

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

/** Total composition length after transition overlaps are subtracted. */
export const TOTAL_FRAMES =
  sum(SCENE_ORDER.map((k) => SCENE_DUR[k])) - sum(TRANSITIONS);
