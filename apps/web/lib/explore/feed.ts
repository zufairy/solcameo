export interface ReferenceVideo {
  id: string;
  title: string;
  description: string;
  previewUrl: string;
  demoUrl?: string;
  width?: number;
  height?: number;
  thumbUrl?: string;
  videoUrl: string;
  duration: number;
  category: string;
  /** Public showcase attribution and an editable scene adapted for Cameo. */
  sourceName?: string;
  sourceUrl?: string;
  prompt?: string;
  preferredModel?: string;
}
export const FEED = "https://cms.higgsfield.ai/higgsfield-multiplier/video-explore/v2";
export const CATEGORIES = ["All", "Dance", "Performance", "Lifestyle", "Action", "Other"];
const https = (url: unknown): url is string => typeof url === "string" && /^https:\/\//.test(url);
export function normalizeFeed(data: unknown): { items: ReferenceVideo[]; next: number | null; total: number } {
  if (!data || typeof data !== "object") return { items: [], next: null, total: 0 };
  const feed = data as { items?: Array<{ id?: string; title?: string; description?: string; original_video?: { url?: string; duration?: number; width?: number; height?: number; media_type?: string; thumbnail_url?: string }; variants?: Array<{ type?: string; media?: { url?: string; duration?: number; width?: number; height?: number; media_type?: string; thumbnail_url?: string } }> }>; cursor?: number; total?: number };
  const items: ReferenceVideo[] = [];
  for (const item of Array.isArray(feed.items) ? feed.items : []) {
    if (!item || typeof item !== "object") continue;
    const variants = Array.isArray(item.variants) ? item.variants : [];
    const src = item.original_video ?? variants.find(v => v?.type === "original")?.media;
    if (src?.media_type && src.media_type !== "video_input") continue;
    if (!item.id || !https(src?.url) || !Number.isFinite(src.duration) || Number(src.duration) < 4) continue;
    const preview = variants.find(v => v?.type === "edit")?.media;
    const words = `${item.title ?? ""} ${item.description ?? ""}`;
    const category = /danc|choreo|twerk/i.test(words) ? "Dance" : /sing|rap|perform|microphone|lip.sync/i.test(words) ? "Performance" : /fight|punch|kick|sport|run|jump/i.test(words) ? "Action" : /walk|fashion|outfit|selfie|pose|lifestyle/i.test(words) ? "Lifestyle" : "Other";
    items.push({ id: item.id, title: item.title || "Motion reference", description: item.description || "", previewUrl: src.url, demoUrl: https(preview?.url) ? preview.url : undefined, thumbUrl: https(src.thumbnail_url) ? src.thumbnail_url : undefined, videoUrl: src.url, width: src.width, height: src.height, duration: Number(src.duration), category });
  }
  return { items, next: typeof feed.cursor === "number" && Number.isFinite(feed.cursor) ? feed.cursor : null, total: Number(feed.total) || 0 };
}
