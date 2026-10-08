import { ensureStaticFace } from "./staticFace";

const isStillUrl = (u: unknown): u is string => typeof u === "string" && /^https:\/\//i.test(u) && !/\.gif(\?|#|$)/i.test(u);

/**
 * The face an engine should be given. Agent avatars are often animated GIFs, which Kie and Higgsfield cannot read (the
 * render then ignores the face and invents one). The agent's own minted still wins when the URL is its avatar; any other
 * GIF (a tagged influencer's, a cameo's) is cut down to its first frame. Static images pass through untouched, and a
 * failed extraction keeps the original so a render is never blocked by it.
 */
export async function identityStills(urls: string[], agent?: { avatarUrl?: string | null; avatarStills?: string[] | null } | null): Promise<string[]> {
  const own = agent?.avatarStills?.find(isStillUrl);
  return Promise.all(urls.map(async (url) => {
    if (own && agent?.avatarUrl && url === agent.avatarUrl) return own;
    if (isStillUrl(url)) return url;
    const face = await ensureStaticFace(url).catch(() => ({ url }));
    return face.url && isStillUrl(face.url) ? face.url : url;
  }));
}
