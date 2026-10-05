import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { resolveImageEngine } from "@/lib/builder/imageEngines";
import { generateCarouselImage } from "@/lib/server/carouselImage";
import { normalizeImagesForKie } from "@/lib/server/imageForKie";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

// Image generation is slow (KIE create → poll → persist), so give the route room
// instead of a short default surfacing as a gateway 502. Node runtime: the KIE
// helpers + Supabase persistence use Node APIs.
export const runtime = "nodejs";
export const maxDuration = 300;

// Body: { username (mintAddress), sessionId?, prompt, engineId?, aspectRatio? }
// Generates ONE KIE image on the requested engine from the RAW operator prompt,
// persists it to a durable URL, and records it in carouselImages (history).
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  let body: {
    username?: string;
    sessionId?: string;
    prompt?: string;
    engineId?: string;
    aspectRatio?: string;
    /** Generate tab (AI Influencer): operator-picked reference images (dragged
     *  cards — uploads or earlier generations), REPLACING the auto agent-stills
     *  lookup below when non-empty. Lets the operator generate "this exact photo
     *  in a different style" instead of always defaulting to the agent's face. */
    referenceImageUrls?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const mintAddress = (body.username ?? "").trim();
  const prompt = (body.prompt ?? "").trim();
  if (!mintAddress) return NextResponse.json({ ok: false, error: "username is required" }, { status: 400 });
  if (!prompt) return NextResponse.json({ ok: false, error: "prompt is required" }, { status: 400 });
  if (prompt.length > 20_000) return NextResponse.json({ ok: false, error: "prompt too long (max 20,000 chars)" }, { status: 400 });

  const engine = resolveImageEngine(body.engineId);

  // Ownership: body.username is the agent's mintAddress, so verify the caller
  // owns this agent before spending a KIE generation on its behalf. Mirrors
  // /api/social/post — fail CLOSED, no-op for legacy/pre-mint agents. The whole
  // lookup is wrapped so a Convex hiccup returns a CLEAN JSON error instead of a
  // bare 500 "Internal Server Error" page.
  let agent: { creatorWallet?: string; avatarStills?: string[]; avatarUrl?: string } | null | undefined;
  let convex: ConvexHttpClient | null = null;
  let secret = "";
  try {
    const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
    convex = new ConvexHttpClient(CONVEX_URL);
    secret = process.env.INTERNAL_CRON_SECRET ?? "";
    agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
    if (!auth.internal) {
      const err = requireOwnerWithSiws(auth, agent);
      if (err) return err;
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Could not verify agent ownership: ${e instanceof Error ? e.message : "internal error"}` },
      { status: 502 },
    );
  }

  try {
    // ALWAYS pass the AI influencer's OWN generated stills to KIE as reference
    // images (the nano-banana engines read `image_input`), so every carousel slide
    // keeps the agent's look instead of a generic model face. avatarStills are the
    // http still frames minted with the agent; the display avatarUrl is usually an
    // animated GIF (which KIE's image models can't read), so it's only included as
    // a fallback when it's a real static image. Best-effort + normalized to
    // Kie-safe public .png — a bad ref is dropped, never a hard failure.
    const explicitRefs = (body.referenceImageUrls ?? []).filter((u) => typeof u === "string" && u.trim()).slice(0, 8);
    const stills = (agent?.avatarStills ?? []).filter(Boolean);
    const avatarFallback = agent?.avatarUrl && !/\.gif/i.test(agent.avatarUrl) ? [agent.avatarUrl] : [];

    // An operator EXPLICITLY attached reference cards (Generate tab) but this
    // engine can't use them at all — silently generating a plain text-to-image
    // result and calling it a success is exactly the "why doesn't this look like
    // my reference" bug. Fail loud instead so the operator knows to switch models.
    // (gpt-image-2 / qwen-image-3 both read `acceptsReferences: true` even though
    // their OWN slug is text-only — createImageTask reroutes them to their
    // separate image-to-image sibling model, so this check is still accurate.)
    if (explicitRefs.length > 0 && !engine.acceptsReferences) {
      return NextResponse.json(
        { ok: false, error: `${engine.label} doesn't accept reference images (text-to-image only) — pick a Nano Banana engine to use your attached reference.` },
        { status: 400 },
      );
    }

    let refImageUrls: string[] = [];
    try {
      // Operator-picked references (Generate tab) win outright — they're an
      // explicit "use THIS image" choice, not a fallback to blend with the
      // agent's own face.
      refImageUrls = await normalizeImagesForKie(
        explicitRefs.length > 0 ? explicitRefs : [...stills, ...avatarFallback].slice(0, 8),
      );
      if (refImageUrls.length > 0) {
        console.log(`[carousel/generate] using ${refImageUrls.length} ${explicitRefs.length > 0 ? "operator-picked" : "agent"} reference image(s)`);
      }
    } catch (e) {
      console.warn(`[carousel/generate] ref normalization failed: ${e instanceof Error ? e.message : e}`);
    }

    // Every explicitly-attached ref got DROPPED during normalization (Kie can't
    // fetch/recognize it — e.g. SUPABASE_SERVICE_ROLE_KEY unset so the extension-
    // less Convex-storage URL couldn't be re-hosted as a real .png). Generating
    // anyway would silently produce a generic image and report success — surface
    // the real reason instead of a mysterious non-match.
    if (explicitRefs.length > 0 && refImageUrls.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Couldn't attach your reference image(s) — the server-side image host isn't configured (SUPABASE_SERVICE_ROLE_KEY). Contact an admin; generating without it would just ignore your reference." },
        { status: 502 },
      );
    }

    const { imageUrl, engineId, engineLabel } = await generateCarouselImage({
      prompt,
      engine,
      aspectRatio: body.aspectRatio,
      refImageUrls: refImageUrls.length > 0 ? refImageUrls : undefined,
      apiKey: process.env.KIE_API_KEY,
    });

    // Record the generation for the history grid. sessionId fallback = mintAddress
    // so pre-mint rows are still listable and minted rows key under by_mint.
    const sessionId = (body.sessionId ?? "").trim() || mintAddress;
    let rowId: string | null = null;
    if (secret && convex) {
      try {
        rowId = await convex.mutation(api.carouselImages.recordGenerated, {
          sessionId,
          mintAddress,
          prompt,
          engineId,
          engineLabel,
          imageUrl,
          aspectRatio: body.aspectRatio,
          authSecret: secret,
        });
      } catch (e) {
        console.warn(`[carousel/generate] record failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    return NextResponse.json({ ok: true, imageUrl, prompt, engineId, engineLabel, rowId });
  } catch (err) {
    console.error(`[carousel/generate] ${engine.id} generation failed:`, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "image generation failed" },
      { status: 502 },
    );
  }
}
