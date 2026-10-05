/**
 * Transitions pack (clip.transitions). A transition smooths the SEAMS inside a
 * produced clip — the title-card slate → clip body join (lib/server/clipFilterGraph)
 * and the clip body → CTA video join (lib/server/ctaAppend) — so the clip flows
 * instead of hard-cutting. (Designed to extend to multi-clip compilation later:
 * the same `xfade` id + duration drive any seam.)
 *
 * GEOMETRIC transitions map straight onto ffmpeg's built-in `xfade=transition=…`
 * filter, so they render with ZERO hosted assets — available immediately.
 *
 * PREMIUM transitions (glitch / torn-paper / light-leak) need hosted overlay packs
 * (like the gameplay + trending-audio packs) and ship as `wip: true` — surfaced in
 * the UI but blocked until TRANSITION_PACK_BASE_URL serves their assets. Until then
 * they gracefully fall back to a geometric xfade at render time (never a hard cut).
 */
export interface TransitionDef {
  /** Stable id persisted on the node config. */
  id: string;
  name: string;
  blurb: string;
  /** ffmpeg xfade transition name. Undefined only for a pure-asset premium style
   *  that has no geometric equivalent (none today — all premium fall back). */
  xfade: string;
  /** Premium/asset-based — surfaced but blocked until its assets are hosted. Falls
   *  back to `xfade` (a geometric approximation) so a WIP pick still renders. */
  wip?: boolean;
  /** Default seam duration in seconds. */
  durationSec: number;
  /** Emoji for the inspector chip. */
  icon: string;
}

export const TRANSITIONS: TransitionDef[] = [
  // ── Geometric — work now, no assets ──────────────────────────────────────────
  { id: "fade",        name: "Fade",         blurb: "Clean crossfade between the two shots.",              xfade: "fade",       durationSec: 0.5, icon: "🌫️" },
  { id: "dissolve",    name: "Dissolve",     blurb: "Grainy film-style dissolve.",                          xfade: "dissolve",   durationSec: 0.5, icon: "✨" },
  { id: "wipe_left",   name: "Wipe Left",    blurb: "The next shot wipes in from the right.",               xfade: "wipeleft",   durationSec: 0.45, icon: "⬅️" },
  { id: "wipe_right",  name: "Wipe Right",   blurb: "The next shot wipes in from the left.",                xfade: "wiperight",  durationSec: 0.45, icon: "➡️" },
  { id: "slide_up",    name: "Slide Up",     blurb: "The next shot pushes up from the bottom.",             xfade: "slideup",    durationSec: 0.45, icon: "⬆️" },
  { id: "slide_down",  name: "Slide Down",   blurb: "The next shot drops in from the top.",                 xfade: "slidedown",  durationSec: 0.45, icon: "⬇️" },
  { id: "circle_open", name: "Circle Open",  blurb: "The next shot irises open from the center.",           xfade: "circleopen", durationSec: 0.55, icon: "⭕" },
  { id: "radial",      name: "Radial Wipe",  blurb: "A clock-style radial sweep.",                          xfade: "radial",     durationSec: 0.55, icon: "🌀" },
  { id: "zoom_blur",   name: "Zoom Blur",    blurb: "A punchy zoom-in transition.",                         xfade: "zoomin",     durationSec: 0.5, icon: "🔍" },
  { id: "smooth",      name: "Smooth Slide", blurb: "A soft smeared slide — very TikTok.",                  xfade: "smoothleft", durationSec: 0.5, icon: "💫" },
  // ── Premium — surfaced but WIP until their overlay assets are hosted ──────────
  { id: "glitch",      name: "Glitch",       blurb: "Digital distortion + flicker. (Premium — coming soon)", xfade: "pixelize",  wip: true, durationSec: 0.4, icon: "📺" },
  { id: "torn_paper",  name: "Torn Paper",   blurb: "Scrapbook torn-paper tear. (Premium — coming soon)",    xfade: "wipeleft",  wip: true, durationSec: 0.5, icon: "📄" },
  { id: "light_leak",  name: "Light Leak",   blurb: "Warm cinematic light-leak wash. (Premium — coming soon)", xfade: "fadewhite", wip: true, durationSec: 0.6, icon: "🔆" },
];

export const TRANSITION_BY_ID: Record<string, TransitionDef> = Object.fromEntries(
  TRANSITIONS.map((t) => [t.id, t]),
);

export const DEFAULT_TRANSITION_ID = "fade";
export const TRANSITION_DURATION_MIN = 0.2;
export const TRANSITION_DURATION_MAX = 1.5;

export const transitionById = (id?: string): TransitionDef | undefined =>
  id ? TRANSITION_BY_ID[id] : undefined;

export const isTransitionId = (id: unknown): id is string =>
  typeof id === "string" && id in TRANSITION_BY_ID;

/** Whether a premium transition is fully available yet (its asset pack is hosted).
 *  Single source of truth so the UI greys the same styles the render falls back on. */
export const isTransitionAssetsReady = (): boolean =>
  Boolean((process.env.TRANSITION_PACK_BASE_URL ?? "").trim());

/** True only for a premium style whose assets aren't hosted yet — the UI blocks
 *  install/selection and the render substitutes its geometric `xfade` fallback. */
export const isWipTransition = (id: string): boolean => {
  const t = TRANSITION_BY_ID[id];
  return Boolean(t?.wip) && !isTransitionAssetsReady();
};

export const clampTransitionDuration = (v: unknown): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0.5;
  return Math.min(TRANSITION_DURATION_MAX, Math.max(TRANSITION_DURATION_MIN, n));
};

/** Resolve a stored transition id → the ffmpeg `xfade=transition=` name to render.
 *  Unknown/missing ids fall back to a plain fade so a seam never hard-cuts. */
export function resolveXfadeName(id?: string): string {
  return (transitionById(id) ?? TRANSITION_BY_ID[DEFAULT_TRANSITION_ID]).xfade;
}
