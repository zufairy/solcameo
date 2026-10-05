import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireAuth } from "@/lib/server/requireAuth";
import { getComments, resolveUsername, isConfigured, COMMENTABLE_PLATFORMS } from "@/lib/server/uploadPost";

export const runtime = "nodejs";
export const maxDuration = 30;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

// How many of the caller's most-recent posted videos to pull comments for —
// there's no "all comments" endpoint, only per-post, so this bounds the fan-out.
// Raised from 25: a post's visible permalink is routinely null for a while
// after an async publish (Instagram etc — see pickCorrelatedPermalink), so
// scanning more posts is what actually surfaces comments, not a bigger cap
// on the fetch below.
const RECENT_POSTS_LIMIT = 60;
const CONCURRENCY = 8;

type CommentRow = {
  id: string;
  text: string;
  timestamp: string;
  username: string;
  platform: string;
  mintAddress: string;
  agentName: string;
  postUrl: string | null;
};

// Comments churn slowly enough that a short server-side cache avoids hammering
// upload-post on every client poll (multiple browser tabs / fast refreshes) —
// keyed on the caller's own mint set, so it never leaks across accounts. Short
// on purpose: opening/reloading the page should read as a real re-sync, not a
// stale snapshot from someone else's tab a few seconds ago.
const CACHE_TTL_MS = 8_000;
const cache = new Map<string, { at: number; rows: CommentRow[] }>();

export async function GET(req: NextRequest) {
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  if (!isConfigured()) return NextResponse.json({ ok: true, configured: false, comments: [] });

  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const wallets = (auth.user.walletAddresses ?? []).filter(Boolean);
  if (wallets.length === 0) return NextResponse.json({ ok: true, configured: true, comments: [] });

  const convex = new ConvexHttpClient(CONVEX_URL);
  const agents = (await convex
    .query(api.influencers.listByCreators, { creatorWallets: wallets })
    .catch(() => [])) as Array<{ mintAddress: string; name: string }>;
  if (agents.length === 0) return NextResponse.json({ ok: true, configured: true, comments: [] });

  const mintAddresses = [...new Set(agents.map((a) => a.mintAddress))];
  const cacheKey = mintAddresses.sort().join(",");
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ok: true, configured: true, comments: cached.rows });
  }

  const nameByMint = new Map(agents.map((a) => [a.mintAddress, a.name]));
  const feed = (await convex
    .query(api.clipJobs.videoFeedByMints, { mintAddresses })
    .catch(() => ({ items: [] }))) as {
    items: Array<{
      mint: string; platform?: string; postUrl: string | null; platformPostId: string | null;
      state: string; createdAt: number;
    }>;
  };

  // A post only needs SOME durable handle on the live post — the visible
  // permalink (postUrl) OR the native platform post id (platformPostId).
  // Requiring postUrl alone was the bug: it's null for a real, live,
  // commentable post whenever the async-publish correlation hasn't landed
  // yet, which silently dropped most/all eligible posts on some accounts.
  const posts = feed.items
    .filter((v) =>
      v.state === "posted" &&
      v.platform &&
      COMMENTABLE_PLATFORMS.includes(v.platform) &&
      (v.postUrl || v.platformPostId),
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, RECENT_POSTS_LIMIT);

  const rows: CommentRow[] = [];
  for (let i = 0; i < posts.length; i += CONCURRENCY) {
    const batch = posts.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (post) => {
        const username = resolveUsername(post.mint);
        if (!username || !post.platform) return [] as CommentRow[];
        const comments = await getComments(username, post.platform, { postUrl: post.postUrl, postId: post.platformPostId });
        return comments.map((c) => ({
          ...c,
          platform: post.platform!,
          mintAddress: post.mint,
          agentName: nameByMint.get(post.mint) ?? "Agent",
          postUrl: post.postUrl,
        }));
      }),
    );
    for (const r of results) rows.push(...r);
  }

  // De-dupe: the same live comment can be reachable from more than one scanned
  // post row (e.g. a re-synced clip entry) — key on platform+id, not just id,
  // since ids aren't guaranteed globally unique across platforms.
  const dedup = new Map<string, CommentRow>();
  for (const r of rows) dedup.set(`${r.platform}:${r.id}`, r);
  const merged = [...dedup.values()].sort((a, b) => Date.parse(b.timestamp || "0") - Date.parse(a.timestamp || "0"));
  const capped = merged.slice(0, 60);
  cache.set(cacheKey, { at: Date.now(), rows: capped });

  return NextResponse.json({ ok: true, configured: true, comments: capped });
}
