import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { fetchSelf } from "@/lib/server/fetchInternal";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
// This route makes 4-5 sequential Convex round-trips (agent lookup, campaign
// lookup, jobs listing, the decision mutation, and for a UGC join an extra
// task-create mutation). Without a raised limit it could hit the platform's
// default function timeout under any latency, which kills the connection
// mid-request — the browser surfaces that as a bare "Failed to fetch" (a
// network-level abort, not an HTTP error response the client can show a
// message for). Matches the sibling work/evaluate route's limit.
export const maxDuration = 60;

/** Work tab join / leave / hand-back-to-agent for one campaign. Owner-only. */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { mintAddress?: string; campaignId?: string; contentRewardId?: string; rail?: string; title?: string; action?: string };
  const mintAddress = String(body.mintAddress ?? "").trim();
  const action = body.action;
  if (!mintAddress) return NextResponse.json({ ok: false, error: "mintAddress required" }, { status: 400 });
  if (action !== "join" && action !== "leave" && action !== "auto" && action !== "work") return NextResponse.json({ ok: false, error: "action must be join|leave|auto|work" }, { status: 400 });
  if (!body.campaignId && !body.contentRewardId) return NextResponse.json({ ok: false, error: "campaignId or contentRewardId required" }, { status: 400 });
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  const cvx = new ConvexHttpClient(CONVEX_URL);
  const agent = await cvx.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, agent ?? undefined);
    if (err) return err;
  }
  const isClipper = (agent as { agentType?: string } | null)?.agentType === "clipping";
  const connectedPlatforms = (agent as { connectedPlatforms?: string[] } | null)?.connectedPlatforms ?? [];
  if (!isClipper && (action === "join" || action === "work") && connectedPlatforms.length === 0) {
    return NextResponse.json({ ok: false, error: "Connect a social account before starting UGC campaign work." }, { status: 400 });
  }

  // An AI Clipper only works CLIPPING campaigns (it clips the brand's source
  // videos). Joining a UGC campaign would make it render an original video —
  // exactly the "my clipper made an AI-influencer video" bug.
  let campaign: { category?: string; contentLinks?: string[]; contentFileUrls?: string[]; title?: string; brandName?: string; brief?: string; platforms?: string[] } | null = null;
  if ((action === "join" || action === "work") && body.campaignId) {
    campaign = await cvx.query(api.campaigns.getById, { id: body.campaignId as Id<"campaigns"> }).catch(() => null);
    // Flow rule: Clippers ↔ clipping campaigns, Influencers ↔ influencer (UGC) campaigns.
    if (isClipper && campaign && campaign.category !== "clipping") {
      return NextResponse.json({ ok: false, error: "AI Clippers can only join clipping campaigns. This one asks for original (UGC) videos — use an AI Influencer for it." }, { status: 400 });
    }
    if (!isClipper && campaign && campaign.category === "clipping") {
      return NextResponse.json({ ok: false, error: "This is a clipping campaign — only AI Clippers can join it. Use one of your AI Clippers." }, { status: 400 });
    }
  }

  const res = await cvx.mutation(api.campaignMemberships.setOperatorDecision, {
    mintAddress, authSecret: secret, campaignId: body.campaignId, contentRewardId: body.contentRewardId,
    rail: body.rail === "content_reward" ? "content_reward" : "onchain", title: String(body.title ?? ""), action: action === "work" ? "join" : action,
  });

  // Joined as a clipper → start clipping the campaign's source NOW (instead of
  // waiting for the next auto-clip cycle). join_clip_campaign resolves a
  // channel/playlist/Drive link to a clippable video, clips it, and the clip
  // pipeline posts + submits per the agent's clip settings. Sources this agent
  // already clipped are skipped; repeat moments are dropped by clipJobs.
  let clipping: { started: boolean; sourceUrl?: string; reason?: string } | undefined;
  if ((action === "join" || action === "work") && isClipper && body.campaignId && campaign) {
    const links = [...(campaign.contentLinks ?? []), ...(campaign.contentFileUrls ?? [])].filter((u) => /^https?:\/\//i.test(u));
    const jobs = (await cvx.query(api.clipJobs.listJobsByMint, { mintAddress }).catch(() => [])) as Array<{ sourceUrl: string; campaignId?: string; status: string }>;
    const done = new Set(jobs.filter((j) => j.status !== "error").map((j) => j.sourceUrl));
    const next = links.find((u) => !done.has(u));
    if (!links.length) clipping = { started: false, reason: "This campaign has no source video links to clip yet." };
    else if (!next) clipping = { started: false, reason: "Every source link in this campaign has already been clipped by this agent." };
    else {
      void fetchSelf("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(secret ? { "X-Internal-Secret": secret } : {}) },
        body: JSON.stringify({
          mintAddress, taskType: "join_clip_campaign", title: `Clip campaign: ${campaign.title ?? body.title ?? ""}`.slice(0, 120),
          triggeredBy: "campaign_join", input: { campaignId: body.campaignId, sourceUrl: next },
        }),
      }, req).catch((e) => console.warn("[work/membership] clip kickoff failed:", e instanceof Error ? e.message : e));
      clipping = { started: true, sourceUrl: next };
    }
  }
  // Joined as an AI Influencer (UGC campaign) → queue its first campaign video
  // now: the same create_video + campaignId task the chat's [JOIN_CAMPAIGN] runs
  // (brief → render → post → submitForCampaign), instead of waiting for a later
  // heartbeat to notice the membership.
  let video: { started: boolean; taskId?: string } | undefined;
  if ((action === "join" || action === "work") && !isClipper && body.campaignId && campaign) {
    try {
      const topic = `${campaign.brandName ? `${campaign.brandName}: ` : ""}${campaign.title ?? body.title ?? "Campaign video"}`.slice(0, 200);
      // Campaign work is an explicit operator action: generate in this agent's
      // persona, then publish to campaign-compatible connected platforms and
      // attach the resulting post to the campaign submission.
      const input = {
        campaignId: body.campaignId,
        topic,
        autoPost: { platforms: campaign.platforms ?? [], campaignId: body.campaignId },
      };
      const taskId = await cvx.mutation(api.agentTasks.create, {
        mintAddress, sessionId: mintAddress, type: "create_video",
        title: `Campaign: ${topic}`.slice(0, 120), input: JSON.stringify(input), triggeredBy: "campaign_join", authSecret: secret,
      });
      void fetchSelf("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(secret ? { "X-Internal-Secret": secret } : {}) },
        body: JSON.stringify({ mintAddress, taskType: "create_video", taskId, title: `Campaign: ${topic}`.slice(0, 120), triggeredBy: "campaign_join", input }),
      }, req).catch((e) => console.warn("[work/membership] video kickoff failed:", e instanceof Error ? e.message : e));
      video = { started: true, taskId: String(taskId) };
    } catch (e) {
      console.warn("[work/membership] video task create failed:", e instanceof Error ? e.message : e);
      video = { started: false };
    }
  }
  return NextResponse.json({ ...res, ...(clipping ? { clipping } : {}), ...(video ? { video } : {}) });
}
