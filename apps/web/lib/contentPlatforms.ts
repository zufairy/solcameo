/** Pure browser-safe capability mapping. Keep unsupported targets out of a post. */
const text = new Set(["facebook", "linkedin", "x", "threads", "bluesky", "telegram", "discord", "google_business"]);
const photo = new Set([...text, "tiktok", "instagram", "pinterest"]);
const video = new Set([...photo].filter(p => p !== "google_business").concat("youtube"));
export function compatiblePlatforms(connected: string[], kind: string): string[] {
  const allowed = kind === "photo" ? photo : kind === "video" ? video : text;
  return [...new Set(connected)].filter(p => allowed.has(p));
}
