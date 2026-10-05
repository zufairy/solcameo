// Single source of truth for skill ICONS shared between the App Store
// (marketplace-panel) and the canvas node cards (node-visual), so a skill shows
// the EXACT same logo in both places. Icons come from Iconify's
// "fluent-emoji-flat" set, served as plain SVGs over https (no next/image domain
// config needed). Keyed by SKILL ID; anything unmapped falls back to the skill's
// emoji glyph via EMOJI_ICON, so a new skill never renders blank.

export const SKILL_ICON: Record<string, string> = {
  "clip.captions": "speech-balloon",
  "clip.captionstyle": "writing-hand",
  "clip.keywords": "light-bulb",
  "clip.title": "newspaper",
  "clip.hook": "hook",
  "clip.cta": "clapper-board",
  "clip.meme": "fire",
  "clip.sticker": "star-struck",
  "clip.zoom": "magnifying-glass-tilted-left",
  "clip.speed": "high-voltage",
  "clip.fillercut": "scissors",
  "clip.facetrack": "bullseye",
  "clip.filters": "artist-palette",
  "clip.brainrot": "brain",
  "clip.memeaudio": "loudspeaker",
  "clip.trendingaudio": "musical-notes",
  "clip.transitions": "film-frames",
  "clip.campaignscout": "magnifying-glass-tilted-right",
  "clip.prompt": "speaking-head",
  "clip.guardrails": "shield",
  "clip.hookvideos": "clapper-board",
  "clip.maincontent": "film-frames",
  "video.hookvideos": "clapper-board",
  "video.maincontent": "film-frames",
  "video.series": "clapper-board",
  "video.imageposts": "framed-picture",
  "video.guardrails": "shield",
  "clip.carouselbuilder": "framed-picture",
};

// Emoji → icon fallback (covers any skill not explicitly mapped above).
export const EMOJI_ICON: Record<string, string> = {
  "💬": "speech-balloon", "🎬": "clapper-board", "🔍": "magnifying-glass-tilted-left",
  "🔥": "fire", "⚡": "high-voltage", "🪝": "hook", "✍️": "writing-hand", "✍": "writing-hand",
  "💡": "light-bulb", "✂️": "scissors", "✂": "scissors", "🎯": "bullseye", "🎨": "artist-palette",
  "✨": "sparkles", "🧠": "brain", "🔊": "loudspeaker", "🎵": "musical-notes",
  "🔎": "magnifying-glass-tilted-right", "🗣️": "speaking-head", "🎞️": "film-frames",
  "🛡️": "shield", "🛡": "shield", "📼": "film-frames",
};

export const iconifyUrl = (name: string) =>
  `https://api.iconify.design/fluent-emoji-flat/${name}.svg?width=128&height=128`;

/** Resolve a skill's icon name from its id (preferred) or emoji glyph fallback. */
export const skillIconName = (skillId?: string, emoji?: string): string | undefined =>
  (skillId ? SKILL_ICON[skillId] : undefined) ?? (emoji ? EMOJI_ICON[emoji] : undefined);
