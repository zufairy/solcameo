import { mediaPackBase } from "@/lib/server/mediaPackBase";
// Curated, BUNDLED gameplay backgrounds for the brain-rot composite skill
// (clip.brainrot). Each entry names a background; the actual mp4 must be hosted
// at GAMEPLAY_PACK_BASE_URL/<id>.mp4 and that env var set for compositing to
// produce real output. With no base URL set, gameplayUrl() returns "" — the
// catalog floor then emits NO composite_bg op (the render is unchanged), so the
// feature degrades gracefully instead of pointing ffmpeg at a missing input.

export interface GameplayPackEntry {
  /** Stable id the inspector stores as config.bgId; also the mp4 filename stem. */
  id: string;
  /** Human label for the inspector dropdown. */
  label: string;
  /** Resolved absolute URL of the gameplay mp4, or "" when the base env is unset. */
  url: string;
}

/** Filename for each pack id at the hosting base. Kept as a map (not just
 *  `${id}.mp4`) so a future rename of the public file doesn't churn the id. */
const PACK_FILES: Record<string, { label: string; file: string }> = {
  "subway-surfers": { label: "Subway Surfers", file: "SubwaySurfer.mp4" },
  "minecraft": { label: "Minecraft Parkour", file: "Minecraft.mp4" },
  "minecraft-2": { label: "Minecraft Parkour 2", file: "Minecraft2.mp4" },
  "gta-ramps": { label: "GTA Ramps", file: "GTA5Ramps.mp4" },
  "gta-ramps-2": { label: "GTA Ramps 2", file: "GTAramp2.mp4" },
  "surfing": { label: "Surfing", file: "Surfing.mp4" },
};

/** Join the env base with a filename, tolerating a trailing slash on the base.
 *  Returns "" when no base is configured (caller treats that as "unavailable"). */
function joinBase(file: string): string {
  const base = mediaPackBase("GAMEPLAY_PACK_BASE_URL", "gameplay");
  if (!base) return "";
  return `${base.replace(/\/+$/, "")}/${file}`;
}

/** Resolved URL for a gameplay pack id, or "" if the id is unknown or the base
 *  env is unset. */
export function gameplayUrl(id: string): string {
  const entry = PACK_FILES[id];
  if (!entry) return "";
  return joinBase(entry.file);
}

/** The full pack, with each url resolved against GAMEPLAY_PACK_BASE_URL (or ""). */
export const GAMEPLAY_PACK: GameplayPackEntry[] = Object.entries(PACK_FILES).map(
  ([id, { label, file }]) => ({ id, label, url: joinBase(file) }),
);

/** Stable list of pack ids — the inspector's bgId dropdown values. */
export const GAMEPLAY_PACK_IDS = Object.keys(PACK_FILES);

/** Default background when the inspector hasn't picked one. */
export const DEFAULT_GAMEPLAY_ID = "subway-surfers";

/** Sentinel bgId the inspector stores for "rotate the pool". */
export const RANDOM_GAMEPLAY_ID = "random";

/** Deterministically pick a pack id from a seed (e.g. the clip's start time *1000)
 *  so a multi-clip run ROTATES through the pool without Math.random (the floor must
 *  stay pure). Each clip gets a different but stable background. */
export function randomGameplayId(seed: number): string {
  const ids = GAMEPLAY_PACK_IDS;
  if (ids.length === 0) return DEFAULT_GAMEPLAY_ID;
  const i = Math.abs(Math.floor(Number.isFinite(seed) ? seed : 0)) % ids.length;
  return ids[i] ?? DEFAULT_GAMEPLAY_ID;
}
