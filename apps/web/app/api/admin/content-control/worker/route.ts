import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { getProfile, resolveUsername } from "@/lib/server/uploadPost";
import { publishContent, pollContent, retryContent, MARKETING_PROFILE } from "@/lib/server/contentPublishing";
import { createMilestoneCard } from "@/lib/server/milestoneCard";
import { createMilestoneVideo } from "@/lib/server/milestoneVideo";
import { createLaunchCard, createLaunchVideo } from "@/lib/server/launchCard";
import { withMentions, xHandle, xMentions } from "@/lib/server/xMention";
import { isProviderCapError, providerCapRetryAt } from "@/lib/contentQuota";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const authSecret = process.env.INTERNAL_CRON_SECRET!;
  const body = await req.json();
  const pending = await convex.query(api.contentControl.pending, { authSecret, ...(body.id ? { id: body.id as Id<"contentControlPosts"> } : {}) });
  const posts = body.id ? pending : pending.slice(0, 3);
  for (const entry of posts) {
    if (entry.status === "submitted" && entry.requestId) {
      try {
        const result = await pollContent(entry.requestId, entry.platforms);
        await convex.mutation(api.contentControl.finish, { authSecret, id: entry._id, ...result });
      } catch (e) {
        await convex.mutation(api.contentControl.finish, { authSecret, id: entry._id, status: "submitted", requestId: entry.requestId, error: e instanceof Error ? e.message : "Waiting for provider confirmation" });
      }
      continue;
    }
    const post = await convex.mutation(api.contentControl.claim, { authSecret, id: entry._id as Id<"contentControlPosts"> });
    if (!post) continue;
    try {
      if (post.targetMint && !await convex.query(api.influencers.getByMintServer, { authSecret, mintAddress: post.targetMint })) throw new Error("The selected posting agent was deleted");
      const username = post.targetMint ? resolveUsername(post.targetMint) : MARKETING_PROFILE;
      const profile = await getProfile(username);
      const disconnected = post.platforms.filter(p => !profile.connected[p]);
      if (disconnected.length) {
        const waiting = post.source !== "manual" && Date.now() - post.createdAt < 7 * 24 * 3_600_000;
        // Automatic posts wait (up to a week) and publish on their own once the account is connected.
        if (waiting) { await convex.mutation(api.contentControl.finish, { authSecret, id: post._id, status: "queued", error: `Waiting for ${disconnected.join(", ")} to be connected on the posting account` }); continue; }
        throw new Error(`Connect ${disconnected.join(", ")} on the selected posting account`);
      }
      let prepared = post;
      const attach = async (mediaUrl: string, kind: "photo" | "video") => {
        await convex.mutation(api.contentControl.setMedia, { authSecret, id: post._id, mediaUrl, kind });
        prepared = { ...prepared, mediaUrl, kind };
      };
      if (!post.requestId) {
        // Cards go out animated (a looping video X plays like a GIF); a still PNG, then the plain avatar, are fallbacks.
        if (post.source === "milestone" && !post.mediaUrl) {
          try { await attach(await createMilestoneVideo(post), "video"); }
          catch (e) { console.error("[content-control] animated milestone failed, using still", e); await attach(await createMilestoneCard(post), "photo"); }
        } else if (post.source === "mint" && !post.mediaUrl?.includes("/marketing/launch/")) {
          try { await attach(await createLaunchVideo(post), "video"); }
          catch (e) {
            console.error("[content-control] animated launch card failed, using still", e);
            try { await attach(await createLaunchCard(post), "photo"); } catch (err) { console.error("[content-control] launch card failed, using avatar", err); }
          }
        }
        // Mention the agent's own X account when it has one connected (never the account that is posting).
        if (post.source === "mint" || post.source === "milestone") {
          const mentions = await xMentions(convex, authSecret, [post.agentMint], xHandle(profile.connected.x));
          prepared = { ...prepared, caption: withMentions(prepared.caption, mentions) };
        }
      }
      const result = post.requestId ? await retryContent(post.requestId) : await publishContent(prepared, username);
      if (result.status === "failed" && isProviderCapError(result.error)) {
        // X says this account is out of posts for now: keep the post queued and retry in an hour instead of failing it.
        await convex.mutation(api.contentControl.finish, { authSecret, id: post._id, status: "queued", error: "X daily posting cap reached, retrying in an hour", notBefore: providerCapRetryAt(Date.now()) });
        continue;
      }
      await convex.mutation(api.contentControl.finish, { authSecret, id: post._id, ...result });
    } catch (e) {
      await convex.mutation(api.contentControl.finish, { authSecret, id: post._id, status: "failed", error: e instanceof Error ? e.message : "Publishing failed" });
    }
  }
  return NextResponse.json({ ok: true });
}
