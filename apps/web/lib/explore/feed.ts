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
  /** Feed page this item came from, so the server can re-find it when it isn't in the bundled index. */
  page?: number;
}
export const FEED = "https://cms.higgsfield.ai/higgsfield-multiplier/video-explore/v2";
export const CATEGORIES = ["All", "Trending", "Movie", "Crypto", "Dance", "Performance", "Music", "Comedy", "Sports", "Fashion", "Action", "Lifestyle", "Other"];
/** How many of the feed's top (trending-sorted) references count as "Trending". */
export const TRENDING_TOP = 150;
/** Topic tags found in a reference's title and description. The feed carries no tags, so these are matched from the text. */
const TOPICS: ReadonlyArray<readonly [string, RegExp]> = [
  ["Movie", /\b(movie|film|cinema|cinematic|trailer|blockbuster|hollywood|actor|actress|superhero|villain|noir|detective|western|horror|sci-?fi|monster|spy|thriller|wizard|vampire|zombie|samurai|battle scene|epic)\b/i],
  ["Crypto", /\b(crypto|bitcoin|btc|ethereum|eth|solana|sol|memecoin|meme coin|token|blockchain|nft|trader|trading|to the moon|pump|hodl|web3|airdrop|binance|coinbase)\b/i],
  ["Music", /\b(music|guitar|piano|drum|drummer|dj|singer|singing|concert|band|violin|saxophone|rapper|rap|karaoke)\b/i],
  ["Comedy", /\b(funny|comed(y|ian)|meme|prank|joke|laugh|skit|reaction|awkward|silly)\b/i],
  ["Sports", /\b(sport|soccer|football|basketball|boxing|boxer|gym|workout|fitness|skate|skateboard|surf|tennis|athlete|yoga|parkour|golf|baseball|mma)\b/i],
  ["Fashion", /\b(fashion|runway|catwalk|outfit|makeup|beauty|streetwear|couture|lookbook|dress)\b/i],
];
export function topicsOf(item: { title?: string; description?: string }): string[] {
  const text = `${item.title ?? ""} ${item.description ?? ""}`;
  return TOPICS.filter(([, re]) => re.test(text)).map(([name]) => name);
}
/** Whether a reference belongs to a category tab. "Trending" is positional, so the caller passes its rank (0 = top). */
export function inCategory(item: { title?: string; description?: string; category?: string }, category: string, rank?: number): boolean {
  if (category === "All") return true;
  if (category === "Trending") return rank === undefined || rank < TRENDING_TOP;
  return item.category === category || topicsOf(item).includes(category);
}
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
