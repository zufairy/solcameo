"use node";

// The actual video-render job. Split out of videoJobs.ts (which also has plain
// query/mutation exports that must run in Convex's isolate runtime) because
// generateVideoFromScript transitively imports real Node APIs (ffmpeg exec via
// node:child_process, node:fs path resolution) — Convex requires any file using
// Node APIs to be its own file carrying the "use node" directive above, or the
// bundler fails outright (for EVERY deploy, not just one touching this file).

import { internalAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { jobArgs } from "./videoJobArgs";
import { generateVideoFromScript } from "../lib/server/kie-video-pipeline";
import { VIDEO_ENGINES, VIDEO_STORYBOARD_COST_USDC, videoCostForLength } from "../lib/builder/agentTypes";
import { resolveHookBurnPayload } from "../lib/builder/hookDesigns";
import { hasRealPost } from "../lib/submissionIdentity";
import { appFetch } from "./lib/appFetch";
import { pickFromPool, toPool } from "../lib/server/videoPool";
import { putVideo, r2Configured } from "../lib/server/videoStorage";

/** Control-flow signal: the Main Content app's bypass supplied the video, so the
 *  generation pipeline is skipped without being treated as a failure. */
class SkipGeneration extends Error {}

// ─── Background video job ────────────────────────────────────────────────────
// The builder's create_video task generates a script synchronously (fast) then
// hands the slow storyboard → clips → stitch pipeline here. A 60s stitched
// video takes several minutes — longer than the 300s HTTP request limit — so it
// runs in a Convex action (10-minute budget). The reactive `agentTasks` record
// drives the builder UI: it stays "running" until this job marks it
// succeeded/failed with the finished video URL.
//
// jobArgs (the shared arg shape) lives in ./videoJobArgs.ts — a node-free file
// both this action and videoJobs.enqueue import, so neither has to import the
// other (importing FROM this "use node" file would drag its node:child_process
// dependency chain into videoJobs.ts's isolate-runtime bundle).

/**
 * The actual render. Runs the storyboard → clip generation → stitch pipeline,
 * stitching multi-clip Seedance videos via the Next ffmpeg route (injected as
 * `stitchClips`), stores the result, and marks the task done.
 *
 * Scheduled by videoJobs.enqueue (internal.videoJobsGenerate.generate) — kept
 * in this separate "use node" file so videoJobs.ts's plain query/mutation
 * exports stay in the isolate runtime.
 */
export const generate = internalAction({
  args: jobArgs,
  handler: async (ctx, args) => {
    // Captured up-front so the (best-effort) overlay burn below can be bounded by
    // the time REMAINING before the ~600s Convex action wall, never overrunning it.
    const actionStartedAt = Date.now();
    // The Convex runtime env is separate from Next's .env.local, so the Kie key
    // is forwarded from the enqueue and threaded explicitly into the pipeline
    // (`apiKey`) rather than relying on process.env here. Convex env wins if set.
    // (The callback ORIGIN is no longer read here: appFetch resolves and fails over
    // between origins itself, so args.appUrl only matters as one of its candidates.)

    let videoData: Awaited<ReturnType<typeof generateVideoFromScript>> | null = null;
    let pipelineError: string | undefined;

    // Pool picking in THIS runtime has no transcripts to match on (reading the
    // transcript cache needs node:crypto for the source key, which the Convex V8
    // isolate lacks), so picks here cycle by a stable per-job seed. The Next render
    // path does the contextual matching; both draw from the same uploads.
    const poolSeed = (() => { let h = 0; for (const ch of args.taskId) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; })();
    const pickPool = (urls: string[] | undefined) =>
      urls?.length ? pickFromPool({ pool: toPool(urls), index: poolSeed })?.url : undefined;

    // "No clip / UGC needed": publish an uploaded video instead of generating one.
    // Entered BEFORE generateVideoFromScript so no model is ever billed; the overlay
    // and CTA stages below still run, so the post keeps the agent's look.
    const bypassMain = args.video.overlays?.mainVideosOnly ? pickPool(args.video.overlays.mainVideos) : undefined;
    if (bypassMain) {
      videoData = { videoUrl: bypassMain, videoNote: "Published from the Main Content app's uploads." } as Awaited<ReturnType<typeof generateVideoFromScript>>;
    }
    try {
      if (bypassMain) throw new SkipGeneration();
      videoData = await generateVideoFromScript({
        ...args.video,
        // Forwarded Kie key (Convex env has none unless explicitly set).
        apiKey: args.kieApiKey,
        // 10-min action minus grace for the final mutations + storage upload.
        timeBudgetMs: 560_000,
        // Concatenate frame-chained Seedance clips into one file. Kie can't
        // merge Seedance and ffmpeg.wasm is browser-only, so the binary concat
        // runs in the Next route; we store the returned bytes in R2.
        stitchClips: async (clipUrls, opts) => {
          const res = await appFetch(`/api/video/concat`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}) },
            body: JSON.stringify({ clipUrls, crossfadeSeconds: opts?.crossfadeSeconds, trimSeconds: opts?.trimSeconds, headTrimSeconds: opts?.headTrimSeconds }),
          });
          if (!res.ok) {
            throw new Error(`concat HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          }
          const buf = await res.arrayBuffer();
          // Videos live in R2 only; never fall back to Convex file storage.
          if (!r2Configured()) throw new Error("R2 storage is not configured for generated videos");
          const { url } = await putVideo(buf, { keyPrefix: "generated" });
          return url;
        },
      });
    } catch (err) {
      // The bypass short-circuit is a control-flow signal, not a failure: videoData
      // is already the uploaded video.
      if (!(err instanceof SkipGeneration)) {
        pipelineError = err instanceof Error ? err.message : String(err);
        console.error("[videoJobsGenerate.generate] pipeline FAILED:", pipelineError);
      }
    }

    // HOOK VIDEO: prepend the operator's uploaded opener BEFORE the overlay burn, so
    // a burned hook line lands on the hook footage. Best-effort — a failed join keeps
    // the base video rather than losing the render.
    const hookPick = pickPool(args.video.overlays?.hookVideos);
    if (videoData?.videoUrl && hookPick) {
      try {
        const res = await appFetch(`/api/video/concat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}) },
          body: JSON.stringify({ clipUrls: [hookPick, videoData.videoUrl] }),
        });
        if (!res.ok) throw new Error(`concat HTTP ${res.status}`);
        const joined = await res.arrayBuffer();
        if (!r2Configured()) throw new Error("R2 storage is not configured for generated videos");
        videoData.videoUrl = (await putVideo(joined, { keyPrefix: "generated" })).url;
      } catch (e) {
        console.warn("[videoJobsGenerate.generate] hook video join failed (keeping base video):", e instanceof Error ? e.message : e);
      }
    }

    // Video Director overlays — burn Hook Text (first 5s) and/or word-timed
    // Captions onto the finished video. Best-effort: any failure keeps the base
    // video untouched (the burn route returns the original URL on error).
    const ov = args.video.overlays;
    if (videoData?.videoUrl && ov && (ov.hookText?.enabled || ov.captions?.enabled || ov.music?.enabled || ov.newsImageUrl)) {
      // Bound the burn so the action stays under the ~600s wall: the render has
      // already eaten most of the 560s budget, so cap the burn at whatever remains
      // before a ~570s deadline (leaving grace for the final succeed mutation). On
      // timeout the AbortError flows into the catch below → the un-burned base video
      // is still saved by agentTasks.succeed instead of the isolate hanging.
      const controller = new AbortController();
      const overlayBudgetMs = Math.min(120_000, Math.max(0, 570_000 - (Date.now() - actionStartedAt)));
      const overlayTimer = setTimeout(() => controller.abort(), overlayBudgetMs);
      try {
        const res = await appFetch(`/api/video/overlay-burn`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}) },
          signal: controller.signal,
          body: JSON.stringify({
            videoUrl: videoData.videoUrl,
            hookText: ov.hookText?.enabled
              ? (resolveHookBurnPayload(ov.hookText, args.video.hook) ?? undefined)
              : undefined,
            captions: ov.captions?.enabled
              ? {
                  mode: ov.captions.style?.mode === "line" ? "line" : "karaoke",
                  fontColor: ov.captions.style?.fontColor,
                  fontSize: ov.captions.style?.fontSize,
                  position: ov.captions.style?.position,
                  preset: (ov.captions.style as { preset?: string } | undefined)?.preset,
                }
              : undefined,
            // Trending Audio bed — overlay-burn resolves the track + mixes it under
            // the voiceover at volumePct loudness (default 30%).
            music: ov.music?.enabled
              ? {
                  trackId: ov.music.trackId,
                  autoMusic: ov.music.autoMusic ?? true,
                  volumePct: typeof ov.music.volumePct === "number" ? ov.music.volumePct : 30,
                  customUrl: ov.music.customUrl,
                }
              : undefined,
            // Reference-image inset (news photo / screenshot) — burned as a
            // corner picture-in-picture for the clip's full length so viewers
            // see what's being discussed, not an identity swap.
            imageOverlay: ov.newsImageUrl ? { url: ov.newsImageUrl } : undefined,
          }),
        });
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; videoUrl?: string };
        if (d?.ok && d.videoUrl) videoData.videoUrl = d.videoUrl;
      } catch (e) {
        console.warn("[videoJobsGenerate.generate] overlay burn failed (keeping base video):", e instanceof Error ? e.message : e);
      } finally {
        clearTimeout(overlayTimer);
      }
    }

    // Video Call To Action — append the operator's uploaded clip to the END of the
    // finished video. Best-effort + budget-bounded; keeps the base video on failure.
    if (videoData?.videoUrl && ov?.ctaVideo) {
      const controller = new AbortController();
      const ctaBudgetMs = Math.min(120_000, Math.max(0, 590_000 - (Date.now() - actionStartedAt)));
      const ctaTimer = setTimeout(() => controller.abort(), ctaBudgetMs);
      try {
        const res = await appFetch(`/api/video/append-cta`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}) },
          signal: controller.signal,
          body: JSON.stringify({ videoUrl: videoData.videoUrl, ctaUrl: ov.ctaVideo }),
        });
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; videoUrl?: string };
        if (d?.ok && d.videoUrl) videoData.videoUrl = d.videoUrl;
      } catch (e) {
        console.warn("[videoJobsGenerate.generate] CTA append failed (keeping video):", e instanceof Error ? e.message : e);
      } finally {
        clearTimeout(ctaTimer);
      }
    }

    let script: unknown = null;
    try { script = JSON.parse(args.scriptJson); } catch { /* leave null */ }

    const output = {
      topic: args.video.topic,
      script,
      videoModel: args.video.videoModel,   // lets the UI show engine-specific clip counts
      storyBeats: videoData?.storyBeats,
      storyboardImageUrl: videoData?.storyboardImageUrl,
      videoUrl: videoData?.videoUrl,
      storyboardPrompt: videoData?.storyboardPrompt,
      videoPrompt: videoData?.videoPrompt,
      durationSeconds: videoData?.durationSeconds,
      storyboardError: videoData?.storyboardError,
      videoError: videoData?.videoError,
      videoNote: videoData?.videoNote,
      pipelineError,
      generatedAt: Date.now(),
    };

    // Nothing usable produced → fail the task (billing only the storyboard floor).
    if (!videoData?.videoUrl && !videoData?.storyboardImageUrl) {
      await ctx.runMutation(api.agentTasks.fail, {
        id: args.taskId,
        errorMessage: pipelineError ?? videoData?.videoError ?? "Video generation failed",
        cost: args.costFloor,
        authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
      });
      return null;
    }

    // Cost = storyboard floor + actual rendered seconds at the engine's per-clip rate.
    let cost = args.costFloor;
    try {
      const engine = VIDEO_ENGINES.find((e) => e.kieModel === args.video.videoModel);
      cost = VIDEO_STORYBOARD_COST_USDC + (videoData.videoUrl && engine
        ? videoCostForLength(engine, videoData.durationSeconds ?? 0)
        : 0.01);
    } catch { /* keep floor */ }

    // Organic influencer videos use the same durable drip queue as clipping.
    // Queue before completing the render task so a failed handoff is visible and
    // the calendar never invents a successful post from a successful render.
    const organicAutoPost = videoData.videoUrl && args.video.autoPost
      && !args.video.autoPost.campaignId && !args.video.autoPost.submissionId
      && !args.video.autoPost.contentRewardId;
    let queuedAutoPost = false;
    if (organicAutoPost) {
      try {
        await ctx.runMutation(api.scheduledContent.schedule, {
          mintAddress: args.mintAddress,
          taskId: args.taskId,
          scheduledFor: Date.now(),
          topic: args.video.topic,
          caption: args.video.autoPost!.caption,
          platforms: args.video.autoPost!.platforms,
          videoUrl: videoData.videoUrl!,
          authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
        });
        queuedAutoPost = true;
      } catch (e) {
        console.warn("[videoJobsGenerate.generate] auto-post queue failed, trying direct post:", e instanceof Error ? e.message : e);
      }
    }
    if (queuedAutoPost) Object.assign(output, { post: { status: "scheduled" } });

    await ctx.runMutation(api.agentTasks.succeed, {
      id: args.taskId,
      output: JSON.stringify(output),
      cost,
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
    await ctx.runMutation(api.agentTasks.recordMemory, {
      mintAddress: args.mintAddress,
      kind: "lesson",
      summary: `Drafted video about "${args.video.topic}".${
        videoData.videoUrl ? " ✓ Video rendered." : videoData.storyboardImageUrl ? " ✓ Storyboard rendered." : ""
      }`,
      importance: 55,
      sourceTaskId: args.taskId,
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });

    // AUTO-POST: if the planner asked to publish this video, post it now — WITH
    // the rendered video + caption (the post_content executor handles upload-post
    // + connection gating). Runs only AFTER the video actually rendered, so a
    // campaign deliverable is never "posted" before the video exists. If this is
    // a campaign join, attach the live post link to the submission once it's up.
    // Deliverable = the rendered video if we have it, else the storyboard image.
    // Falling back to the image means an image-only render (video step failed but
    // the storyboard succeeded) still publishes + records the campaign submission,
    // instead of silently producing media that never reaches the campaign.
    const deliverableUrl = videoData.videoUrl ?? videoData.storyboardImageUrl;
    if (deliverableUrl && args.video.autoPost && !queuedAutoPost) {
      const ap = args.video.autoPost;
      const caption = ap.caption && ap.caption.trim() ? ap.caption.trim() : args.video.topic;
      // Empty platforms list = post to ALL connected accounts (post_content fans
      // out to every connected video-capable platform when none are specified).
      const allConnected = ap.platforms.length === 0;
      try {
        const res = await appFetch(`/api/agents/run-task`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // server-to-server: the run-task auth gate accepts this internal secret.
            ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
          },
          body: JSON.stringify({
            mintAddress: args.mintAddress,
            taskType: "post_content",
            title: `Auto-post video → ${allConnected ? "all connected" : ap.platforms.join(", ")}`,
            input: {
              ...(allConnected ? {} : { platforms: ap.platforms }),
              contentType: videoData.videoUrl ? "video" : "photo",
              mediaUrl: deliverableUrl,
              campaignId: ap.campaignId,
              title: args.video.topic,
              text: caption,
              description: caption,
              niche: args.video.agentNiche,
            },
            triggeredBy: "autopost",
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`post_content HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
        }
        const postResponse = await res.json().catch(() => ({} as Record<string, unknown>));
        const postOutput = (postResponse as { output?: { status?: string; note?: string; postUrl?: string } }).output;
        await ctx.runMutation(api.agentTasks.updatePostResult, {
          id: args.taskId,
          status: postOutput?.status === "posted" ? "posted" : "failed",
          ...(postOutput?.postUrl ? { postUrl: postOutput.postUrl } : {}),
          ...(postOutput?.note ? { error: postOutput.note } : {}),
          authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
        });
        // Pull the live post URL out of the post_content result and attach it to
        // the campaign submission (campaign-join flow records the real link here).
        if (ap.submissionId || ap.campaignId || ap.contentRewardId) {
          const data = postResponse;
          const out = (data as { output?: { status?: string; result?: unknown; platforms?: string[]; postUrl?: string; postPlatform?: string; platformPostId?: string; uploadPostRequestId?: string } }).output ?? {};
          // Prefer the link post_content already RESOLVED (it extracts the real
          // permalink / polls upload-post's media list). Fall back to a regex scan
          // of the raw response only if that's somehow absent.
          const postUrl = out.postUrl || JSON.stringify(out.result ?? "").match(/https?:\/\/[^\s"'\\]+/)?.[0];
          const postedPlatforms = Array.isArray(out.platforms) ? out.platforms : [];
          const linkPlatform = out.postPlatform ?? ap.platforms.find((p) => postedPlatforms.includes(p)) ?? postedPlatforms[0] ?? ap.platforms[0];
          // Durable post ids the oracle needs to settle the deliverable (a bare
          // postUrl isn't analytics-queryable on its own — see dueForVerification).
          const platformPostId = typeof out.platformPostId === "string" ? out.platformPostId : undefined;
          const uploadPostRequestId = typeof out.uploadPostRequestId === "string" ? out.uploadPostRequestId : undefined;
          // A submission counts when there's ANY durable proof of publish — a
          // resolved permalink, or (very common on Instagram/TikTok, where the
          // permalink resolves async) the platform's own post id / upload-post
          // request id. Requiring `postUrl` alone silently dropped every campaign
          // submission + content-reward row whenever the permalink hadn't resolved
          // yet, discarding platformPostId/uploadPostRequestId with it — the ONLY
          // handles the sync worker needs to backfill the real permalink and views
          // later. Once dropped, nothing existed to recover: a genuinely-posted
          // clip stayed "not posted" forever. Mirrors `hasRealPost` in
          // lib/submissionIdentity.ts, which submitForCampaign/setPostLink already
          // use downstream — this just stops gating the CALL to them on postUrl too.
          const posted = out.status === "posted" && hasRealPost({ postUrl, platformPostId, uploadPostRequestId });

          // a) Vello-native campaign submission. An explicit submissionId means a
          //    join already exists — just attach the link. A bare campaignId (the
          //    autonomous heartbeat flow) means we must CREATE the submission now:
          //    submitForCampaign upserts the join + link in one call, so the
          //    campaign submission happens automatically end-to-end.
          if (ap.submissionId && posted) {
            try {
              await ctx.runMutation(api.submissions.setPostLink, {
                submissionId: ap.submissionId as Id<"submissions">,
                influencerMint: args.mintAddress,
                // setPostLink's postUrl is a REQUIRED string — when only
                // platformPostId/uploadPostRequestId resolved so far, fall back to
                // the raw deliverable so the call never sends an empty/undefined
                // permalink. The sync worker backfills the real permalink once it
                // resolves (registerMeasurementHandle / scraperService).
                postUrl: postUrl || deliverableUrl,
                platform: linkPlatform,
                ...(platformPostId ? { platformPostId } : {}),
                ...(uploadPostRequestId ? { uploadPostRequestId } : {}),
                postedAt: Date.now(),
                authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
              });
            } catch (e) {
              console.warn("[videoJobsGenerate.generate] setPostLink failed:", e instanceof Error ? e.message : e);
            }
          } else if (ap.campaignId && posted) {
            // ONLY submit when the post actually went live — proven by a permalink
            // OR a durable platformPostId/uploadPostRequestId. A submission with
            // NEITHER is meaningless to the campaign, so we never create one.
            try {
              await ctx.runMutation(api.submissions.submitForCampaign, {
                campaignId: ap.campaignId,
                influencerMint: args.mintAddress,
                influencerName: args.video.agentName,
                submitterWallet: ap.ownerWallet ?? args.mintAddress,
                // postUrl is optional here — hasRealPost() (lib/submissionIdentity)
                // already accepts platformPostId/uploadPostRequestId alone as proof.
                ...(postUrl ? { postUrl } : {}),
                platform: linkPlatform,
                ...(platformPostId ? { platformPostId } : {}),
                ...(uploadPostRequestId ? { uploadPostRequestId } : {}),
                postedAt: Date.now(),
                authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
              });
            } catch (e) {
              console.warn("[videoJobsGenerate.generate] submitForCampaign failed:", e instanceof Error ? e.message : e);
            }
          } else if (ap.submissionId && !posted) {
            // We have a pre-created join but the post produced NO proof of
            // publish at all (no permalink, no platformPostId, no
            // uploadPostRequestId) — mark it failed so it isn't left dangling.
            try {
              await ctx.runMutation(api.submissions.markFailed, {
                submissionId: ap.submissionId as Id<"submissions">,
                influencerMint: args.mintAddress,
                reason: "auto-post produced no live link",
                authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
              });
            } catch { /* mutation may not exist yet — non-blocking */ }
            console.warn("[videoJobsGenerate.generate] post produced no proof of publish — NOT submitting to campaign.");
          } else if (ap.campaignId && !posted) {
            console.warn("[videoJobsGenerate.generate] post produced no proof of publish — NOT creating a campaign submission.");
          }

          if (posted) {
            // b) jobtepi-web content-reward submission (record the link there too).
            if (ap.contentRewardId && ap.ownerWallet) {
              try {
                await appFetch(`/api/content-rewards/submit`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
                  },
                  body: JSON.stringify({
                    contentRewardId: ap.contentRewardId,
                    ownerWallet: ap.ownerWallet,
                    // contentUrl is REQUIRED by /api/content-rewards/submit — fall
                    // back to the raw deliverable when only platformPostId/
                    // uploadPostRequestId resolved. registerMeasurementHandle is
                    // wired into this route (passed below), so the sync worker
                    // still backfills the real permalink once it resolves.
                    contentUrl: postUrl || deliverableUrl,
                    videoUrl: videoData.videoUrl,
                    platform: linkPlatform,
                    title: args.video.topic,
                    description: caption,
                    // Durable handles → the submit route registers a measurement
                    // handle so the sync worker can refresh this clip's views by
                    // request_id (and recover its permalink if it ever regresses).
                    mintAddress: args.mintAddress,
                    ...(platformPostId ? { platformPostId } : {}),
                    ...(uploadPostRequestId ? { uploadPostRequestId } : {}),
                  }),
                });
              } catch (e) {
                console.warn("[videoJobsGenerate.generate] content-reward submit failed:", e instanceof Error ? e.message : e);
              }
            }
          }
        }
      } catch (e) {
        console.warn("[videoJobsGenerate.generate] auto-post failed:", e instanceof Error ? e.message : e);
        await ctx.runMutation(api.agentTasks.updatePostResult, {
          id: args.taskId, status: "failed",
          error: e instanceof Error ? e.message.slice(0, 200) : "Post failed",
          authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
        }).catch(() => {});
      }
    }
    return null;
  },
});
