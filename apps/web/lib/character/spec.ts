import { CATALOG } from "./catalog";
import type { CharCategory, CharModel, Selection, Tier } from "./types";

export const TIERS: { id: Tier; label: string; image: string }[] = [
  { id: "normal", label: "Average", image: "/character/opt/tier-normal.webp" },
  { id: "freak", label: "Bold", image: "/character/opt/tier-freak.webp" },
  { id: "total", label: "Extreme", image: "/character/opt/tier-total.webp" },
];

/** Same section order the Higgsfield studio uses (gender first). */
const ORDER = ["gender", "ethnicity_origin_base", "age", "skin_tone", "height", "body_type", "hair", "hair_colour",
  "eye_shape", "eye_color", "freak_head", "freak_neck", "facial_hair", "freak_face", "proportions", "distinctive", "aesthetic", "accessory"];

export const CATEGORIES: CharCategory[] = [...CATALOG].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

const LOOKUP = new Map(CATALOG.map((c) => [c.id, c] as const));

export function categoriesFor(tier: Tier): CharCategory[] {
  return CATEGORIES.map((c) => ({ ...c, options: c.options.filter((o) => o.tiers.includes(tier)) })).filter((c) => c.options.length > 0);
}

const AGE: Record<string, string> = { adult: "in their 20s", mature: "in their 40s", senior: "in their 60s" };
const GENDER: Record<string, string> = { female: "woman", male: "man", "non binary": "non-binary person" };

/** What each option actually looks like, so prompt-only models (Soul 2) render the same thing the preview shows. */
const LOOK: Record<string, string> = {
  hair_bald: "completely bald", hair_buzz: "bleached buzz cut", hair_bowl: "glossy black bowl cut", hair_mullet: "voluminous ginger mullet",
  hair_braids: "long box braids with gold beads", hair_pigtails: "pigtails with straight bangs", hair_afro: "big round afro", hair_punk: "tall green mohawk",
  hair_long: "very long straight center-parted hair", hair_short: "short neat hair",
  hs_lampshade: "wide bell-shaped lampshade hair", hs_pompadour: "towering pompadour", hs_beehive: "tall beehive", hs_dome: "huge dome-shaped hair",
  hs_horns: "hair sculpted into two glossy horns", hs_softserve: "hair swirled into a soft-serve cone on top of the head", hs_sphere: "hair in a perfect round sphere",
  hs_mouse: "hair in two round mouse-ear buns", hs_wings: "hair feathered out sideways like wings", hs_hedgehog: "short spiky hedgehog hair", hs_tufts: "hair in two big fluffy tufts",
  hs_stairs: "hair cut in a staircase of steps", hs_shelf: "hair jutting out sideways like a shelf", hs_corkscrews: "long corkscrew curls", hs_sidecoil: "hair coiled into a large spiral bun at the side",
  hs_mushroom: "mushroom-cap bowl hair",
  body_slim: "tall very slim build", body_athletic: "athletic build", body_muscular: "very muscular build", body_curvy: "curvy hourglass build", body_heavy: "heavyset round build", body_ultra: "hulking, extremely muscular build with huge arms",
  h_average: "average height", h_tall: "tall", h_very_tall: "very tall",
  fh_none: "clean shaven", fh_stubble: "light stubble", fh_beard: "full beard", fh_goatee: "goatee", fh_moustache: "thick moustache", fh_pencil: "pencil-thin moustache", fh_pushbroom: "huge push-broom moustache", fh_braid: "braided beard",
};

const lc = (ls: string[]) => ls.map((l) => l.toLowerCase());

const PHRASE: Record<string, (labels: string[]) => string> = {
  gender: ([l]) => GENDER[l.toLowerCase()] ?? `${l.toLowerCase()} person`,
  ethnicity_origin_base: ([l]) => `${l.toLowerCase()} heritage`,
  age: ([l]) => AGE[l.toLowerCase()] ?? l.toLowerCase(),
  skin_tone: ([l]) => `${l.toLowerCase()} skin tone`,
  height: ([l]) => `${l.toLowerCase()} height`,
  body_type: ([l]) => `${l.toLowerCase()} build`,
  hair: ([l]) => `${l.toLowerCase()} hairstyle`,
  hair_colour: ([l]) => `${l.toLowerCase()} hair color`,
  eye_shape: ([l]) => `${l.toLowerCase()} eyes`,
  eye_color: ([l]) => `${l.toLowerCase()} eye color`,
  freak_head: ([l]) => `${l.toLowerCase()} head shape`,
  freak_neck: ([l]) => `${l.toLowerCase()} neck`,
  facial_hair: ([l]) => (l.toLowerCase() === "none" ? "clean shaven" : `${l.toLowerCase()} facial hair`),
  freak_face: (ls) => lc(ls).join(", "),
  proportions: (ls) => `${lc(ls).join(" and ")} proportions`,
  distinctive: (ls) => `distinctive: ${lc(ls).join(", ")}`,
  aesthetic: ([l]) => `${l.toLowerCase()} fashion style`,
  accessory: (ls) => {
    const real = lc(ls).filter((l) => l !== "none");
    return real.length ? `with ${real.join(", ")}` : "";
  },
};

/** Drop unknown categories/options and clamp to each category's max. Safe on untrusted input. */
export function sanitizeSelection(raw: unknown, tier: Tier): Selection {
  const out: Selection = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [cid, v] of Object.entries(raw as Record<string, unknown>)) {
    const cat = LOOKUP.get(cid);
    if (!cat || !Array.isArray(v)) continue;
    const allowed = new Set(cat.options.filter((o) => o.tiers.includes(tier)).map((o) => o.id));
    const ids = [...new Set(v.filter((x): x is string => typeof x === "string" && allowed.has(x)))].slice(0, cat.max);
    if (ids.length) out[cid] = ids;
  }
  return out;
}

export function selectedLabels(sel: Selection, cid: string): string[] {
  const cat = LOOKUP.get(cid);
  if (!cat) return [];
  return (sel[cid] ?? []).map((id) => cat.options.find((o) => o.id === id)?.label).filter((l): l is string => !!l);
}

export function isBuildable(sel: Selection): boolean {
  return Object.values(sel).some((v) => v.length > 0);
}

const DESCRIBED = new Set(["hair", "body_type", "height", "facial_hair"]);

function optionText(cid: string, id: string): string | null {
  const label = LOOKUP.get(cid)?.options.find((o) => o.id === id)?.label;
  return LOOK[id] ?? (label ? label.toLowerCase() : null);
}

/** Categories whose preview images best carry the look, most identity-defining first. */
const REF_ORDER = ["hair", "ethnicity_origin_base", "body_type", "aesthetic", "freak_face", "freak_head", "eye_shape", "distinctive", "facial_hair", "proportions", "height", "gender", "accessory"];
export const MAX_REF_TILES = 4;

export interface ReferencePlan {
  /** Option ids whose preview images go on the reference sheet, in order. */
  options: { category: string; id: string; image: string; text: string }[];
}

/** Which scraped previews to put on the single image Soul accepts as a reference. */
export function referencePlan(sel: Selection): ReferencePlan {
  const options: ReferencePlan["options"] = [];
  for (const cid of REF_ORDER) {
    if (options.length >= MAX_REF_TILES) break;
    const id = sel[cid]?.[0];
    const opt = LOOKUP.get(cid)?.options.find((o) => o.id === id);
    if (opt?.image) options.push({ category: cid, id: opt.id, image: opt.image, text: optionText(cid, opt.id) ?? opt.label.toLowerCase() });
  }
  return { options };
}

export function buildPrompt(sel: Selection, tier: Tier, opts: { sheet?: boolean; photo?: boolean } = {}): string {
  const parts: string[] = [];
  for (const cid of ORDER) {
    const ids = sel[cid] ?? [];
    if (!ids.length) continue;
    let text: string;
    if (DESCRIBED.has(cid)) text = ids.map((id) => optionText(cid, id)).filter(Boolean).join(", ");
    else {
      const labels = selectedLabels(sel, cid);
      const descriptive = ids.map((id) => LOOK[id]).filter(Boolean);
      text = descriptive.length === ids.length ? descriptive.join(", ") : PHRASE[cid]?.(labels) ?? "";
    }
    if (text) parts.push(text);
  }
  const tone = tier === "normal" ? "natural, realistic features" : tier === "freak" ? "bold, striking, exaggerated features" : "extreme, otherworldly, highly exaggerated features";
  const subject = parts.length ? parts.join("; ") : "a person";
  if (opts.photo) return `Edit the supplied reference image in place. Keep the face and identity of the person in the reference photo. Apply ONLY these selected changes: ${subject}. Selected intensity: ${tier === "normal" ? "natural, realistic" : tier === "freak" ? "bold, exaggerated for the selected traits only" : "extreme for the selected traits only"}. Preserve every unselected feature, the same person, facial identity, pose, expression, framing, camera angle, background, clothing, lighting, and visual medium. A selected trait overrides only its corresponding feature; leave everything else unchanged. Do not invent extra traits, replace the subject, restyle the image, create a collage, or add text. Preserve original composition; extend edges only if needed for the requested aspect ratio.`;
  let prompt = `Full-body character reference portrait of one person: ${subject}. ${tone}. Front-facing, standing, studio lighting, clean white backdrop, photorealistic, sharp focus, highly detailed.`;
  if (opts.sheet) {
    const plan = referencePlan(sel).options;
    prompt += ` The reference image is a grid of trait swatches (${plan.map((o) => o.text).join(", ")}). Combine exactly these traits into ONE single person. Do not copy the grid or its layout.`;
  }
  return prompt;
}

export const MODELS: { id: CharModel; label: string; blurb: string; endpoint: string; ref: boolean }[] = [
  { id: "qwen", label: "Qwen Image 3", blurb: "Generate with Qwen through Higgsfield", endpoint: "alibaba/qwen-image-3/text-to-image", ref: false },
  { id: "soul", label: "Soul", blurb: "Photoreal, uses your selection as a visual reference", endpoint: "higgsfield-ai/soul/standard", ref: true },
  { id: "soul2", label: "Soul 2", blurb: "Newest model, prompt-driven", endpoint: "higgsfield-ai/soul/v2/standard", ref: false },
];
