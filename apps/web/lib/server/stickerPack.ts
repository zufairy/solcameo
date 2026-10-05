import { mediaPackBase } from "@/lib/server/mediaPackBase";
// Curated face STICKERS for the Gen Z sticker skill (image_overlay position:"face").
// Each PNG is hosted at STICKER_BASE_URL/<file> (or the app's own Supabase bucket,
// via mediaPackBase's fallback); with neither configured, stickerUrl() returns ""
// and the caller drops the op — same graceful-degrade shape as trendingAudioPack
// and reactionSfxPack.

const STICKER_FILES: Record<string, { label: string; file: string }> = {
  "pout-lips": { label: "Pout Lips", file: "pout-lips.png" },
  "dog-ears": { label: "Dog Ears", file: "dog-ears.png" },
  "duck-face": { label: "Duck Face", file: "duck-face.png" },
};

function joinBase(file: string): string {
  const base = mediaPackBase("STICKER_BASE_URL", "stickers");
  if (!base) return "";
  return `${base.replace(/\/+$/, "")}/${file}`;
}

/** Resolved URL for a sticker id, or "" if unknown / the base env is unset. */
export function stickerUrl(id: string): string {
  const entry = STICKER_FILES[id];
  if (!entry) return "";
  return joinBase(entry.file);
}

export const STICKER_IDS = Object.keys(STICKER_FILES);
export const DEFAULT_STICKER_ID = "pout-lips";
export const isStickerId = (id: unknown): id is string => typeof id === "string" && id in STICKER_FILES;
