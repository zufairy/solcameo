import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAuth } from "@/lib/server/requireAuth";
import { understandVideo, replanRecreation, describeProductImage, resolveProductReferences, researchReference, prepareWanSource, raceDescriptor, probeSourceAspect, samplePresenterFrame } from "@/lib/server/videoRecreate";
import { generateCarouselImage } from "@/lib/server/carouselImage";
import { resolveImageEngine } from "@/lib/builder/imageEngines";
import { selfLoopbackBase } from "@/lib/server/fetchInternal";
import { putVideo } from "@/lib/server/videoStorage";

// UNDERSTAND (ffmpeg scene-cuts + transcript + per-scene vision) + REPLAN (one
// Claude call) run synchronously here — bounded by MAX_SOURCE_SECONDS, comfortably
// under 300s. The expensive VIDEO RENDER is handed off to the chunked
// /api/recreate/render-step chain (fire-and-forget) so this route returns fast.
export const runtime = "nodejs";
export const maxDuration = 280;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: { sourceVideoUrl?: string; productImageUrl?: string; language?: string; race?: string; engine?: string; characterImageUrl?: string; referenceUrl?: string; userPrompt?: string; refMode?: string; appStoreUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const sourceVideoUrl = (body.sourceVideoUrl ?? "").trim();
  const productImageUrl = body.productImageUrl?.trim() || undefined;
  const language = (body.language ?? "English").trim() || "English";
  const race = (body.race ?? "match_original").trim() || "match_original";
  // "grok" (default) = full shot-for-shot recreation; "wan" = Wan 2.2 Animate
  // Replace — swaps the presenter in the ORIGINAL footage; "aleph" = Runway
  // Aleph 2.0 — EDITS the original footage per the operator's prompt (product
  // swap etc.), keeping camera angles/motion/timing exactly as filmed.
  const engine = body.engine === "wan" ? "wan" : body.engine === "aleph" ? "aleph" : "grok";
  const characterImageUrl = body.characterImageUrl?.trim() || undefined;
  const referenceUrl = body.referenceUrl?.trim() || undefined;
  const userPrompt = (body.userPrompt ?? "").trim().slice(0, 1500) || undefined;
  // What the recreation promotes: a physical product (photo), a WEBSITE (link →
  // live screenshots as references), or an APP (store link → real app-store
  // screenshots as references).
  const refMode = body.refMode === "web" ? "web" : body.refMode === "app" ? "app" : "product";
  const appStoreUrl = body.appStoreUrl?.trim() || undefined;
  if (!sourceVideoUrl) return NextResponse.json({ ok: false, error: "sourceVideoUrl is required" }, { status: 400 });

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!secret) return NextResponse.json({ ok: false, error: "Server not configured (INTERNAL_CRON_SECRET)" }, { status: 503 });

  const driveToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  // Wrapped so a Convex failure (e.g. stale deployed validator rejecting a newly
  // added arg) surfaces as a readable JSON error instead of an opaque Next 500.
  let projectId: Id<"videoRecreateProjects">;
  try {
    projectId = (await convex.mutation(api.videoRecreateProjects.create, {
      ownerId: auth.user.id,
      driveToken,
      sourceVideoUrl,
      productImageUrl,
      language,
      race,
      engine,
      characterImageUrl,
      referenceUrl,
      userPrompt,
      refMode,
      appStoreUrl,
      authSecret: secret,
    })) as Id<"videoRecreateProjects">;
  } catch (e) {
    const message = e instanceof Error ? e.message : "could not create the recreation project";
    console.error(`[recreate/kickoff] project create failed: ${message}`);
    return NextResponse.json({ ok: false, error: `Could not create the project: ${message.slice(0, 200)}` }, { status: 502 });
  }

  const patch = (p: Record<string, unknown>) =>
    convex.mutation(api.videoRecreateProjects.patch, { id: projectId, driveToken, ...p }).catch(() => {});

  // The OUTPUT mirrors the UPLOAD's shape — probe the source's real frame size
  // instead of assuming vertical (a square upload used to come back square even
  // when the render asked for 9:16, because the start-frame image was 1:1).
  const sourceAspect = await probeSourceAspect(sourceVideoUrl);
  await patch({ sourceAspect });

  // ── WEB / APP references ──────────────────────────────────────────────────
  // "web": live headless screenshots of the site. "app": the app's REAL store
  // screenshots (iTunes lookup / Play page crawl), falling back to a phone-
  // viewport page capture. The shots are hosted Kie-safe, persisted for the
  // render step, and vision-described so the plan knows what it's showing.
  const captureReferenceScreens = async (): Promise<{ urls: string[]; context: string }> => {
    let urls: string[] = [];
    if (refMode === "web" && referenceUrl) {
      await patch({ statusMessage: "Screenshotting your website…" });
      const { captureUrlScreenshots } = await import("@/lib/server/screenshotUrl");
      urls = await captureUrlScreenshots(referenceUrl, { device: "web", timeoutMs: 80_000 });
    } else if (refMode === "app" && appStoreUrl) {
      await patch({ statusMessage: "Fetching your app's screenshots…" });
      const { fetchAppStoreScreenshots } = await import("@/lib/server/appStoreScreenshots");
      urls = await fetchAppStoreScreenshots(appStoreUrl);
      if (urls.length === 0) {
        const { captureUrlScreenshots } = await import("@/lib/server/screenshotUrl");
        urls = await captureUrlScreenshots(appStoreUrl, { device: "app", timeoutMs: 80_000 });
      }
    }
    if (urls.length === 0) return { urls, context: "" };
    await patch({ screenshotUrls: JSON.stringify(urls) });
    try {
      const { callGeminiVision } = await import("@/lib/server/kie-claude");
      const context = await callGeminiVision({
        system: refMode === "app"
          ? "These are REAL screenshots of a mobile app. Describe in 3-4 concrete sentences: what the app is/does, its name if visible, its UI look (colors, layout, key screens shown). This grounds an AI video so it shows THIS exact app on screen."
          : "These are REAL screenshots of a website. Describe in 3-4 concrete sentences: what the site/product is, its brand name, layout, colors and hero message. This grounds an AI video so it shows THIS exact site on screen.",
        user: "Describe for faithful reproduction in a video.",
        images: urls.slice(0, 3),
        maxTokens: 250,
      });
      return { urls, context: context.replace(/\s+/g, " ").trim() };
    } catch {
      return { urls, context: "" };
    }
  };

  // ── RUNWAY ALEPH path — EDIT the original footage, don't regenerate it ───
  // Aleph rewrites only what the prompt asks (swap the product, change branding,
  // …) and keeps every other pixel as filmed — camera angles, motion, timing.
  // No understand/replan; render-step composes the edit prompt from the
  // operator's instruction + the product vision description and runs one task.
  if (engine === "aleph") {
    try {
      const alephScreens = await captureReferenceScreens();
      if (!userPrompt && !productImageUrl && alephScreens.urls.length === 0) {
        const message = "Runway Aleph needs a direction — write a prompt, upload a product image, or point at a website/app.";
        await patch({ phase: "failed", error: message, statusMessage: `Failed: ${message}` });
        return NextResponse.json({ ok: false, error: message }, { status: 400 });
      }
      let productDescription = "";
      if (productImageUrl) {
        await patch({ statusMessage: "Studying your product…" });
        productDescription = await describeProductImage(productImageUrl);
        if (productDescription) await patch({ productDescription });
      } else if (alephScreens.context) {
        // Screen context doubles as the "product" description for the edit prompt.
        productDescription = alephScreens.context;
        await patch({ productDescription });
      }
      await patch({
        phase: "video",
        clipIndex: 0,
        statusMessage: "Editing the original footage with Runway Aleph…",
      });
      void fetch(`${selfLoopbackBase()}/api/recreate/render-step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projectId, driveToken }),
      }).catch(() => {});
      return NextResponse.json({ ok: true, projectId });
    } catch (e) {
      const message = e instanceof Error ? e.message : "aleph preparation failed";
      await patch({ phase: "failed", error: message, statusMessage: `Failed: ${message.slice(0, 160)}` });
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }
  }

  // ── WAN ANIMATE path — a different algorithm entirely ────────────────────
  // No understanding, no replan, no prompts: Kie's wan/2-2-animate-replace takes
  // the SOURCE video + one character image and swaps the person in the footage,
  // preserving the original motion, expressions, scene, audio timing and length.
  if (engine === "wan") {
    try {
      // Kie caps Wan inputs at 10MB — compress + re-host the source if needed.
      await patch({ statusMessage: "Preparing your video for the presenter swap…" });
      const prep = await prepareWanSource(sourceVideoUrl);
      let wanSourceUrl = sourceVideoUrl;
      if (prep.bytes) {
        const { url: hosted } = await putVideo(prep.bytes, { keyPrefix: "sources" });
        wanSourceUrl = hosted;
      }

      // Character image: the user's upload, or a generated CANDID iPhone-style
      // presenter (realistic, unposed) when nothing was uploaded.
      let characterUrl = characterImageUrl;
      if (!characterUrl) {
        await patch({ statusMessage: "Casting the presenter…" });
        const imgEngine = resolveImageEngine(undefined);
        const persona = race === "match_original" ? "person" : `${raceDescriptor(race)} person`;
        // Ground the generated presenter in the ORIGINAL footage: a real frame
        // from the upload rides along as an image reference, so the cast keeps
        // the same framing/lighting/setting — only the person is different.
        const frameRef = await samplePresenterFrame(sourceVideoUrl, 1);
        const { imageUrl } = await generateCarouselImage({
          prompt: frameRef
            ? `Using the reference image (a real frame from a video): recreate this EXACT shot — identical framing, camera angle, background, setting and lighting — but replace the person with a DIFFERENT ${persona}. The new person must look like a completely real human being: photorealistic, natural imperfect skin texture with visible pores, realistic eyes and hair, candid unposed expression, everyday clothes — absolutely not illustrated, not CGI, not airbrushed. Only one person in frame.`
            : `Candid unposed photo of a ${persona}, half-body, facing the camera, natural indoor lighting, shot on an iPhone front camera, hyper-photorealistic real human with natural imperfect skin texture and everyday clothes, slightly imperfect casual framing, absolutely not illustrated or CGI, only one person in frame`,
          engine: imgEngine,
          aspectRatio: sourceAspect,
          refImageUrls: frameRef ? [frameRef] : undefined,
          apiKey: process.env.KIE_API_KEY,
        });
        characterUrl = imageUrl;
      }

      await patch({
        wanSourceUrl,
        characterImageUrl: characterUrl,
        avatarUrl: characterUrl,
        phase: "video",
        clipIndex: 0,
        statusMessage: "Swapping the presenter with Wan Animate…",
      });

      void fetch(`${selfLoopbackBase()}/api/recreate/render-step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projectId, driveToken }),
      }).catch(() => {});

      return NextResponse.json({ ok: true, projectId });
    } catch (e) {
      const message = e instanceof Error ? e.message : "wan preparation failed";
      await patch({ phase: "failed", error: message, statusMessage: `Failed: ${message.slice(0, 160)}` });
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }
  }

  try {
    // ── UNDERSTAND ─────────────────────────────────────────────────────────
    await patch({ statusMessage: "Watching the source video…" });
    const { scenes, plotSummary } = await understandVideo(sourceVideoUrl);
    await patch({ scenes: JSON.stringify(scenes), statusMessage: `Understood ${scenes.length} scene${scenes.length === 1 ? "" : "s"} — planning the recreation…` });

    // ── PRODUCT ────────────────────────────────────────────────────────────
    // Resolve the ACTUAL product image(s) to send to Kie: the user's upload
    // (if any) as the primary reference, plus — when a product link is given —
    // AI-picked matching shots scraped off that website, so the render has
    // multiple precise looks at the real product instead of one flat photo.
    // "" / no images on failure → old generic substitution, never blocks the render.
    let productDescription = "";
    let resolvedProductImageUrl = productImageUrl;
    let productImageUrls: string[] = [];
    if (refMode === "product" && (productImageUrl || referenceUrl)) {
      await patch({ statusMessage: productImageUrl ? "Studying your product…" : "Finding your product on the site…" });
      const resolved = await resolveProductReferences({ productImageUrl, referenceUrl });
      if (resolved) {
        resolvedProductImageUrl = resolved.productImageUrl;
        productImageUrls = resolved.productImageUrls;
        productDescription = resolved.productDescription;
        await patch({
          productImageUrl: resolvedProductImageUrl,
          productImageUrls: JSON.stringify(productImageUrls),
          productDescription,
        });
      }
    }

    // ── RESEARCH ───────────────────────────────────────────────────────────
    // Agentic grounding step: crawl the user's link and fuse it with the image
    // description into a FOCUS BRIEF, so the replan sells what the user
    // actually sells (real claims, tone, CTA) instead of guessing.
    let focusBrief = "";
    if (referenceUrl) {
      await patch({ statusMessage: "Researching your link…" });
      focusBrief = await researchReference({ referenceUrl, productDescription: productDescription || undefined });
      if (focusBrief) await patch({ focusBrief });
    }

    // ── WEB/APP SCREENS ────────────────────────────────────────────────────
    // Web mode: live site screenshots. App mode: real app-store screenshots.
    // The shots become render references; their vision description grounds the
    // replan so scenes show THIS site/app on laptop/phone screens.
    const screens = await captureReferenceScreens();
    if (screens.context) {
      focusBrief = [
        focusBrief,
        `${refMode === "app" ? "THE APP" : "THE WEBSITE"} being promoted (real screenshots are attached as visual references — any scene showing a screen must show THIS ${refMode === "app" ? "app's UI" : "website"}): ${screens.context}`,
      ].filter(Boolean).join("\n");
      await patch({ focusBrief });
    }

    // ── REPLAN ─────────────────────────────────────────────────────────────
    await patch({ phase: "planning" });
    const { beats } = await replanRecreation({
      scenes, language, race,
      hasProductImage: !!resolvedProductImageUrl,
      productDescription: productDescription || undefined,
      focusBrief: focusBrief || undefined,
      userPrompt,
      plotSummary: plotSummary || undefined,
    });

    // ── Presenter reference image (Grok's start frame + identity lock) ──
    // The operator's OWN avatar upload wins outright: it becomes the start
    // frame / identity lock directly. Otherwise generate one: a REAL frame
    // from the first scene rides along as an image reference, so the generated
    // presenter inherits the ORIGINAL video's framing, setting and lighting —
    // the recreation looks like the same video with only the person changed,
    // and the start frame's shape matches the upload (a 1:1 studio portrait
    // here is what made every output come back square).
    let avatarUrl = characterImageUrl ?? "";
    if (!avatarUrl) {
      await patch({ statusMessage: "Casting the presenter…" });
      const imgEngine = resolveImageEngine(undefined);
      const firstSceneMid = scenes.length ? Math.max(0.5, (scenes[0].start + scenes[0].end) / 2) : 1;
      const frameRef = await samplePresenterFrame(sourceVideoUrl, firstSceneMid);
      const personaDesc = race === "match_original" ? "person" : `${raceDescriptor(race)} person`;
      const generated = await generateCarouselImage({
        prompt: frameRef
          ? `Using the reference image (a real frame from the original video): recreate this EXACT shot — identical framing, camera angle, background, setting, lighting and mood — but replace the presenter with a DIFFERENT ${personaDesc}. The new presenter must look like a completely real human: photorealistic, natural imperfect skin texture with visible pores, realistic eyes/hair/teeth, natural expression looking at the camera — absolutely not illustrated, not CGI, not airbrushed, no plastic skin. Only one person in frame.`
          : `Portrait of a ${personaDesc}, friendly presenter look, looking directly at camera, upper body, natural indoor setting, natural lighting, hyper-photorealistic real human with natural imperfect skin texture, absolutely not illustrated or CGI, high detail`,
        engine: imgEngine,
        aspectRatio: sourceAspect,
        refImageUrls: frameRef ? [frameRef] : undefined,
        apiKey: process.env.KIE_API_KEY,
      });
      avatarUrl = generated.imageUrl;
    }

    await patch({
      avatarUrl,
      beats: JSON.stringify(beats),
      phase: "video",
      clipIndex: 0,
      statusMessage: `Recreation planned (${beats.length} scenes) — rendering clip 1…`,
    });

    void fetch(`${selfLoopbackBase()}/api/recreate/render-step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projectId, driveToken }),
    }).catch(() => {});

    return NextResponse.json({ ok: true, projectId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "recreation planning failed";
    await patch({ phase: "failed", error: message, statusMessage: `Failed: ${message.slice(0, 160)}` });
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
