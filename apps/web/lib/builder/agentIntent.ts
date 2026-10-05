/**
 * Which builder a free-text prompt belongs to. Every landing / home / studio
 * prompt box routes through this so "Clip this video: https://youtube.com/…"
 * can never open (and mint) an AI Influencer just because that box's default
 * tab was influencer.
 *
 * - "clipping"   — the prompt carries a video link (YouTube, TikTok, Drive,
 *                  Twitch, a direct .mp4 …) or asks to clip / cut / make
 *                  shorts out of footage.
 * - "influencer" — it asks for a persona / creator / face / UGC.
 * - null         — no signal; the caller keeps its own default.
 *
 * `strong` marks a clip request that should override even an explicit
 * `type=influencer` (a video link together with a clip verb).
 */
export type PromptAgentType = "clipping" | "influencer";

const VIDEO_LINK_RE =
  /https?:\/\/(?:[\w-]+\.)*(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com\/(?:reel|reels|p|tv)\/|vimeo\.com|twitch\.tv|kick\.com|rumble\.com|x\.com\/[^\s]+\/status|twitter\.com\/[^\s]+\/status|facebook\.com\/[^\s]*videos?|fb\.watch|drive\.google\.com|dropbox\.com|loom\.com)[^\s]*|https?:\/\/[^\s]+\.(?:mp4|mov|webm|mkv|m4v)(?:\?[^\s]*)?/i;

const CLIP_WORDS_RE =
  /\b(clip|clips|clipping|clipper|cut (?:it|this|them|into)|shorts?|reels? from|highlights?|repurpose|podcast clips?|stream clips?|viral moments?|9:16)\b/i;

const INFLUENCER_WORDS_RE =
  /\b(influencer|persona|creator|ai (?:model|girl|guy|avatar|character)|avatar|ugc|face|character|brand ambassador|spokesperson)\b/i;

export function inferAgentTypeFromPrompt(text: string | null | undefined): { type: PromptAgentType | null; strong: boolean } {
  const t = (text ?? "").trim();
  if (!t) return { type: null, strong: false };
  const hasLink = VIDEO_LINK_RE.test(t);
  const clipWords = CLIP_WORDS_RE.test(t);
  if (hasLink && clipWords) return { type: "clipping", strong: true };
  // A bare video link is a clip job — nobody pastes a YouTube URL to design a face.
  if (hasLink) return { type: "clipping", strong: false };
  const infWords = INFLUENCER_WORDS_RE.test(t);
  if (clipWords && !infWords) return { type: "clipping", strong: false };
  if (infWords && !clipWords) return { type: "influencer", strong: false };
  return { type: null, strong: false };
}

/** The builder URL a prompt box should open. The AI Clipper chat lives at
 *  /builder?type=clipping; the AI Influencer flow starts at /builder?type=influencer. */
export function builderHrefForPrompt(prompt: string, fallback: PromptAgentType, extra?: Record<string, string>): string {
  const q = prompt.trim();
  const type = inferAgentTypeFromPrompt(q).type ?? fallback;
  const params = new URLSearchParams({ type, ...(extra ?? {}) });
  if (q) params.set("q", q);
  return `/builder?${params.toString()}`;
}
