import { NextRequest, NextResponse } from "next/server";
import { hostBase64ForKie } from "@/lib/server/imageForKie";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { createNftTask } from "@/lib/server/nftKie";

// CREATE step only — fast. This route uploads the reference photo(s) (needed
// before createTask), kicks off the KIE render task(s), and RETURNS IMMEDIATELY
// with the task ids. It does NOT poll, download, or assemble the GIF — that used
// to hold the request open for ~4 minutes, which the Railway proxy killed with an
// HTML error page. The client polls the sibling /collect route until the images
// are ready.
// 90s comfortably covers the worst-case createTask retry/backoff (2 tasks in
// parallel, ~66s max) — still far below the ~4-minute window that triggered the
// Railway HTML-timeout this change fixes.
export const maxDuration = 90;

const KIE_KEY = process.env.KIE_API_KEY ?? "";

// Labels for the two generated frames, paired 1:1 with [prompt_1, prompt_2]. The
// user's ORIGINAL uploaded photo becomes frame 1 of the GIF (assembled in
// /collect), so the final loop is [original, dynamic, top-side].
const FRAME_LABELS = ["Dynamic Shot", "Top-Side Angle"] as const;

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // AUTH GATE — this route spends KIE credits on every call. Require either a
    // valid internal secret (server-to-server) or a logged-in user session
    // (the pre-mint builder/avatar flow always has one). Without this, anonymous
    // callers could burn paid image-generation credits at will (A4 abuse).
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;

    if (!KIE_KEY) {
      return NextResponse.json({ error: "KIE_API_KEY is not set" }, { status: 500 });
    }

    const body = await req.json() as {
      prompt_1: string;
      // Optional — omit for a single-image render (e.g. trader/clipper cover
      // art). When provided, a second frame is rendered in parallel (the
      // 3-photo influencer GIF flow needs both poses).
      prompt_2?: string;
      // Preferred: all of the user's uploaded reference photos of the same person
      referenceImages?: Array<{ data: string; mimeType?: string }>;
      // Back-compat: single reference image
      referenceImageBase64?: string;
      referenceImageMime?: string;
    };

    const { prompt_1, prompt_2, referenceImages, referenceImageBase64, referenceImageMime = "image/jpeg" } = body;
    if (!prompt_1) {
      return NextResponse.json({ error: "prompt_1 is required" }, { status: 400 });
    }

    // Normalize incoming references into a single list (array form preferred,
    // single-image form kept for back-compat). Cap at 8 — the model's limit.
    const refInputs: Array<{ data: string; mimeType: string }> = [];
    if (Array.isArray(referenceImages) && referenceImages.length > 0) {
      for (const r of referenceImages) {
        if (r?.data) refInputs.push({ data: r.data, mimeType: r.mimeType ?? "image/jpeg" });
      }
    } else if (referenceImageBase64) {
      refInputs.push({ data: referenceImageBase64, mimeType: referenceImageMime });
    }

    // Upload ALL reference photos to Supabase as Kie-safe PUBLIC .png URLs the
    // model can actually read. hostBase64ForKie transcodes to PNG — uploading the
    // raw jpg/webp makes nano-banana-pro reject the reference ("image_input file
    // type not supported"), after which createTask drops it and renders a generic
    // face. Passing every uploaded photo of the same person locks their likeness
    // across all generated poses far better than a single reference.
    const uploaded = await Promise.all(
      refInputs.slice(0, 8).map((r, i) => hostBase64ForKie(r.data, i)),
    );
    const refImageUrls = uploaded.filter((u): u is string => Boolean(u));
    if (refInputs.length > 0 && refImageUrls.length === 0) {
      // The user uploaded a reference photo specifically so the render matches
      // that person. Rendering WITHOUT it silently produces a generic face and
      // burns Kie credits — fail loudly instead so the real problem (almost
      // always missing SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL on
      // the deployment) surfaces in the UI instead of as a wrong likeness.
      console.error(
        "[generate-nft-images] reference photo(s) provided but none could be hosted — refusing to render without the likeness. Check SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL on this deployment.",
      );
      return NextResponse.json(
        {
          error:
            "Your reference photo couldn't be uploaded to image storage, so the result would not look like your reference. Server config issue (SUPABASE_SERVICE_ROLE_KEY) — fix the deployment env and try again.",
        },
        { status: 502 },
      );
    }
    console.log(`[generate-nft-images] using ${refImageUrls.length} reference image(s)`);

    // Launch frame(s) in parallel — same person, different poses/angles. Each
    // task gets the SAME full set of reference images for identity lock. This is
    // the ONLY slow-ish work here (createTask returns a taskId in seconds), so the
    // request returns almost immediately; polling happens client-side via /collect.
    // prompt_2 omitted → single-image render (one KIE task instead of two).
    const frames = prompt_2
      ? [
          { prompt: prompt_1, label: FRAME_LABELS[0] },
          { prompt: prompt_2, label: FRAME_LABELS[1] },
        ]
      : [{ prompt: prompt_1, label: FRAME_LABELS[0] }];
    const tasks = await Promise.all(
      frames.map(async (f) => ({ taskId: await createNftTask(f.prompt, refImageUrls), label: f.label })),
    );

    return NextResponse.json({
      ok: true,
      // The client echoes these straight back to /collect.
      tasks,
      refImageUrls,
    });
  } catch (err) {
    console.error("[generate-nft-images]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 },
    );
  }
}
