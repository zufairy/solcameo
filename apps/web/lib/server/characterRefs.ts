/**
 * Resolve up to 3 STATIC character reference images for Veo's REFERENCE_2_VIDEO
 * mode. The minted avatar set is generated as static PNGs; the avatarUrl may be
 * an animated GIF display variant that Veo can't lock onto well. We prefer the
 * statics so the rendered character matches the agent.
 */
const STATIC_RE = /\.(png|jpe?g|webp)(\?|#|$)/i;
const GIF_RE = /\.gif(\?|#|$)/i;
const HTTP_RE = /^https?:\/\//i;
import { isDeadMediaUrl } from "../deadMediaHosts";

export interface CharacterRefs {
  refs: string[];
  note?: string;
}

export function resolveCharacterRefs(avatarUrl: string, avatarUrls: string[] = []): CharacterRefs {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const u of [avatarUrl, ...avatarUrls]) {
    const url = (u ?? "").trim();
    if (!url || !HTTP_RE.test(url) || isDeadMediaUrl(url) || seen.has(url)) continue;
    seen.add(url);
    candidates.push(url);
  }

  const statics = candidates.filter((u) => STATIC_RE.test(u));
  if (statics.length > 0) return { refs: statics.slice(0, 3) };

  const gifs = candidates.filter((u) => GIF_RE.test(u));
  if (gifs.length > 0) {
    return {
      refs: [gifs[0]],
      note: "avatar is animated — set a static avatar for the tightest identity lock",
    };
  }

  if (candidates.length > 0) return { refs: candidates.slice(0, 3) };
  return { refs: [], note: "no reference image — identity may drift" };
}
