import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { selfOrigin } from "@/lib/server/selfOrigin";
import { writeViralCaption } from "@/lib/server/viralCaption";

export type AutoPostResult = { ok: true; caption: string } | { ok: false; caption?: string; error: string };

/** Write a viral caption, then publish the finished video to the agent's connected X account. */
export async function autoPostToX(opts: { mint: string; videoUrl: string; referenceTitle: string; scene?: string }): Promise<AutoPostResult> {
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!secret || !url) return { ok: false, error: "Posting is not configured." };
  const agent = await new ConvexHttpClient(url).query(api.influencers.getByMintServer, { mintAddress: opts.mint, authSecret: secret }).catch(() => null);
  if (!agent) return { ok: false, error: "Agent not found." };
  const caption = await writeViralCaption({ name: agent.name, niche: agent.niche ?? undefined, bio: (agent as { bio?: string }).bio, referenceTitle: opts.referenceTitle, scene: opts.scene });
  try {
    const res = await fetch(`${selfOrigin()}/api/social/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": secret },
      body: JSON.stringify({ username: opts.mint, platforms: ["x"], type: "video", title: caption, mediaUrls: [opts.videoUrl], captionLocked: true }),
      signal: AbortSignal.timeout(240_000),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) return { ok: false, caption, error: data.error || `Post failed (HTTP ${res.status})` };
    return { ok: true, caption };
  } catch (e) {
    return { ok: false, caption, error: e instanceof Error ? e.message : "Post failed" };
  }
}
