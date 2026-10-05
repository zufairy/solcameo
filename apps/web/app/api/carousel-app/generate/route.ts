import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { callClaudeJSON } from "@/lib/server/kie-claude";
import { resolveImageEngine } from "@/lib/builder/imageEngines";
import { generateCarouselImage } from "@/lib/server/carouselImage";
import { normalizeImagesForKie } from "@/lib/server/imageForKie";
import { requireAuth } from "@/lib/server/requireAuth";
import type { Id } from "@/convex/_generated/dataModel";

// Sequential KIE generation across every slide + a caption call — this is the
// slow "automate the whole carousel" step, so give it maximum room.
export const runtime = "nodejs";
export const maxDuration = 300;

interface IdeaSlideIn { prompt: string }

// Body: { prompt, style, websiteUrl?, referenceImageUrl?, websiteScreenshotUrl?, title, hook, slides }
// Standalone auto-pipeline: persists a carouselProjects row immediately (status
// "generating"), renders every slide's image in sequence via KIE (patching the
// row as each finishes so a client polling `get` sees live progress), then asks
// Claude for one caption, and marks the project "ready". No manual per-slide
// button — this route IS the whole generation for the /carousel app.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: {
    prompt?: string;
    style?: string;
    /** Image engine picked in the UI dropdown (nano-banana-2 / nano-banana-2-lite /
     *  gpt-image-2). Unknown/absent falls back to nano-banana-2. */
    engineId?: string;
    websiteUrl?: string;
    websiteDevice?: string;
    referenceImageUrl?: string;
    /** Hero frame from the live website/app screenshot captured at ideation time
     *  (lib/server/screenshotUrl.ts) — used as a REAL visual reference alongside
     *  (or instead of) an uploaded image, not just a text description. */
    websiteScreenshotUrl?: string;
    /** Product photo crawled off the brand's website at ideation time (product
     *  mode) — passed as a KIE reference so slides show the real product. */
    productImageUrl?: string;
    title?: string;
    hook?: string;
    slides?: IdeaSlideIn[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  const title = (body.title ?? "").trim();
  const hook = (body.hook ?? "").trim();
  const style = (body.style ?? "ugc").trim();
  const slidePrompts = (body.slides ?? [])
    .filter((s) => s && typeof s.prompt === "string" && s.prompt.trim())
    .map((s) => s.prompt.trim())
    .slice(0, 8);
  if (!prompt) return NextResponse.json({ ok: false, error: "prompt is required" }, { status: 400 });
  if (!title) return NextResponse.json({ ok: false, error: "title is required" }, { status: 400 });
  if (slidePrompts.length === 0) return NextResponse.json({ ok: false, error: "at least one slide prompt is required" }, { status: 400 });

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!secret) return NextResponse.json({ ok: false, error: "Server not configured (INTERNAL_CRON_SECRET)" }, { status: 503 });

  const projectId = (await convex.mutation(api.carouselProjects.create, {
    ownerId: auth.user.id,
    prompt,
    style,
    websiteUrl: body.websiteUrl?.trim() || undefined,
    referenceImageUrl: body.referenceImageUrl?.trim() || body.productImageUrl?.trim() || body.websiteScreenshotUrl?.trim() || undefined,
    title,
    hook,
    slides: slidePrompts.map((p) => ({ prompt: p, status: "pending" as const })),
    authSecret: secret,
  })) as Id<"carouselProjects">;

  // Engine comes from the UI dropdown. Only the three carousel-offered engines
  // are honored (all read references — nano-banana natively via `image_input`,
  // gpt-image-2 via createImageTask's image-to-image reroute); anything else
  // falls back to Nano Banana 2, the app's default.
  const ALLOWED_ENGINES = new Set(["nano-banana-2", "nano-banana-2-lite", "gpt-image-2"]);
  const requestedEngine = (body.engineId ?? "").trim();
  const engine = resolveImageEngine(ALLOWED_ENGINES.has(requestedEngine) ? requestedEngine : "nano-banana-2");

  let refImageUrls: string[] = [];
  // Order = priority: the uploaded product/reference photo first, then the
  // crawled product image, then the whole-page screenshot for brand look.
  const rawRefs = [body.referenceImageUrl?.trim(), body.productImageUrl?.trim(), body.websiteScreenshotUrl?.trim()]
    .filter((u): u is string => !!u)
    .slice(0, 3); // Veo/nano-banana-style ref limits — up to 3 is plenty for a carousel slide
  if (rawRefs.length > 0 && engine.acceptsReferences) {
    try {
      refImageUrls = await normalizeImagesForKie(rawRefs);
    } catch {
      refImageUrls = []; // best-effort — a bad ref shouldn't block the whole run
    }
  }

  let anyGenerated = false;
  for (let i = 0; i < slidePrompts.length; i++) {
    try {
      const { imageUrl } = await generateCarouselImage({
        prompt: slidePrompts[i],
        engine,
        aspectRatio: "9:16",
        refImageUrls: refImageUrls.length > 0 ? refImageUrls : undefined,
        apiKey: process.env.KIE_API_KEY,
      });
      anyGenerated = true;
      await convex.mutation(api.carouselProjects.patchSlide, {
        id: projectId, index: i, imageUrl, status: "generated", authSecret: secret,
      });
    } catch (e) {
      console.error(`[carousel-app/generate] slide ${i + 1} failed:`, e);
      await convex.mutation(api.carouselProjects.patchSlide, {
        id: projectId, index: i, status: "failed",
        error: e instanceof Error ? e.message : "generation failed",
        authSecret: secret,
      });
    }
  }

  let caption: string | undefined;
  if (anyGenerated) {
    try {
      const result = await callClaudeJSON<{ caption?: string }>({
        system: "You write captions the way a real person posts on TikTok/IG — casual, lowercase-leaning, a little unpolished. ONE caption: a scroll-stopping first line (a hot take, confession, or 'wait…' moment tied to the carousel's actual content), then at most 1-2 short conversational sentences, then a soft engagement nudge if it fits naturally (e.g. 'which one are you picking' / 'save this for later'). RULES: NO hashtags at all. No emojis beyond one, max. Never sound like marketing copy — ban words like 'elevate', 'unleash', 'discover', 'game-changer', 'transform'. No colons-after-hooks formula, no 'Here's why'. Write like you'd text a friend about it. Respond with ONLY this JSON shape, no prose: {\"caption\": string}",
        user: `Title: ${title}\nHook: ${hook}\nStyle: ${style}\nOriginal idea: ${prompt}`,
        maxTokens: 400,
      });
      caption = typeof result.caption === "string" ? result.caption : undefined;
    } catch (e) {
      console.warn(`[carousel-app/generate] caption generation failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  await convex.mutation(api.carouselProjects.finish, {
    id: projectId,
    caption,
    status: anyGenerated ? "ready" : "failed",
    authSecret: secret,
  });

  return NextResponse.json({ ok: true, projectId });
}
