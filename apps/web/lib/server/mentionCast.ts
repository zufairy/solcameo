import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { castToken } from "@/lib/explore/castKey";
import { identityStills } from "./identityStill";

export type MentionHint = { token?: unknown; imageUrl?: unknown; mintAddress?: unknown };
export type ResolvedMention = { token: string; name: string; imageUrl: string; mintAddress?: string };

const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\/\S{1,2000}$/.test(u.trim());
let roster: { at: number; rows: { mintAddress: string; name: string }[] } | null = null;

async function loadRoster(convex: ConvexHttpClient) {
  if (roster && Date.now() - roster.at < 60_000) return roster.rows;
  const rows = (await convex.query(api.influencers.listSearchable, {}).catch(() => [])).map((a) => ({ mintAddress: a.mintAddress, name: a.name }));
  if (rows.length) roster = { at: Date.now(), rows };
  return rows;
}

/** A picture the engine can really fetch: reachable, an image, and not absurdly large. */
async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-1023" }, signal: AbortSignal.timeout(6000), cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    await res.body?.cancel().catch(() => undefined);
    return (res.ok || res.status === 206) && /^image\//i.test(type);
  } catch { return false; }
}

/**
 * The influencers tagged with @ in a prompt, each with a face the engine can read. The browser's list is only a hint: the
 * tags are read from the prompt itself, matched to the real influencer on the server (by the mint the browser sent, else
 * by name), and each one's minted still is preferred over its (often animated) profile picture. A picture that cannot
 * be fetched is skipped for the next candidate, so a tag never silently renders without its face.
 */
export async function resolveMentions(args: { prompt: string; hints?: unknown; excludeMint?: string; max?: number }): Promise<ResolvedMention[]> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return [];
  const convex = new ConvexHttpClient(url);
  const hints = (Array.isArray(args.hints) ? args.hints : []).map((h) => (h && typeof h === "object" ? h as MentionHint : {}));
  const wanted = new Map<string, string>(); // lowercase token -> token as typed
  for (const m of args.prompt.matchAll(/@([\w-]{1,40})/g)) if (!wanted.has(m[1].toLowerCase())) wanted.set(m[1].toLowerCase(), m[1]);
  const rows = await loadRoster(convex);
  const out: ResolvedMention[] = [];
  for (const [lower, token] of wanted) {
    if (out.length >= (args.max ?? 5)) break;
    const hint = hints.find((h) => typeof h.token === "string" && h.token.replace(/[^\w-]/g, "").toLowerCase() === lower);
    const hintMint = typeof hint?.mintAddress === "string" && /^[A-Za-z0-9_-]{3,120}$/.test(hint.mintAddress) ? hint.mintAddress : "";
    const mint = hintMint || rows.find((r) => castToken(r.name).toLowerCase() === lower)?.mintAddress || "";
    if (!mint || mint === args.excludeMint) continue;
    const doc = await convex.query(api.influencers.getByMint, { mintAddress: mint }).catch(() => null);
    if (!doc) continue;
    const candidates = [...(doc.avatarStills ?? []), doc.avatarUrl, hint?.imageUrl].filter(https).map((u) => u.trim());
    let chosen = "";
    for (const candidate of [...new Set(candidates)]) {
      const [still] = await identityStills([candidate], doc);
      if (still && (await reachable(still))) { chosen = still; break; }
    }
    if (!chosen) { console.warn(`[mentions] no usable picture for @${token} (${mint})`); continue; }
    out.push({ token, name: doc.name, imageUrl: chosen, mintAddress: mint });
  }
  return out;
}

/**
 * The cast of a Replicate render, kept in step with the prompt. The browser sends the images and the names in order; here
 * every @name the prompt uses is checked against the real influencer, so a tag the browser missed is added, and a
 * tag whose picture was an animated profile (or unreachable) gets its minted still. Names and images stay aligned, so
 * the "@Name = image N" key the engine reads is always right.
 */
export async function mergeCast(args: { prompt: string; castTokens: unknown; imageUrls: string[]; hints?: unknown; excludeMint?: string; max?: number }): Promise<{ imageUrls: string[]; castTokens: string[] }> {
  const max = args.max ?? 8;
  const images = args.imageUrls.slice(0, max);
  const tokens = (Array.isArray(args.castTokens) ? args.castTokens : []).map((t) => (typeof t === "string" ? t.replace(/[^\w-]/g, "").slice(0, 40) : "")).slice(0, images.length);
  while (tokens.length < images.length) tokens.push(`Photo${tokens.length + 1}`);
  const found = await resolveMentions({ prompt: args.prompt, hints: args.hints, excludeMint: args.excludeMint, max: 5 });
  for (const f of found) {
    const at = tokens.findIndex((t) => t.toLowerCase() === f.token.toLowerCase());
    if (at >= 0) images[at] = f.imageUrl;
    else if (images.length < max && !images.includes(f.imageUrl)) { images.push(f.imageUrl); tokens.push(f.token); }
  }
  return { imageUrls: images, castTokens: tokens };
}
