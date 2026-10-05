import { DEFAULT_CLIP_CONFIG } from "@/lib/builder/clipConfig";

/** The two agent kinds the guided setup can create. */
export type SetupAgentType = "influencer" | "clipping";

export const TYPE_COPY: Record<SetupAgentType, {
  title: string;
  tagline: string;
  detail: string;
  noun: string;
  nameHint: string;
}> = {
  clipping: {
    title: "Clipping agent",
    tagline: "Turns long videos into viral shorts",
    detail: "Podcasts, streams and YouTube videos in. Captioned 9:16 clips out, posted for you.",
    noun: "clipper",
    nameHint: "Pick a brand-style name, like the channel you'd post under.",
  },
  influencer: {
    title: "AI influencer",
    tagline: "A face that makes original videos",
    detail: "Give it a look, a voice and a niche. It scripts, films and posts on its own.",
    noun: "influencer",
    nameHint: "Pick the name your audience will know it by.",
  },
};

export type StepId = "type" | "niche" | "name" | "clips" | "voice" | "look" | "launch";

export const STEP_LABEL: Record<StepId, string> = {
  type: "TYPE",
  niche: "NICHE",
  name: "NAME",
  clips: "CLIPS",
  voice: "VOICE",
  look: "LOOK",
  launch: "LAUNCH",
};

/** Ordered steps per agent type. The type step is dropped when it's already known. */
export function stepsFor(type: SetupAgentType | null, includeType = true): StepId[] {
  const rest: StepId[] =
    type === "clipping" ? ["niche", "name", "clips", "look", "launch"]
    : ["niche", "name", "voice", "look", "launch"];
  return includeType ? ["type", ...rest] : rest;
}

export const NICHES = [
  "Podcasts & interviews",
  "Business & entrepreneurship",
  "Finance & crypto",
  "Tech & AI",
  "Gaming & streaming",
  "Fitness & health",
  "Beauty & fashion",
  "Food & cooking",
  "Travel & lifestyle",
  "Comedy & entertainment",
  "Sports",
  "Education & how-to",
  "Motivation & self-growth",
  "Music & culture",
  "Real estate",
  "Parenting & family",
] as const;

export const OTHER_NICHE = "Something else";

export const LANGUAGES = [
  "English", "Malay", "Indonesian", "Spanish", "Portuguese", "French", "German", "Hindi",
  "Arabic", "Turkish", "Filipino", "Vietnamese", "Thai", "Chinese", "Japanese", "Korean",
] as const;

export type Voice = "mentor" | "entertainer" | "friend" | "expert" | "aspirational";
export const VOICES: { id: Voice; title: string; blurb: string }[] = [
  { id: "friend", title: "Friend", blurb: "Casual, relatable, talks like a DM" },
  { id: "entertainer", title: "Entertainer", blurb: "High energy, jokes, big reactions" },
  { id: "mentor", title: "Mentor", blurb: "Calm, guiding, shares what worked" },
  { id: "expert", title: "Expert", blurb: "Sharp, factual, no fluff" },
  { id: "aspirational", title: "Aspirational", blurb: "Polished, premium, lifestyle-led" },
];

export const CLIP_LENGTHS = [
  { id: "short", title: "Quick hits", blurb: "15 to 30 seconds", min: 15, max: 30 },
  { id: "standard", title: "Standard", blurb: "30 seconds to 1 minute", min: 30, max: 60 },
  { id: "long", title: "Deep cuts", blurb: "1 to 3 minutes", min: 60, max: 180 },
] as const;
export type ClipLengthId = (typeof CLIP_LENGTHS)[number]["id"];

export const CLIP_PLATFORMS = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Reels" },
  { id: "youtube", label: "Shorts" },
] as const;

const GENERIC_NAME = /^(new[\s_-]*agent|my[\s_-]*agent|agent|ai[\s_-]*agent|ai[\s_-]*influencer|ai[\s_-]*clipper|clipper|influencer|untitled|test|name|asdf+)\d*$/i;

export const NAME_MAX = 28;

/** null when the name is fine, otherwise a short instruction to show the user. */
export function nameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return null; // not an error yet, just not ready
  if (name.length < 2) return "A little longer, at least 2 characters.";
  if (GENERIC_NAME.test(name)) return "That one is taken by everyone. Give it a name people will remember.";
  return null;
}

export function nameReady(raw: string): boolean {
  const name = raw.trim();
  return name.length >= 2 && nameProblem(name) === null;
}

export function slugHandle(name: string): string | undefined {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 18);
  return slug.length >= 3 ? slug : undefined;
}

// ── Name suggestions ─────────────────────────────────────────────────────────

const PEOPLE = ["Aria", "Nova", "Kai", "Luna", "Zara", "Milo", "Ivy", "Jett", "Sage", "Remy", "Nia", "Leo", "Maya", "Eli", "Skye", "Ravi", "Yuna", "Theo", "Amara", "Dex"];
const SURNAMES = ["Vale", "Rivers", "Stone", "Quinn", "Hart", "Bloom", "Voss", "Lane", "Frost", "Reyes", "Park", "Cole"];
const CLIP_SUFFIX = ["Clips", "Cuts", "Shorts", "Reels", "Highlights", "Snips"];
const CLIP_PREFIX = ["Clip", "Short", "Reel", "Snap", "Cut", "Peak", "Viral", "Prime"];

/** First meaningful word of a niche ("Finance & crypto" → "Finance"). */
function nicheWord(niche: string): string {
  const w = niche.split(/[\s&,/-]+/).find((x) => x.length > 2) ?? "";
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

// Small deterministic PRNG so "shuffle" is stable per click and testable.
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: readonly T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)];
}

export function suggestNames(type: SetupAgentType, niche: string, seed: number, count = 4): string[] {
  const rnd = mulberry32(seed * 9973 + niche.length * 31 + (type === "clipping" ? 7 : 3));
  const word = nicheWord(niche);
  const out = new Set<string>();
  let guard = 0;
  while (out.size < count && guard++ < 60) {
    let n: string;
    if (type === "clipping") {
      const roll = rnd();
      if (roll < 0.4 && word) n = `${word}${pick(CLIP_SUFFIX, rnd)}`;
      else if (roll < 0.7) n = `${pick(CLIP_PREFIX, rnd)}${pick(PEOPLE, rnd)}`;
      else n = `${pick(PEOPLE, rnd)} ${pick(CLIP_SUFFIX, rnd)}`;
    } else {
      n = rnd() < 0.55 ? `${pick(PEOPLE, rnd)} ${pick(SURNAMES, rnd)}` : pick(PEOPLE, rnd);
    }
    if (n.length <= NAME_MAX) out.add(n);
  }
  return [...out];
}

// ── Blueprint ────────────────────────────────────────────────────────────────

export interface SetupAnswers {
  type: SetupAgentType;
  name: string;
  niche: string;
  language: string;
  voice: Voice;
  clipLength: ClipLengthId;
  platforms: string[];
  lookStyle: string;
  imageUrl: string;
}

/** The blueprint shape /api/nft/mint reads (persona + clipConfig), plus the
 *  fields the builder's resume path expects. */
export function buildBlueprint(a: SetupAnswers) {
  const length = CLIP_LENGTHS.find((l) => l.id === a.clipLength) ?? CLIP_LENGTHS[1];
  return {
    agentType: a.type,
    agentStatus: "mint_complete" as const,
    avatarsGenerated: true,
    persona: {
      name: a.name.trim(),
      handle: slugHandle(a.name),
      niche: a.niche,
      language: a.type === "clipping" ? "English" : a.language,
      voiceArchetype: a.type === "clipping" ? ("friend" as const) : a.voice,
      contentPillars: [a.niche],
      audience: a.type === "clipping" ? `${a.niche} viewers` : `${a.niche} fans`,
      aesthetic: a.lookStyle,
      imageUrl: a.imageUrl,
    },
    ...(a.type === "clipping"
      ? {
          clipConfig: {
            ...DEFAULT_CLIP_CONFIG,
            clipLength: { min: length.min, max: length.max },
            platforms: a.platforms.length ? a.platforms : DEFAULT_CLIP_CONFIG.platforms,
          },
        }
      : {}),
  };
}

// ── Just-minted hand-off (setup flow → welcome screen) ───────────────────────

export interface JustMinted {
  mintAddress: string;
  type: SetupAgentType;
  name: string;
  handle?: string;
  niche: string;
  imageUrl: string;
}

const MINTED_KEY = (mint: string) => `vello:just-minted:${mint}`;

export function stashJustMinted(info: JustMinted) {
  try { window.sessionStorage.setItem(MINTED_KEY(info.mintAddress), JSON.stringify(info)); } catch { /* private mode */ }
}

export function readJustMinted(mint: string): JustMinted | null {
  try {
    const raw = window.sessionStorage.getItem(MINTED_KEY(mint));
    return raw ? (JSON.parse(raw) as JustMinted) : null;
  } catch { return null; }
}

export function clearJustMinted(mint: string) {
  try { window.sessionStorage.removeItem(MINTED_KEY(mint)); } catch { /* ignore */ }
}
