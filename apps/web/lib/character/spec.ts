import { CATALOG } from "./catalog";
import { isAnimalTier, type AnimalTier, type CharCategory, type CharModel, type Selection, type Tier } from "./types";

export const TIERS: { id: Tier; label: string; image: string }[] = [
  { id: "normal", label: "Average", image: "/character/opt/tier-normal.webp" },
  { id: "freak", label: "Bold", image: "/character/opt/tier-freak.webp" },
  { id: "total", label: "Extreme", image: "/character/opt/tier-total.webp" },
  { id: "insects", label: "Insect", image: "/character/opt/tier-insects.webp" },
  { id: "frogs", label: "Frog", image: "/character/opt/tier-frogs.webp" },
  { id: "cats", label: "Cat", image: "/character/opt/tier-cats.webp" },
  { id: "dogs", label: "Dog", image: "/character/opt/tier-dogs.webp" },
  { id: "capybaras", label: "Capybara", image: "/character/opt/tier-capybaras.webp" },
  { id: "birds", label: "Bird", image: "/character/opt/tier-birds.webp" },
];

/** Higgsfield's animal tiers share these groups with the human tiers, limited to the options that exist in "freak". */
const ANIMAL_GROUPS = new Set(["gender", "body_type", "hair", "hair_colour", "aesthetic", "height", "proportions", "facial_hair", "distinctive", "accessory"]);

/** Species to pick from per animal tier. Optional: left empty, the prompt just names the animal. */
const SPECIES: Record<AnimalTier, string[]> = {
  insects: ["Ant", "Beetle", "Ladybug", "Bee", "Butterfly", "Praying mantis", "Dragonfly", "Moth", "Cricket", "Firefly"],
  frogs: ["Tree frog", "Poison dart frog", "Bullfrog", "Toad", "Glass frog"],
  cats: ["Tabby", "Black cat", "Siamese", "Persian", "Maine Coon", "Sphynx", "Calico"],
  dogs: ["Corgi", "Golden retriever", "Bulldog", "Husky", "Shiba Inu", "Pug", "Dalmatian"],
  capybaras: ["Capybara"],
  birds: ["Parrot", "Owl", "Flamingo", "Penguin", "Crow", "Toucan", "Peacock"],
};
const speciesCategory = (tier: AnimalTier): CharCategory => ({
  id: "species", label: "Species", kind: "text", max: 1,
  options: SPECIES[tier].map((label) => ({ id: label.toLowerCase().replace(/\s+/g, "_"), label, tiers: [tier] })),
});
const optionInTier = (cid: string, o: { tiers: Tier[] }, tier: Tier) =>
  isAnimalTier(tier) ? ANIMAL_GROUPS.has(cid) && o.tiers.includes("freak") : o.tiers.includes(tier);

/** Same section order the Higgsfield studio uses (gender first). */
const ORDER = ["species", "gender", "ethnicity_origin_base", "age", "skin_tone", "height", "body_type", "hair", "hair_colour",
  "eye_shape", "eye_color", "freak_head", "freak_neck", "facial_hair", "freak_face", "proportions", "distinctive", "aesthetic", "accessory"];

export const CATEGORIES: CharCategory[] = [...CATALOG].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

const LOOKUP = new Map(CATALOG.map((c) => [c.id, c] as const));

export function categoriesFor(tier: Tier): CharCategory[] {
  const cats = CATEGORIES.map((c) => ({ ...c, options: c.options.filter((o) => optionInTier(c.id, o, tier)) })).filter((c) => c.options.length > 0);
  return isAnimalTier(tier) ? [speciesCategory(tier), ...cats] : cats;
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
    const cat = cid === "species" && isAnimalTier(tier) ? speciesCategory(tier) : LOOKUP.get(cid);
    if (!cat || !Array.isArray(v)) continue;
    const allowed = new Set(cat.options.filter((o) => cid === "species" || optionInTier(cid, o, tier)).map((o) => o.id));
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

const ANIMAL_NOUN: Record<AnimalTier, string> = { insects: "insect", frogs: "frog", cats: "cat", dogs: "dog", capybaras: "capybara", birds: "bird" };
/** How trait groups read on an animal: hair becomes head styling, hair color becomes fur or feather color. */
const ANIMAL_PHRASE: Record<string, (label: string) => string> = {
  gender: (l) => `${l.toLowerCase()} animal`,
  hair: (l) => `${l.toLowerCase()} head styling`,
  hair_colour: (l) => `${l.toLowerCase()} fur or feather color`,
  facial_hair: (l) => (l.toLowerCase() === "clean" ? "" : `${l.toLowerCase()} whisker styling`),
};

/** The selected traits as prose, plus the tier's tone, shared by every prompt builder. */
function traitSummary(sel: Selection, tier: Tier) {
  const parts: string[] = [];
  const animal = isAnimalTier(tier);
  let species: string | undefined;
  for (const cid of ORDER) {
    const ids = sel[cid] ?? [];
    if (!ids.length) continue;
    if (cid === "species") { species = animal ? speciesCategory(tier).options.find((o) => o.id === ids[0])?.label : undefined; continue; }
    let text: string;
    if (animal && ANIMAL_PHRASE[cid]) text = ANIMAL_PHRASE[cid](selectedLabels(sel, cid)[0] ?? "");
    else if (DESCRIBED.has(cid)) text = ids.map((id) => optionText(cid, id)).filter(Boolean).join(", ");
    else {
      const labels = selectedLabels(sel, cid);
      const descriptive = ids.map((id) => LOOK[id]).filter(Boolean);
      text = descriptive.length === ids.length ? descriptive.join(", ") : PHRASE[cid]?.(labels) ?? "";
    }
    if (text) parts.push(text);
  }
  const tone = animal ? "expressive, characterful, rich fur, feather or shell texture" : tier === "normal" ? "natural, realistic features" : tier === "freak" ? "bold, striking, exaggerated features" : "extreme, otherworldly, highly exaggerated features";
  const subject = parts.length ? parts.join("; ") : animal ? "" : "a person";
  return { subject, tone, animal, species, parts };
}

export function buildPrompt(sel: Selection, tier: Tier, opts: { sheet?: boolean; photo?: boolean; pose?: string } = {}): string {
  const { subject, tone, animal, species } = traitSummary(sel, tier);
  if (opts.photo && animal) return `Edit the supplied reference image into one anthropomorphic ${(species ?? ANIMAL_NOUN[tier as AnimalTier]).toLowerCase()} character. The selected animal type overrides the reference subject's species: use an animal head and species-appropriate anatomy, never a human wearing an animal costume. Retain recognizable styling, clothing, colors, pose, framing, background, lighting, and visual medium from the reference unless a selected trait changes it. Apply these selected traits: ${subject || "the selected animal type"}. ${tone}. Create one coherent character, no collage or text.`;
  if (opts.photo) return `Edit the supplied reference image in place. Keep the face and identity of the person in the reference photo. Apply ONLY these selected changes: ${subject}. Selected intensity: ${tier === "normal" ? "natural, realistic" : tier === "freak" ? "bold, exaggerated for the selected traits only" : "extreme for the selected traits only"}. Preserve every unselected feature, the same person, facial identity, pose, expression, framing, camera angle, background, clothing, lighting, and visual medium. A selected trait overrides only its corresponding feature; leave everything else unchanged. Do not invent extra traits, replace the subject, restyle the image, create a collage, or add text. Preserve original composition; extend edges only if needed for the requested aspect ratio.`;
  const pose = opts.pose ?? "Front-facing, standing";
  let prompt = animal
    ? `Full-body character reference portrait of one anthropomorphic ${(species ?? ANIMAL_NOUN[tier as AnimalTier]).toLowerCase()} character standing upright on two legs like a person, in clothes${subject ? `: ${subject}` : ""}. ${tone}. ${pose}, studio lighting, clean white backdrop, photorealistic, sharp focus, highly detailed.`
    : `Full-body character reference portrait of one person: ${subject}. ${tone}. ${pose}, studio lighting, clean white backdrop, photorealistic, sharp focus, highly detailed.`;
  if (opts.sheet) {
    const plan = referencePlan(sel).options;
    prompt += ` The reference image is a grid of trait swatches (${plan.map((o) => o.text).join(", ")}). Combine exactly these traits into ONE single person. Do not copy the grid or its layout.`;
  }
  return prompt;
}

export const MODELS: { id: CharModel; label: string; blurb: string; endpoint: string; ref: boolean }[] = [
  { id: "nano", label: "Nano Banana Pro", blurb: "Your reference photos plus selected traits, via KIE", endpoint: "kie/nano-banana-pro", ref: true },
  { id: "soul", label: "Soul", blurb: "Photoreal, uses your selection as a visual reference", endpoint: "higgsfield-ai/soul/standard", ref: true },
  { id: "soul2", label: "Soul 2", blurb: "Newest model, prompt-driven", endpoint: "higgsfield-ai/soul/v2/standard", ref: false },
];

/** Distinct poses so a batch of candidates never repeats the same stance. */
export const POSES = [
  "Front-facing, standing with arms relaxed at the sides",
  "Three-quarter turn to the left, one hand on hip, chin slightly lifted",
  "Walking toward the camera mid-stride, arms swinging naturally",
  "Seated on a plain stool, leaning forward with elbows on knees",
  "Arms crossed over the chest, weight on one leg, direct stare",
  "Side profile, looking over the shoulder at the camera",
  "Hands in pockets, relaxed slouch, head tilted",
  "Low three-quarter angle looking up at the camera, one arm raised in a wave",
];

/** One shared look per batch: every take uses the same backdrop, light and lens, and only the pose changes. */
export const TEMPLATES = [
  "seamless warm light-grey studio backdrop, soft front-left key light with a subtle rim light, 85mm lens, neutral colour grade",
  "clean white cyclorama studio, bright even softbox light, 85mm lens, crisp neutral colour grade",
  "deep charcoal studio backdrop, soft side key light with gentle fill, 85mm lens, cinematic colour grade",
  "seamless pastel peach studio backdrop, soft diffused light, 85mm lens, warm clean colour grade",
  "seamless cool blue-grey studio backdrop, soft top-left key light, 85mm lens, cool clean colour grade",
];

/**
 * Prompt for a portrait made from the user's reference photos. The selected traits are hard requirements, the photos
 * only supply identity, and the whole batch shares one template so the results read as a set of different poses of
 * the same concept rather than copies of the upload.
 */
export function buildTemplatePrompt(sel: Selection, tier: Tier, opts: { pose: string; template: string; photo: boolean; brief?: string }): string {
  const { subject, tone, animal, species } = traitSummary(sel, tier);
  const noun = animal ? `one anthropomorphic ${(species ?? ANIMAL_NOUN[tier as AnimalTier]).toLowerCase()} character standing upright on two legs like a person, in clothes` : "one person";
  const lines = [
    `Create ${noun} as a full-body character portrait, head to toe in frame with comfortable headroom, subject centred. One subject only.`,
    opts.brief ? `Style direction: ${opts.brief}` : "",
    `SET TEMPLATE (identical for every image in this set): ${opts.template}.`,
    `POSE FOR THIS IMAGE: ${opts.pose}.`,
    subject ? `CHARACTER, every item must be clearly visible exactly as written, none dropped, swapped or softened: ${subject}.` : "",
    `Style: ${tone}.`,
    opts.photo
      ? (animal
        ? "The attached reference photo(s) are inspiration only: take their overall vibe, colour palette and personality. The selected animal type always wins, so use an animal head and species-appropriate anatomy, never a human in an animal costume. Do not reuse the reference pose, framing, background, lighting or clothing."
        : "The attached reference photo(s) supply IDENTITY only: keep the same face, facial structure, skin tone and apparent age so the result is clearly the same person. Do NOT reuse the reference pose, framing, camera angle, background, lighting, expression or clothing. Build a brand-new image. Wherever a selected trait differs from the reference (hair, outfit, accessories, features), the selected trait wins.")
      : "",
    "Photorealistic, sharp focus, highly detailed. No collage, grid, text, logo or watermark. No extra people, extra limbs or cropped feet.",
  ];
  return lines.filter(Boolean).join(" ");
}
