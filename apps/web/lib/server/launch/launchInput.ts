/**
 * Pure input handling for the public Launch funnel (/api/launch/start).
 * Kept free of server imports so it is unit-testable and shareable with the
 * landing hero's client-side validation.
 */

export type LaunchInput = { ok: true; websiteUrl: string; sourceUrl?: string } | { ok: false; error: string };

const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|x\.com|twitter\.com|facebook\.com|fb\.watch|vimeo\.com|twitch\.tv|spotify\.com|podcasts\.apple\.com|drive\.google\.com|loom\.com)$/i;

function normalizeHttpUrl(raw: string): URL | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    if (!host.includes(".") || host === "localhost" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return null;
    return u;
  } catch {
    return null;
  }
}

export function parseLaunchInput(body: unknown): LaunchInput {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const website = normalizeHttpUrl(String(b.websiteUrl ?? ""));
  if (!website) return { ok: false, error: "Paste your website URL first." };
  const sourceRaw = String(b.sourceUrl ?? "").trim();
  if (!sourceRaw) return { ok: true, websiteUrl: website.toString() };
  const source = normalizeHttpUrl(sourceRaw);
  if (!source || !VIDEO_HOSTS.test(source.hostname)) {
    return { ok: false, error: "The long-form link must be a YouTube, podcast, TikTok, Instagram, X, Drive or Loom URL." };
  }
  return { ok: true, websiteUrl: website.toString(), sourceUrl: source.toString() };
}

/** Handle rules shared with the mint route's deriveHandle: [a-z0-9_], 3..24. */
export function sanitizeHandle(raw: string, fallback: string): string {
  const cleaned = raw.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
  return cleaned.length >= 3 ? cleaned : fallback;
}

/** Agent identity when the analyzer returns none: the site's domain stem. */
export function fallbackIdentity(websiteUrl: string): { agentName: string; handle: string } {
  const u = normalizeHttpUrl(websiteUrl);
  if (!u) return { agentName: "New Agent", handle: "new_agent_vello" };
  const stem = u.hostname.replace(/^www\./i, "").split(".")[0] || "agent";
  const agentName = stem.charAt(0).toUpperCase() + stem.slice(1);
  return { agentName, handle: `${sanitizeHandle(stem, "new_agent")}_vello` };
}
