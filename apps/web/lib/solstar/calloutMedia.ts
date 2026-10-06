export type CalloutAttachment = { url: string; type: "image" | "gif"; alt: string };
export const CALLOUT_MEDIA_LIMIT = 4;
export const CALLOUT_UPLOAD_BYTES = 8 * 1024 * 1024;
export function isCalloutAttachment(value: unknown): value is CalloutAttachment {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  if ((a.type !== "image" && a.type !== "gif") || typeof a.alt !== "string" || a.alt.length > 160 || typeof a.url !== "string" || a.url.length > 2048) return false;
  try { const u = new URL(a.url); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}
export function isGiphyUrl(url: string) {
  try { const u = new URL(url); return u.protocol === "https:" && /^(media\d*|i)\.giphy\.com$/.test(u.hostname) && u.pathname.endsWith(".gif"); } catch { return false; }
}
/** Small, searchable reaction library also available without an API key. */
export const CALLOUT_GIFS = [
  { url: "https://media.giphy.com/media/111ebonMs90YLu/giphy.gif", type: "gif", alt: "Thumbs up", tags: "yes agree great win" },
  { url: "https://media.giphy.com/media/g9582DNuQppxC/giphy.gif", type: "gif", alt: "Cheers", tags: "celebrate win cheers profit" },
  { url: "https://media.giphy.com/media/nrXif9YExO9EI/giphy.gif", type: "gif", alt: "This is fine", tags: "loss fire fine panic" },
  { url: "https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif", type: "gif", alt: "Mind blown", tags: "excited wow surprise win" },
  { url: "https://media.giphy.com/media/13HgwGsXF0aiGY/giphy.gif", type: "gif", alt: "Working hard", tags: "work trading computer busy" },
  { url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif", type: "gif", alt: "Applause", tags: "clap applause congratulations win" },
] satisfies Array<CalloutAttachment & { tags: string }>;
