export type VideoTemplateFamily =
  | "cartoon_episode"
  | "comic_explainer"
  | "premium_brand"
  | "realistic_cinematic"
  | "ugc_handheld";

export interface VideoPromptStyleInput {
  voiceArchetype?: string;
  description?: string;
  format?: string;
  angle?: string;
  structureNotes?: string;
  visualTreatment?: string;
  characterBible?: string;
  agentArchetype?: string;
  niche?: string;
}

const POLISHED_RE = /\b(polished|premium|luxury|editorial|cinematic|studio|glossy|pristine|slick|airbrushed|beauty[- ]lit|high[- ]end|commercial|ad spot|advert)\b/i;
const CARTOON_RE = /\b(cartoon|cartoonish|animated|animation|anime|manga|episodic|episode|series|comic|storybook|cel[- ]?shaded|recurring cast)\b/i;
const COMIC_RE = /\b(comic|explainer|whiteboard|sketch|doodle|hand[- ]drawn|frame[- ]by[- ]frame|storyboard)\b/i;
const UGC_RE = /\b(ugc|handheld|selfie|phone|tiktok|reel|short[- ]form|vlog|camcorder|raw|casual|found footage|docu|documentary)\b/i;
const PREMIUM_RE = /\b(brand|product|campaign|launch|ad|commercial|promo|pitch|retail|hero shot)\b/i;
const REALISTIC_RE = /\b(realistic|photographic|filmic|cinematic|documentary|natural|live[- ]action)\b/i;

function normalizeBlob(input: VideoPromptStyleInput): string {
  return [
    input.voiceArchetype,
    input.description,
    input.format,
    input.angle,
    input.structureNotes,
    input.visualTreatment,
    input.characterBible,
    input.agentArchetype,
    input.niche,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyVideoTemplate(input: VideoPromptStyleInput): VideoTemplateFamily {
  const blob = normalizeBlob(input);
  if (CARTOON_RE.test(blob)) return "cartoon_episode";
  if (COMIC_RE.test(blob)) return "comic_explainer";
  if (UGC_RE.test(blob)) return "ugc_handheld";
  if (PREMIUM_RE.test(blob) || POLISHED_RE.test(blob) || REALISTIC_RE.test(blob)) {
    return POLISHED_RE.test(blob) ? "premium_brand" : "realistic_cinematic";
  }
  return "ugc_handheld";
}

function wantsPolishedLook(input: VideoPromptStyleInput): boolean {
  return POLISHED_RE.test(normalizeBlob(input));
}

function templateLine(template: VideoTemplateFamily): string {
  switch (template) {
    case "cartoon_episode":
      return "cartoon episode pacing with handcrafted timing, readable poses, and light line wobble";
    case "comic_explainer":
      return "comic explainer pacing with hand-made energy and simple readable motion";
    case "premium_brand":
      return "premium brand energy with a clean but still human feel";
    case "realistic_cinematic":
      return "realistic cinematic energy with tactile, lived-in detail";
    case "ugc_handheld":
    default:
      return "UGC handheld energy with a casual, intimate creator feel";
  }
}

function imperfectionLine(template: VideoTemplateFamily): string {
  switch (template) {
    case "cartoon_episode":
      return "slight frame jitter, tiny timing offsets, soft analog texture, and animation that feels made by hand";
    case "comic_explainer":
      return "slight sketch wobble, playful timing, and a hand-made feel instead of sterile polish";
    case "premium_brand":
      return "gentle handheld drift, soft film grain, and natural motion so it stays premium without looking airbrushed";
    case "realistic_cinematic":
      return "subtle handheld drift, mild film grain, natural motion blur, and slight focus breathing";
    case "ugc_handheld":
    default:
      return "slight camera shake, autofocus breathing, mild compression texture, and natural off-center framing";
  }
}

export function buildVideoStyleDirective(input: VideoPromptStyleInput): string {
  const template = classifyVideoTemplate(input);
  const polished = wantsPolishedLook(input);
  const base = polished
    ? "LOOK: polished and intentional, but still human and physically believable. Keep the scene premium, not plastic."
    : `LOOK: ${templateLine(template)}. Default to ${imperfectionLine(template)}. Do not over-smooth the image.`;

  const personaNotes = polished
    ? "This persona explicitly wants polish, so keep the camera and grade controlled and refined."
    : "Unless the persona explicitly asks for polish, keep the video imperfect, tactile, and human.";

  return [
    `STYLE TEMPLATE: ${template}`,
    base,
    personaNotes,
    template === "cartoon_episode"
      ? "For cartoon/episodic personas, keep the visuals stylized, the motion expressive, and the episode rhythm clear."
      : "Start each beat with a visible action first, then the setting, then the camera move, then the texture of the scene.",
    "Use the exact persona tone, but avoid over-processed polish unless requested in the persona.",
  ].join(" ");
}

