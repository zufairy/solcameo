export interface VideoStyleDef {
  id: string;
  label: string;
  icon: string;          // emoji for the UI
  description: string;
  format: string;        // → brief.format
  angle: string;         // → brief.angle (default; a hook may override)
  structureNotes: string;// → brief.structureNotes
  visualTreatment: string;// → brief.visualTreatment (merged downstream)
}

export interface Fragment { id: string; label: string; icon?: string; fragment: string; }

export const VIDEO_STYLES: VideoStyleDef[] = [
  { id: "talking_head", label: "Talking Head", icon: "🗣️",
    description: "Creator speaks directly to camera.",
    format: "talking-head", angle: "direct address",
    structureNotes: "Creator on camera speaking to the viewer; tight framing.",
    visualTreatment: "single subject to-camera, eye contact, clean background" },
  { id: "commercial", label: "Commercial", icon: "🎬",
    description: "Polished TV-style product ad with a clear sell.",
    format: "commercial spot", angle: "product benefit",
    structureNotes: "TV-ad beats: hook on the aspiration/problem → product as the hero → benefit payoff → crisp CTA. Copy is punchy VOICEOVER narration, not a to-camera monologue.",
    visualTreatment: "premium TV-commercial look — glossy product hero shots, dynamic quick cuts, sweeping camera moves, aspirational lifestyle vignettes, beauty-lit macro close-ups, high-end color grade; voiceover-driven, NOT a talking-head to camera" },
  { id: "ootd", label: "OOTD", icon: "👗",
    description: "Outfit / styling showcase.",
    format: "outfit showcase", angle: "style reveal",
    structureNotes: "Show the look from multiple angles; styling call-outs.",
    visualTreatment: "fashion framing, full-body + detail shots, mirror/turn reveals" },
  { id: "vlog", label: "Vlog / Day-in-life", icon: "📹",
    description: "Lifestyle b-roll with narration.",
    format: "vlog", angle: "day-in-the-life",
    structureNotes: "Loose narrative across moments; voiceover over b-roll.",
    visualTreatment: "handheld b-roll, candid moments, natural light" },
  { id: "tutorial", label: "Tutorial", icon: "📚",
    description: "Step-by-step how-to.",
    format: "tutorial", angle: "how-to",
    structureNotes: "Numbered steps; each beat is one clear step.",
    visualTreatment: "demonstrative close-ups, on-screen step framing" },
  { id: "ugc_review", label: "UGC Review", icon: "📦",
    description: "Authentic unboxing / review.",
    format: "ugc review", angle: "honest review",
    structureNotes: "First-person reaction, unbox, try, verdict.",
    visualTreatment: "authentic selfie-style, real hands-on product, natural setting" },
  { id: "cinematic_broll", label: "Cinematic B-roll", icon: "🎞️",
    description: "Atmospheric, minimal talking.",
    format: "cinematic b-roll", angle: "mood piece",
    structureNotes: "Few or no spoken words; let visuals + captions carry it.",
    visualTreatment: "cinematic slow-motion, shallow depth of field, moody grade" },
  { id: "asmr", label: "ASMR", icon: "🤫",
    description: "Satisfying, sound-led.",
    format: "asmr", angle: "sensory",
    structureNotes: "Slow, satisfying actions; minimal speech.",
    visualTreatment: "macro close-ups, tactile detail, soft lighting" },
];

export const HOOK_STYLES: Fragment[] = [
  { id: "question", label: "Question", fragment: "open with a provocative question the viewer wants answered" },
  { id: "bold_claim", label: "Bold claim", fragment: "open with a bold, scroll-stopping claim" },
  { id: "pattern_interrupt", label: "Pattern interrupt", fragment: "open with an unexpected visual/line that breaks the scroll" },
  { id: "story", label: "Story", fragment: "open mid-story at a tense moment" },
  { id: "stat", label: "Stat", fragment: "open with a surprising statistic or number" },
  { id: "problem_solution", label: "Problem→Solution", fragment: "open by naming the viewer's problem, then promise the fix" },
];

export const SETTINGS: Fragment[] = [
  { id: "studio", label: "Studio", fragment: "clean studio backdrop" },
  { id: "home", label: "Home", fragment: "cozy home interior" },
  { id: "outdoor", label: "Outdoor / Urban", fragment: "urban street / outdoor city setting" },
  { id: "nature", label: "Nature", fragment: "natural outdoor landscape" },
  { id: "cafe", label: "Cafe", fragment: "warm cafe / lifestyle setting" },
  { id: "abstract", label: "Abstract set", fragment: "stylized abstract set with bold colors" },
];

export const MOODS: Fragment[] = [
  { id: "upbeat", label: "Upbeat", fragment: "upbeat, energetic mood" },
  { id: "aspirational", label: "Aspirational", fragment: "aspirational, premium mood" },
  { id: "edgy", label: "Edgy", fragment: "edgy, bold mood" },
  { id: "cozy", label: "Cozy", fragment: "warm, cozy, intimate mood" },
  { id: "luxe", label: "Luxe", fragment: "luxurious, high-end mood" },
];

export const CAMERA_STYLES: Fragment[] = [
  { id: "ugc_handheld", label: "UGC handheld", fragment: "handheld UGC camera movement" },
  { id: "tripod", label: "Clean tripod", fragment: "stable tripod framing" },
  { id: "cinematic", label: "Cinematic gimbal", fragment: "smooth cinematic gimbal moves" },
  { id: "selfie", label: "Selfie", fragment: "front-facing selfie framing" },
];

export const COLOR_GRADES: Fragment[] = [
  { id: "natural", label: "Natural", fragment: "natural true-to-life color" },
  { id: "warm", label: "Warm", fragment: "warm golden color grade" },
  { id: "vibrant", label: "Vibrant", fragment: "punchy saturated color grade" },
  { id: "moody", label: "Moody film", fragment: "moody cinematic film grade" },
  { id: "clean_bright", label: "Clean bright", fragment: "bright clean high-key look" },
];

export function getStyle(id: string): VideoStyleDef | undefined {
  return VIDEO_STYLES.find((s) => s.id === id);
}

export function getFragment(reg: Fragment[], id: string): Fragment | undefined {
  return reg.find((f) => f.id === id);
}
