import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  buildGrokChainPlan, renderGrokChainClip, renderWanAnimateSwap, renderRunwayAleph,
  type GenerateVideoArgs, type StoryBeat, type GrokChainPlan,
} from "@/lib/server/kie-video-pipeline";
import { selfLoopbackBase } from "@/lib/server/fetchInternal";

// Chunked, Vercel-safe Grok Imagine 1.5 render for the standalone /recreate app —
// one clip per invocation, self-refiring. Clip 0 is a grok-imagine/image-to-video
// base take; clips 1+ are grok-imagine/extend steps chained on the previous task
// id, each returning the CUMULATIVE video (frame-continuous, no stitching), so the
// recreation matches the source video's scene pacing and total length.
export const runtime = "nodejs";
export const maxDuration = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const KIE_KEY = process.env.KIE_API_KEY ?? "";
const MAX_PHASE_ATTEMPTS = 4;

function fireNextStep(id: string, driveToken: string) {
  void fetch(`${selfLoopbackBase()}/api/recreate/render-step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, driveToken }),
  }).catch(() => {});
}

export async function POST(req: NextRequest) {
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

  const { id, driveToken } = (await req.json().catch(() => ({}))) as { id?: string; driveToken?: string };
  if (!id || !driveToken) return NextResponse.json({ error: "id and driveToken required" }, { status: 400 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  const projectId = id as Id<"videoRecreateProjects">;
  const job = await convex.query(api.videoRecreateProjects.getForStep, { id: projectId, driveToken });
  if (!job) return NextResponse.json({ error: "not found or unauthorized" }, { status: 404 });

  if (job.phase === "done" || job.phase === "failed") {
    return NextResponse.json({ ok: true, phase: job.phase });
  }
  if (job.phase !== "video") {
    // Kickoff hasn't finished understanding/planning yet — nothing for this
    // chain to do (it self-fires again once kickoff patches phase:"video").
    return NextResponse.json({ ok: true, phase: job.phase, note: "not ready for render yet" });
  }

  const patch = (p: Record<string, unknown>) => convex.mutation(api.videoRecreateProjects.patch, { id: projectId, driveToken, ...p });

  const failAll = async (message: string) => {
    await patch({ phase: "failed", error: message, statusMessage: `Failed: ${message.slice(0, 160)}` });
  };
  const retryOrFail = async (message: string) => {
    const attempts = (job.attempts ?? 0) + 1;
    if (attempts < MAX_PHASE_ATTEMPTS) {
      await patch({ attempts, statusMessage: `Hiccup — retrying (${attempts})…` });
      fireNextStep(id, driveToken);
      return NextResponse.json({ ok: true, retrying: attempts });
    }
    await failAll(message);
    return NextResponse.json({ ok: false, phase: "failed", error: message });
  };
  const finishAll = async (videoUrl: string, videoNote?: string) => {
    await patch({ phase: "done", videoUrl, videoNote, statusMessage: "Video ready." });
  };

  // ── RUNWAY ALEPH path — EDIT the original footage per the operator's prompt.
  // One task: the source video + a composed instruction (+ the product photo /
  // avatar as the reference image). Camera angles, motion, timing, pacing all
  // survive because Aleph edits frames instead of regenerating them.
  if (job.engine === "aleph") {
    const screenshots: string[] = job.screenshotUrls ? (JSON.parse(job.screenshotUrls) as string[]) : [];
    const referenceImage = job.productImageUrl ?? screenshots[0] ?? job.characterImageUrl ?? undefined;
    const prompt = [
      job.userPrompt,
      job.productImageUrl
        ? `Replace the product shown in the video with the product from the reference image${job.productDescription ? ` — ${job.productDescription}` : ""}. Same placement, handling, framing and lighting as the original product.`
        : "",
      !job.productImageUrl && screenshots.length > 0
        ? `Replace whatever is shown on any screen (laptop/phone/monitor) in the video with the ${job.refMode === "app" ? "app" : "website"} from the reference image${job.productDescription ? ` — ${job.productDescription}` : ""}. Same screen angle, perspective, glow and reflections.`
        : "",
      !job.productImageUrl && screenshots.length === 0 && job.characterImageUrl
        ? "Replace the presenter in the video with the person from the reference image, keeping their motion, expressions and framing."
        : "",
      "Keep EVERYTHING not mentioned exactly as filmed: camera angles, camera movement, motion, timing, pacing, lighting, background, editing and audio.",
    ].filter(Boolean).join(" ");
    if (!prompt.trim()) return await retryOrFail("No Aleph instruction to apply");
    try {
      const { url } = await renderRunwayAleph({
        videoUrl: job.sourceVideoUrl,
        prompt,
        referenceImage,
        aspectRatio: job.sourceAspect ?? undefined,
        apiKey: KIE_KEY,
      });
      await finishAll(url, "Runway Aleph — original footage edited: your changes applied, camera and timing preserved.");
      return NextResponse.json({ ok: true, phase: "done" });
    } catch (err) {
      return await retryOrFail(err instanceof Error ? err.message : String(err));
    }
  }

  // ── WAN ANIMATE path — different algorithm: one Kie task swaps the presenter
  // in the ORIGINAL footage (motion/scene/length preserved). No beats, no
  // prompts, no chain — a single render + poll, retried via retryOrFail.
  if (job.engine === "wan") {
    const imageUrl = job.characterImageUrl ?? job.avatarUrl;
    if (!imageUrl) return await retryOrFail("No presenter image for the Wan swap");
    try {
      const { url } = await renderWanAnimateSwap({
        videoUrl: job.wanSourceUrl ?? job.sourceVideoUrl,
        imageUrl,
        resolution: "720p",
        apiKey: KIE_KEY,
      });
      await finishAll(url, "Wan Animate — your presenter swapped into the original footage, motion and pacing preserved.");
      return NextResponse.json({ ok: true, phase: "done" });
    } catch (err) {
      return await retryOrFail(err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const beats = job.beats ? (JSON.parse(job.beats) as StoryBeat[]) : [];
    if (beats.length === 0) return await retryOrFail("No recreation scenes to render");

    // Build the Grok chain plan once (clip 0) and persist it, so subsequent
    // invocations don't re-plan.
    let plan: GrokChainPlan;
    if (job.grokPlan) {
      plan = JSON.parse(job.grokPlan) as GrokChainPlan;
    } else {
      // Total length mirrors the SOURCE video: each beat's seconds is its
      // original scene's duration, so the chain sums to the original runtime.
      const durationSeconds = Math.min(60, Math.max(5, beats.reduce((n, b) => n + (b.seconds || 0), 0) || beats.length * 6));
      const genArgs: GenerateVideoArgs = {
        agentName: "Recreate",
        agentNiche: "general",
        avatarUrl: job.avatarUrl ?? "",
        // Site/app screenshots ride as extra visual references (web/app modes),
        // so on-screen UI in the recreation matches the REAL site/app.
        referenceImageUrls: [
          ...(job.avatarUrl ? [job.avatarUrl] : []),
          ...(job.screenshotUrls ? (JSON.parse(job.screenshotUrls) as string[]).slice(0, 2) : []),
        ],
        productImageUrl: job.productImageUrl,
        productImageUrls: job.productImageUrls ? (JSON.parse(job.productImageUrls) as string[]) : undefined,
        productDescription: job.productDescription,
        language: job.language,
        topic: "Recreated video",
        hook: beats[0]?.voiceover ?? "",
        scriptText: beats.map((b) => b.voiceover).filter(Boolean).join(" "),
        durationSeconds,
        // Mirror the UPLOAD's probed shape (kickoff stamps sourceAspect) — a
        // vertical upload renders vertical, landscape renders landscape.
        aspectRatio: (job.sourceAspect as "9:16" | "16:9" | "1:1" | undefined) ?? "9:16",
        resolution: "720p",
        videoModel: "grok-imagine/image-to-video",
        speech: "on_camera",
        // The source ad's captions/graphics are part of the recreation — the
        // beats carry each scene's exact overlay in onScreenText.
        allowOnScreenText: true,
        // Operator's free-text instruction rides EVERY clip prompt.
        ...(job.userPrompt ? { standingOrders: `OPERATOR INSTRUCTION: ${job.userPrompt}` } : {}),
      };
      plan = buildGrokChainPlan(genArgs, beats);
      await patch({
        grokPlan: JSON.stringify(plan),
        totalSegments: plan.totalSegments,
        clipIndex: 0,
        statusMessage: `Rendering clip 1/${plan.totalSegments}…`,
      });
    }

    const clipIndex = job.clipIndex ?? 0;
    const total = plan.totalSegments;
    await patch({ statusMessage: `Rendering clip ${clipIndex + 1}/${total}…` });

    let clip: { url: string; taskId: string; canExtend: boolean; accumulatedSeconds: number };
    try {
      clip = await renderGrokChainClip({
        plan,
        clipIndex,
        parentTaskId: job.veoTaskId,
        accumulatedSeconds: job.accumulatedSeconds,
        apiKey: KIE_KEY,
      });
    } catch (err) {
      if (clipIndex === 0 || !job.videoUrl) return await retryOrFail(err instanceof Error ? err.message : String(err));
      // An extend failed after retries but earlier clips produced a cumulative
      // video — keep the smooth partial rather than discarding a good render.
      await finishAll(job.videoUrl, `Rendered ${clipIndex} of ${total} clips — extend stopped.`);
      return NextResponse.json({ ok: true, phase: "done" });
    }

    const nextIndex = clipIndex + 1;
    const moreToDo = nextIndex < total && clip.canExtend;

    // Each grok extend returns the FULL cumulative video, so videoUrl always
    // holds the longest finished recreation.
    await patch({
      videoUrl: clip.url,
      veoTaskId: clip.taskId,
      accumulatedSeconds: clip.accumulatedSeconds,
      clipIndex: nextIndex,
      attempts: 0,
      statusMessage: moreToDo ? `Clip ${nextIndex}/${total} done — extending…` : "Finishing up…",
    });

    if (moreToDo) {
      fireNextStep(id, driveToken);
      return NextResponse.json({ ok: true, clip: nextIndex });
    }

    await finishAll(clip.url, undefined);
    return NextResponse.json({ ok: true, phase: "done" });
  } catch (err) {
    return await retryOrFail(err instanceof Error ? err.message : String(err));
  }
}
