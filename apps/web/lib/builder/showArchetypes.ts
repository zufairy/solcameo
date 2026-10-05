// Show archetypes — bundles of sensible defaults per show type, so builders
// never configure ref strategy / engine / duration by hand. The bible's
// `archetype` picks one; every field remains overridable on the bible itself.
//
// The refPolicy is the REALISM RULE: AI-generated stills as identity refs make
// *realistic* video look uncanny/fake, while stylized shows (cartoon/anime)
// need exactly those design sheets for consistency. The policy decides which
// visualRef kinds may serve as identity references at render time
// (lib/builder/showBible.resolveIdentityRefs).

export type RefPolicy = "stylized" | "realistic" | "any";
export type VisualRefKind = "real-photo" | "ai-sheet" | "video-frame" | "style-frame";

export interface ShowArchetype {
  id: string;
  label: string;
  refPolicy: RefPolicy;
  defaultFormats: string[];
  defaultDuration: { min: number; max: number };
  /** Suggested videoEngine — a lean, never forced. */
  engineLean?: string;
  /** false = faceless show, the wizard skips the cast-lock step. */
  needsCast: boolean;
  /** Episodic shows auto-enable series arcs (continuation via seriesEpisodes). */
  episodic: boolean;
  /** Craft guidance injected into the pitch prompt for this type. */
  pitchHint: string;
}

export const ARCHETYPES: ShowArchetype[] = [
  {
    id: "cartoon-series", label: "Cartoon series", refPolicy: "stylized",
    defaultFormats: ["cartoon-episode", "skit"], defaultDuration: { min: 20, max: 40 },
    engineLean: "grok-imagine-15", needsCast: true,
    episodic: true,
    pitchHint: "Recurring visual gags, expressive exaggerated acting, a hook in the first second, episodes that end on a beat viewers want continued. Style frame: bold outlines, readable silhouettes.",
  },
  {
    id: "anime-series", label: "Anime series", refPolicy: "stylized",
    defaultFormats: ["anime-episode", "skit"], defaultDuration: { min: 20, max: 40 },
    engineLean: "grok-imagine-15", needsCast: true,
    episodic: true,
    pitchHint: "Anime tropes played knowingly — dramatic zooms, inner monologue, sakuga moments on the punchline. Episodes chain into arcs with cliffhangers. Style frame: crisp cel shading, cinematic lighting.",
  },
  {
    id: "talking-head", label: "Talking head / commentary", refPolicy: "realistic",
    defaultFormats: ["talking-head", "news-react"], defaultDuration: { min: 30, max: 45 },
    engineLean: "veo3-fast", needsCast: true,
    episodic: false,
    pitchHint: "Direct-address to camera, first-line hook that names the payoff, jump-cut pacing, one concrete takeaway per video. Style frame: natural light, real room, imperfect framing.",
  },
  {
    id: "skit", label: "Skit troupe", refPolicy: "any",
    defaultFormats: ["skit"], defaultDuration: { min: 15, max: 25 },
    engineLean: "veo3-fast", needsCast: true,
    episodic: false,
    pitchHint: "One escalating comedic premise per skit, characters commit fully, punchline lands in the last two seconds. Style frame: candid mid-action moment.",
  },
  {
    id: "news-react", label: "News reaction", refPolicy: "any",
    defaultFormats: ["news-react"], defaultDuration: { min: 30, max: 45 },
    engineLean: "veo3-fast", needsCast: true,
    episodic: false,
    pitchHint: "React to ONE real current item per video: hot take in the hook, receipts in the middle, verdict at the end. Style frame: host mid-reaction with the story visual.",
  },
  {
    id: "faceless", label: "Faceless explainer", refPolicy: "any",
    defaultFormats: ["explainer", "listicle"], defaultDuration: { min: 20, max: 40 },
    needsCast: false,
    episodic: false,
    pitchHint: "No on-screen host: strong b-roll/motion visuals carry a tight voiceover, list or curiosity-gap structures. Style frame: striking topic visual, no people.",
  },
  {
    id: "ugc-product", label: "UGC product", refPolicy: "realistic",
    defaultFormats: ["ugc-review", "unboxing"], defaultDuration: { min: 15, max: 30 },
    engineLean: "veo3-fast", needsCast: true,
    episodic: false,
    pitchHint: "Handheld authenticity — feels like a friend's recommendation, not an ad: real usage moments, honest framing, soft CTA. Style frame: product in-hand, natural setting.",
  },
  {
    id: "custom", label: "Custom", refPolicy: "any",
    defaultFormats: ["talking-head"], defaultDuration: { min: 16, max: 32 },
    needsCast: true,
    episodic: false,
    pitchHint: "Follow the builder's description faithfully; pick the structure that best serves it.",
  },
];

export function getArchetype(id: string | undefined): ShowArchetype | undefined {
  if (!id) return undefined;
  return ARCHETYPES.find((a) => a.id === id);
}

const KINDS_BY_POLICY: Record<RefPolicy, VisualRefKind[]> = {
  stylized: ["ai-sheet", "style-frame"],
  realistic: ["real-photo", "video-frame"],
  any: ["real-photo", "ai-sheet", "video-frame", "style-frame"],
};

/** Which visualRef kinds may serve as IDENTITY refs for this archetype. */
export function identityRefKindsFor(archetypeId: string | undefined): VisualRefKind[] {
  const policy = getArchetype(archetypeId)?.refPolicy ?? "any";
  return KINDS_BY_POLICY[policy];
}
