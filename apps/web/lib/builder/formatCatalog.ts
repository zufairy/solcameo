/** The Format Catalog — every kind of video the platform can produce, as data.
 *  Backbone of the prompt builder (this phase) and the onboarding wizard
 *  (phase 2). Spec: docs/superpowers/specs/2026-08-24-agent-onboarding-flow-design.md */

export interface TunableField {
  key: string;            // stored into videoStyles[format].<key>
  label: string;          // wizard question label (phase 2)
  options: string[];      // chip choices
}

export interface VideoFormat {
  id: string;
  name: string;
  blurb: string;
  exampleClipUrls: string[];       // filled in phase 2 (wizard); empty now
  durationSec: { min: number; max: number; default: number; step: number };
  engines: string[];               // Kie engine ids, first = default
  voice: "on-camera" | "voiceover" | "none";
  promptTemplate: string;
  /** Per-format SCRIPT recipe — how the script LLM should write THIS kind of
   *  video from the operator's topic (structure, pacing, hook shape). Folded
   *  into the creative brief's structureNotes at script time, so every format
   *  gets a personalized script, not a generic monologue. */
  scriptRecipe?: string;
  tunables: TunableField[];
  pipeline: "generate" | "documentary" | "clipping";
}

const D = (min: number, max: number, def: number): VideoFormat["durationSec"] =>
  ({ min, max, default: def, step: 5 });

/** Free stock previews (Mixkit — free for commercial use, no attribution
 *  required: https://mixkit.co/license/) used as every format card's preview.
 *  Picked per-format to match that format's actual content (not generic
 *  filler, not reused across unrelated cards) — real, verified, direct mp4
 *  links, not our own pipeline renders. Swap any entry for a real render
 *  once the pipeline has produced a good one for that format. */
const STOCK_SAMPLE = {
  vloggerFace: "https://assets.mixkit.co/videos/41290/41290-720.mp4",
  newscaster: "https://assets.mixkit.co/videos/24263/24263-720.mp4",
  comedyMocking: "https://assets.mixkit.co/videos/24440/24440-720.mp4",
  cartoonDancers: "https://assets.mixkit.co/videos/44877/44877-720.mp4",
  dramaticBallet: "https://assets.mixkit.co/videos/3637/3637-720.mp4",
  focusedWorking: "https://assets.mixkit.co/videos/48503/48503-720.mp4",
  filmReelCountdown: "https://assets.mixkit.co/videos/4421/4421-720.mp4",
  confidentPresenter: "https://assets.mixkit.co/videos/23117/23117-720.mp4",
  candidSelfie: "https://assets.mixkit.co/videos/41181/41181-720.mp4",
  productMacro: "https://assets.mixkit.co/videos/2801/2801-720.mp4",
  surrealDance: "https://assets.mixkit.co/videos/49097/49097-720.mp4",
  skincareHowTo: "https://assets.mixkit.co/videos/50417/50417-720.mp4",
};

export const VIDEO_FORMATS: VideoFormat[] = [
  {
    id: "founder-talk", name: "Founder Talking Video",
    blurb: "You (or your persona) talking straight to camera, stories, takes, launches.",
    exampleClipUrls: [STOCK_SAMPLE.vloggerFace], durationSec: D(5, 60, 30),
    // Grok first: it's the wizard's default engine (engines[0] = default,
    // see engineForFormat in components/builder/onboarding/steps.tsx).
    engines: ["grok-imagine-15", "gemini-omni", "veo3-fast"], voice: "on-camera",
    promptTemplate:
      "A single presenter ({cast}) speaks directly to camera in {language}, {tone} tone, about {topic} in the context of {premise}. " +
      "Handheld selfie framing, natural light, one location, real human energy — no b-roll cutaways. " +
      "Open with a hook in the first 2 seconds, one key story beat per 10 seconds, end with {cta}. Total length {durationSec}s.",
    scriptRecipe:
      "Write a first-person founder monologue on the topic: a personal stake in line one (why I care), one concrete story or number in the middle, a direct ask at the end. Conversational, no corporate words.",
    tunables: [
      { key: "framing", label: "How is it filmed?", options: ["selfie handheld", "desk setup", "walking outside"] },
      { key: "cta", label: "How should it end?", options: ["follow for more", "link in bio", "no CTA"] },
    ],
    pipeline: "generate",
  },
  {
    id: "news-commentary", name: "News Commentary",
    blurb: "Fast reaction to a real, current headline in your niche, then your sharp take.",
    exampleClipUrls: [STOCK_SAMPLE.newscaster], durationSec: D(10, 45, 20),
    engines: ["grok-imagine-15", "gemini-omni", "veo3-fast"], voice: "on-camera",
    promptTemplate:
      "A single presenter ({cast}) reacts on camera, {language}, {tone} tone, fast-talking energy, to a real current news story about {topic} in the {premise} niche. " +
      "Desk or handheld framing, direct eye contact, no b-roll — this is a live-reaction talking head, not a narrated explainer. " +
      "First line names the actual headline/story so the viewer instantly knows what's being reacted to, then delivers the presenter's sharp take on it. End with {cta}. Total length {durationSec}s.",
    scriptRecipe:
      "Write it as a news-anchor-style reaction, grounded ONLY in the real facts/headline supplied for this idea (never invented ones): line one states the actual story (who/what/when, plain language, no throat-clearing). Then SUSTAIN the take across the WHOLE requested runtime — this is a full commentary, not a one-liner: give 2-3 distinct supporting points (why it matters, who it affects, what happens next, a comparison, a prediction), each a genuinely new angle, not restating the headline. End on a punchy one-line verdict, not a trailing thought. Never pad with filler, throat-clearing, or repeated phrasing just to fill time — every added second must be a real, substantive point. Cite no URLs out loud; the source link is shown on-screen separately.",
    tunables: [
      { key: "framing", label: "How is it filmed?", options: ["desk setup", "selfie handheld", "walking outside"] },
      { key: "cta", label: "How should it end?", options: ["follow for more", "link in bio", "no CTA"] },
    ],
    pipeline: "generate",
  },
  {
    id: "skit", name: "Skit",
    blurb: "Short multi-beat comedy scene with a punchline, built around your exact topic.",
    // reactionAlt was street-interview's card; street-interview is now the
    // How To format (a totally different visual style, no longer served by
    // this clip), freeing it up for Skit so this card actually shows a real
    // render instead of the gradient placeholder.
    exampleClipUrls: [STOCK_SAMPLE.comedyMocking], durationSec: D(5, 45, 25),
    engines: ["grok-imagine-15", "veo3-fast"], voice: "on-camera",
    promptTemplate:
      "A short comedic skit in {language} SPECIFICALLY about {topic} (the joke must be recognizably about this exact topic, not generic comedy): 2-3 beats (setup, escalation, punchline), characters: {cast}. " +
      "{tone} humor, {style} look, snappy cuts, punchline lands in the final 3 seconds. {durationSec}s total.",
    scriptRecipe:
      "Write {topic} as a 3-beat comedy sketch: setup (a relatable situation built directly from the topic), escalation (it gets worse or weirder, still clearly about the topic), punchline in the final line that pays off the specific topic (not a generic joke that could apply to anything). Dialogue over narration; every line must be sayable in one breath.",
    tunables: [{ key: "humor", label: "What kind of funny?", options: ["deadpan", "absurd", "relatable"] }],
    pipeline: "generate",
  },
  {
    id: "cartoon", name: "Cartoon",
    blurb: "Stylized animated shorts, bold shapes and one clear visual gag per video.",
    exampleClipUrls: [STOCK_SAMPLE.cartoonDancers], durationSec: D(5, 30, 15),
    // Seedance stays the default (its multi-panel storyboard + dedicated
    // opening-keyframe pipeline is the more mature stylized-render path) —
    // Grok listed second now that it's a genuinely supported, working choice
    // for this format (formatPromptIn is now composed for manual renders too,
    // so Grok actually gets this format's own prompt styling — see run-task/route.ts).
    engines: ["seedance-1-5-pro", "grok-imagine-15"], voice: "voiceover",
    promptTemplate:
      "A {style} cartoon animation about {topic}: bold shapes, exaggerated motion, bright palette. " +
      "One clear visual gag or transformation. Voiceover in {language}, {tone}, written for {durationSec}s of narration.",
    scriptRecipe:
      "Write the topic as ONE visual gag: a short playful voiceover that sets up the transformation, then lets the animation land it. Lines describe what we SEE, not abstract ideas.",
    tunables: [{ key: "artStyle", label: "Art style?", options: ["flat 2D", "clay 3D", "sketchbook"] }],
    pipeline: "generate",
  },
  {
    id: "anime", name: "Anime",
    blurb: "Cinematic anime beats with dramatic lighting and expressive character acting.",
    exampleClipUrls: [STOCK_SAMPLE.dramaticBallet], durationSec: D(5, 30, 20),
    engines: ["seedance-1-5-pro", "grok-imagine-15"], voice: "voiceover",
    promptTemplate:
      "An anime scene about {topic}: cinematic anime style ({style}), dramatic lighting, expressive close-ups, motion lines on action beats. " +
      "Characters: {cast}. {language} voiceover, {tone}. {durationSec}s.",
    scriptRecipe:
      "Write the topic as a dramatic mini-scene: an inner-monologue or duel-of-words with rising stakes, one emotional turn, a cliff or resolution line at the end. Keep lines short and cinematic.",
    tunables: [{ key: "animeLook", label: "Anime look?", options: ["shonen action", "slice of life", "dark seinen"] }],
    pipeline: "generate",
  },
  {
    id: "voiceover", name: "Voiceover Essay",
    blurb: "Narration over matching visuals, built for explainers, takes, and listicles.",
    exampleClipUrls: [STOCK_SAMPLE.focusedWorking], durationSec: D(5, 90, 45),
    engines: ["veo3-fast"], voice: "voiceover",
    promptTemplate:
      "A {tone} voiceover essay in {language} about {topic}: one clear thesis, 3 supporting visuals, " +
      "narration paced at ~2.4 words/sec for {durationSec}s. Visuals: {style} b-roll matching each narration beat. No on-screen presenter.",
    scriptRecipe:
      "Write a thesis-first essay on the topic: the claim in line one, three concrete supporting beats (each tied to a visual), a one-line takeaway. No filler transitions.",
    tunables: [{ key: "broll", label: "Visual flavor?", options: ["real footage", "abstract motion", "screen recordings"] }],
    pipeline: "generate",
  },
  {
    id: "documentary", name: "Documentary",
    blurb: "Mini-documentaries with a narrated 3-act arc and archival-style imagery.",
    exampleClipUrls: [STOCK_SAMPLE.filmReelCountdown], durationSec: D(60, 180, 90),
    engines: [], voice: "voiceover",
    promptTemplate:
      "A short documentary about {topic}: cold-open question, 3-act arc (context, turn, resolution), {tone} narrator in {language}, " +
      "archival/stock imagery, music bed. {durationSec}s, scene every ~9s.",
    scriptRecipe:
      "Write a narrated 3-act arc on the topic: cold-open question, context, the turn, resolution. Authoritative but human; each act maps to a scene.",
    tunables: [{ key: "narrator", label: "Narrator vibe?", options: ["david-attenborough calm", "true-crime tense", "upbeat explainer"] }],
    pipeline: "documentary",
  },
  {
    // id kept as "case-study" for backward compat — agents that already
    // picked this format (bible.format.kinds) must keep resolving to a real
    // catalog entry. Content fully replaced per operator request: Reverse
    // Psychology Reactions.
    id: "case-study", name: "Reverse Psychology Reactions",
    blurb: "Deliberately backwards takes engineered to bait replies and prove-me-wrong debates.",
    exampleClipUrls: [STOCK_SAMPLE.confidentPresenter], durationSec: D(10, 45, 25),
    engines: ["grok-imagine-15", "veo3-fast", "gemini-omni"], voice: "on-camera",
    promptTemplate:
      "A single presenter ({cast}) delivers a deliberately CONTRARIAN reaction, {language}, {tone} tone, straight to camera, about {topic} in the {premise} niche. " +
      "The opening line states a backwards-sounding claim on purpose (the reverse-psychology hook, engineered from {topic} to make viewers want to argue), then the presenter defends it with a real, specific reason. " +
      "Direct eye contact, no b-roll, confrontational but not mean, ends daring the viewer to disagree in the comments ({cta}). {durationSec}s total.",
    scriptRecipe:
      "Write it as reverse psychology, purpose-built to bait engagement on {topic}: line one is a deliberately backwards or unpopular-sounding claim (say the OPPOSITE of the obvious take, or tell viewers NOT to do the thing everyone does) — specific to this topic, never generic contrarianism. The middle gives ONE real, concrete reason that makes the backwards claim land as genuinely arguable, not just edgy. End on a direct dare/challenge line that goads a reply (\"tell me I'm wrong\", \"prove it\") — never a neutral wrap-up. The whole point is comments and views, so every line should be quotable or arguable.",
    tunables: [
      { key: "reverseAngle", label: "Reverse psychology style?", options: ["backwards advice", "unpopular opinion", "dare to disagree"] },
      { key: "cta", label: "How should it end?", options: ["prove me wrong", "comment if you disagree", "follow for more takes"] },
    ],
    pipeline: "generate",
  },
  {
    id: "no-voice-candids", name: "No Voice Candids",
    blurb: "Silent candid shorts from your real photo. Looks like true iPhone footage.",
    // reviewSelfie is a TALKING selfie clip (founder-talk's card) — wrong
    // context for a silent-candid preview and was showing as an identical
    // duplicate of that card. Free stock candid-selfie clip instead (see
    // STOCK_SAMPLE comment) — genuinely silent/candid, matches this format.
    exampleClipUrls: [STOCK_SAMPLE.candidSelfie], durationSec: D(5, 30, 10),
    // Realism-first single-take engines. The realism auto-decision skips the
    // storyboard for this format (the "candid" signal), so every render anchors
    // straight to the ORIGINAL reference image. A "new location each video"
    // scene pick keeps the same person and re-establishes the setting in the
    // prompt (the reference still owns identity).
    engines: ["grok-imagine-15", "gemini-omni"], voice: "none",
    promptTemplate:
      "A silent candid short about {topic}: the exact person from the reference photo caught mid-moment, natural body language, NO speaking, no lip movement, no narration. " +
      "Shot like real iPhone footage: vertical handheld with micro-shake, natural available light, true-to-life skin texture, slight motion blur, everyday imperfection, nothing staged or cinematic. " +
      "One continuous uncut take, {style} vibe, ambient sound only. {durationSec}s.",
    scriptRecipe:
      "No spoken lines at all. Write the hook as an on-screen caption of 8 words or less, and scene beats as pure candid ACTIONS the person does (specific, physical, cute or funny), each beat one clear visible moment.",
    tunables: [
      { key: "vibe", label: "Candid vibe?", options: ["cute", "aesthetic", "funny", "flirty"] },
      { key: "scene", label: "Where is it filmed?", options: ["keep the photo's location", "new location each video"] },
    ],
    pipeline: "generate",
  },
  {
    id: "commercial", name: "Commercial",
    blurb: "Polished product spots with cinematic ad energy that doesn't feel like an ad.",
    // storyEmotional is case-study's card — reusing it here duplicated that
    // card exactly. Free stock product-hero macro shot instead (see
    // STOCK_SAMPLE comment) — matches this format's product-ad premise.
    exampleClipUrls: [STOCK_SAMPLE.productMacro], durationSec: D(5, 45, 20),
    engines: ["grok-imagine-15", "gemini-omni", "seedance-1-5-pro"], voice: "voiceover",
    promptTemplate:
      "A premium short-form COMMERCIAL about {topic} for {premise}: product-hero shots with intentional lighting, " +
      "macro detail inserts, satisfying slow-motion beats, and one human moment showing the payoff. " +
      "Confident {tone} voiceover in {language}, {style} grade, rhythmic cuts matched to the narration, " +
      "brand-clean frames, ends on the product with {cta}. {durationSec}s.",
    scriptRecipe:
      "Write ad copy, not a monologue: open on the customer's pain or desire in one line, present the product as the turn, close with a single memorable tagline plus the CTA. Short punchy sentences, benefit words over feature words, no hard-sell cliches.",
    tunables: [
      { key: "adStyle", label: "Ad energy?", options: ["cinematic premium", "fast social cut", "soft lifestyle"] },
      { key: "cta", label: "How should it end?", options: ["shop now", "link in bio", "brand logo only"] },
    ],
    pipeline: "generate",
  },
  {
    id: "absurd", name: "Absurd",
    blurb: "Out-of-this-world visuals played completely straight, impossible and unforgettable.",
    // reactionGrok is news-commentary's card — reusing it here duplicated
    // that card exactly and doesn't match this format's surreal premise.
    // Free stock surreal-dance clip instead (see STOCK_SAMPLE comment).
    exampleClipUrls: [STOCK_SAMPLE.surrealDance], durationSec: D(5, 30, 10),
    engines: ["grok-imagine-15", "gemini-omni"], voice: "none",
    promptTemplate:
      "A surreal ABSURD short about {topic}: ONE impossible element rendered with total photorealism inside an otherwise " +
      "ordinary scene (think: an albino crocodile perched calmly on a model's shoulder, a goldfish commuting in a tiny bus seat), " +
      "featuring {cast}. The impossible thing is visible within the FIRST second, treated as completely normal by everyone in frame. " +
      "Real-world physics, true-to-life textures and lighting on BOTH the ordinary scene and the impossible element, " +
      "{style} look, deadpan tone, no explanation ever given. One continuous take, ambient sound only. {durationSec}s.",
    scriptRecipe:
      "Invent ONE impossible-but-concrete visual pairing from the topic (a specific creature, object, or scale violation in a mundane setting), never generic weirdness. Hook = the impossible thing fully visible in second one. Scene beats play it perfectly straight: the person continues a normal activity while the absurd element behaves naturally. No dialogue, no explanation; an on-screen caption of 6 words or less may land the joke.",
    tunables: [
      { key: "flavor", label: "Flavor of absurd?", options: ["impossible animal companion", "wrong scale", "objects come alive", "gravity optional"] },
      { key: "straightness", label: "How deadpan?", options: ["nobody reacts at all", "one subtle glance", "mild chaos builds"] },
    ],
    pipeline: "generate",
  },
  {
    // id kept as "street-interview" for backward compat — agents that
    // already picked this format must keep resolving to a real catalog
    // entry. Content fully replaced per operator request: How To.
    id: "street-interview", name: "How To",
    blurb: "Clear step-by-step tutorial on your exact topic. States the steps, shows the result.",
    // reactionAlt (vox-pop street cuts) no longer matches this format's
    // demonstration/tutorial visual style — reassigned to Skit instead.
    // Free stock "shows how to use" demo clip instead (see STOCK_SAMPLE
    // comment) — a real step-by-step demonstration, matches this format.
    exampleClipUrls: [STOCK_SAMPLE.skincareHowTo], durationSec: D(15, 60, 30),
    engines: ["grok-imagine-15", "gemini-omni"], voice: "on-camera",
    promptTemplate:
      "A how-to short about {topic}: {cast} presents directly to camera, {tone} teaching energy in {language}, " +
      "states the goal in the first line, then walks through the EXACT steps to do it (numbered, in order, each step visually demonstrated or shown on screen where possible). " +
      "Desk or handheld framing, direct eye contact, clean simple cuts between steps, ends by showing the finished result and a {cta}. {durationSec}s total.",
    scriptRecipe:
      "Write {topic} as a numbered how-to: line one states exactly what the viewer will be able to do by the end, then 3-5 short concrete steps in the ORDER they're actually done (each step one clear action, no vague advice), close by naming the finished result and a soft CTA. Every step must be something a viewer could literally follow, never abstract tips.",
    tunables: [
      { key: "teachingStyle", label: "Teaching style?", options: ["quick tips", "step-by-step deep dive", "myth-busting"] },
      { key: "cta", label: "How should it end?", options: ["follow for more", "link in bio", "no CTA"] },
    ],
    pipeline: "generate",
  },
  {
    id: "motion-swap", name: "Motion Swap",
    blurb: "Your character performs a trending move from the reference library. Powered by Higgsfield Genjutsu.",
    // A finished Genjutsu render from the Higgsfield reference library (lib/explore).
    exampleClipUrls: ["https://d8j0ntlcm91z4.cloudfront.net/community-presets/7b8aebe7-9adb-420b-9211-9550cd29b113/edit.mp4"], durationSec: D(4, 15, 8),
    engines: ["hf-genjutsu"], voice: "none",
    promptTemplate: "Apply the chosen reference motion ({topic}) to {cast}. Keep the character's face, outfit and the original camera framing. Total length {durationSec}s.",
    tunables: [],
    pipeline: "generate",
  },
  {
    id: "clipper", name: "Clipper",
    blurb: "Cuts the sharpest, most shareable moments out of your longer source videos.",
    // Not shown in the wizard (WIZARD_FORMATS excludes "clipping" formats) —
    // kept for type completeness only.
    exampleClipUrls: [STOCK_SAMPLE.comedyMocking], durationSec: D(10, 90, 30),
    engines: [], voice: "none",
    promptTemplate: "", // clipping pipeline configures editing skills, not a prompt
    tunables: [],
    pipeline: "clipping",
  },
];

const byId = new Map(VIDEO_FORMATS.map((f) => [f.id, f] as const));

export function formatById(id: string): VideoFormat | undefined {
  return byId.get(id);
}

/** Clamp a requested duration into the format's band; undefined → the format's
 *  default; unknown format → 30s (a sane generate-pipeline middle). */
export function clampFormatDuration(id: string, sec: number | undefined): number {
  const f = byId.get(id);
  if (!f) return 30;
  if (sec === undefined || Number.isNaN(sec)) return f.durationSec.default;
  return Math.min(f.durationSec.max, Math.max(f.durationSec.min, Math.round(sec)));
}

/** Engine-specific floor for the wizard's length slider. Grok renders a single
 *  coherent take from 5s (cheap test renders); Gemini Omni's quality only
 *  holds from 10s up. Engines not listed fall back to the format's own min. */
export const ENGINE_MIN_SEC: Record<string, number> = {
  "grok-imagine-15": 5,
  "gemini-omni": 10,
};

/** Every wizard length slider tops out here — cost control for test runs. */
export const WIZARD_MAX_SEC = 30;

/** Slider bounds for the wizard's Step 3, given the format and the engine the
 *  operator picked in Step 2 (engine floor wins; everything caps at 30s). */
export function wizardDurationBounds(
  format: VideoFormat,
  engineId?: string,
): { min: number; max: number; step: number; default: number } {
  const engineMin = engineId ? ENGINE_MIN_SEC[engineId] : undefined;
  const min = Math.min(engineMin ?? format.durationSec.min, WIZARD_MAX_SEC);
  const max = Math.min(format.durationSec.max, WIZARD_MAX_SEC);
  return {
    min: Math.min(min, max),
    max,
    step: format.durationSec.step,
    default: Math.min(Math.max(format.durationSec.default, min), max),
  };
}

/** Clamp a wizard-chosen duration into the engine-aware band above — used by
 *  the draft→bible mapping so a 5s Grok test length survives the save instead
 *  of being clamped back up by the format's own band. */
export function clampWizardDuration(id: string, engineId: string | undefined, sec: number | undefined): number {
  const f = byId.get(id);
  if (!f) return 30;
  const b = wizardDurationBounds(f, engineId);
  if (sec === undefined || Number.isNaN(sec)) return b.default;
  return Math.min(b.max, Math.max(b.min, Math.round(sec)));
}

/** Formats whose identity depends on consistent characters — these must render
 *  image-to-video from a storyboard start frame (identity drifts from bare
 *  text starts; see spec "Storyboard + character reference plan"). */
const START_FRAME_FORMATS = new Set(["founder-talk", "news-commentary", "skit", "anime", "cartoon"]);

export function formatRequiresStartFrame(id: string): boolean {
  return START_FRAME_FORMATS.has(id) && byId.get(id)?.pipeline === "generate";
}
