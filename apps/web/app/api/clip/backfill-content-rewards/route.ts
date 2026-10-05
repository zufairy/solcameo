import { NextRequest, NextResponse } from "next/server";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { getContentRewards } from "@/lib/content-rewards";
import { resolveCampaignSources } from "@/lib/server/campaignSources";

/**
 * Warm the shared transcript cache for Stage clipping campaigns so the first
 * real clip run is instant. SECRET-GATED (X-Internal-Secret === INTERNAL_CRON_SECRET).
 *
 * For each reward this resolves its clippable video URLs (same logic as
 * /api/clip/campaign-sources), caps to N, and POSTs each to
 * /api/video/transcribe-clip with { sourceUrl, campaignSource: true,
 * contentRewardId } and the internal secret — so transcribe-clip's internal
 * auth passes AND `campaignSource:true` makes the row CACHE. Idempotent: a
 * second run hits the cache (returns `cached: true`) and re-transcribes nothing.
 *
 * Modes:
 *   ?rewardId=<id>  → one reward (the test path)
 *   (no param)      → all active `type === "clipping"` content_rewards.
 *
 * HONEST PREREQS (otherwise this "works" but caches nothing):
 *   - GOOGLE_DRIVE_API_KEY (or GOOGLE_SERVICE_ACCOUNT_JSON) — REQUIRED to expand
 *     Drive FOLDERS; without it listDriveFolderVideos returns [] and folder-only
 *     rewards yield zero videos (reported as videos:0).
 *   - ELEVENLABS_API_KEY or KIE_API_KEY — transcribe-clip 503s without an STT key.
 *   - INTERNAL_CRON_SECRET — gates THIS route and the internal hop to transcribe-clip.
 *   - SUPABASE_SERVICE_ROLE_KEY is NOT needed here (read-only); only the anon
 *     NEXT_PUBLIC_SUPABASE_* config is required to read the reward.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

// Per-reward video cap — matches the pipeline's sources.slice(0,3).
const MAX_VIDEOS_PER_REWARD = 3;

interface VideoResult {
  rewardId: string;
  url: string;
  name: string;
  status: "cached" | "ok" | "error";
  error?: string;
}

export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";

  const origin = (() => {
    try {
      return new URL(req.url).origin;
    } catch {
      return process.env.NEXT_PUBLIC_APP_URL ?? "";
    }
  })();

  const rewardId = (req.nextUrl.searchParams.get("rewardId") ?? "").trim();

  // Resolve the reward id(s) to process.
  let rewardIds: string[];
  if (rewardId) {
    rewardIds = [rewardId];
  } else {
    const rewards = await getContentRewards();
    rewardIds = rewards.filter((r) => r.type === "clipping").map((r) => r.id);
  }

  const results: VideoResult[] = [];
  let rewardsProcessed = 0;
  let videosFound = 0;

  for (const id of rewardIds) {
    const resolved = await resolveCampaignSources(id);
    if (!resolved) {
      results.push({ rewardId: id, url: "", name: "", status: "error", error: "reward not found" });
      continue;
    }
    rewardsProcessed += 1;
    const videos = resolved.videos.slice(0, MAX_VIDEOS_PER_REWARD);
    videosFound += videos.length;

    for (const video of videos) {
      try {
        const r = await fetch(`${origin}/api/video/transcribe-clip`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(secret ? { "X-Internal-Secret": secret } : {}),
          },
          body: JSON.stringify({
            sourceUrl: video.url,
            campaignSource: true,
            contentRewardId: resolved.contentRewardId,
          }),
        });
        const data = (await r.json().catch(() => ({}))) as { ok?: boolean; cached?: boolean; error?: string };
        if (!r.ok || data.ok === false) {
          results.push({ rewardId: id, url: video.url, name: video.name, status: "error", error: data.error ?? `HTTP ${r.status}` });
        } else {
          results.push({ rewardId: id, url: video.url, name: video.name, status: data.cached ? "cached" : "ok" });
        }
      } catch (e) {
        results.push({ rewardId: id, url: video.url, name: video.name, status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  const counts = {
    rewards: rewardsProcessed,
    videos: videosFound,
    cached: results.filter((r) => r.status === "cached").length,
    transcribed: results.filter((r) => r.status === "ok").length,
    errors: results.filter((r) => r.status === "error").length,
  };

  return NextResponse.json({ ok: true, counts, results });
}

// GET mirrors POST so the single-reward test path is curl-friendly.
export async function GET(req: NextRequest) {
  return POST(req);
}
