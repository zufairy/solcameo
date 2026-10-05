import { UPLOAD_POST_PLATFORMS } from "./uploadPost";

export function normalizePlatform(platform: string): string {
  const lower = platform.toLowerCase();
  return lower === "twitter" ? "x" : lower;
}

export function inferContentType(
  explicit: string | undefined,
  mediaUrls: string[],
): "text" | "photo" | "video" {
  if (explicit && ["text", "photo", "video"].includes(explicit)) {
    return explicit as "text" | "photo" | "video";
  }
  if (!mediaUrls.length) return "text";
  return /\.(mp4|mov|webm|m4v|avi)(\?|#|$)/i.test(mediaUrls[0]) ? "video" : "photo";
}

export function planSocialTargets(opts: {
  requested: string[];
  connected: string[];
  contentType: "text" | "photo" | "video";
}): { targets: string[]; skipped: string[] } {
  const { requested, connected, contentType } = opts;
  const supports = (id: string) =>
    UPLOAD_POST_PLATFORMS.find((p) => p.id === id)?.[contentType] ?? false;
  const pool = requested.length ? requested.filter((id) => connected.includes(id)) : connected;
  const targets = pool.filter((id) => supports(id));
  const fullPool = requested.length ? requested : connected;
  const skipped = fullPool.filter((id) => !targets.includes(id));
  return { targets, skipped };
}
