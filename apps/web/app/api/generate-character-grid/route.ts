import { NextRequest, NextResponse } from "next/server";
import { putImage } from "@/lib/server/imageStorage";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { sleep, fetchWithTimeout, PRIMARY_MODEL, MAX_ATTEMPTS } from "@/lib/server/nftKie";

// CREATE step only — fast. Uploads the reference image(s), kicks off the KIE grid
// render task, and RETURNS IMMEDIATELY with the task id. It does NOT poll or mirror
// — that used to hold the request open for up to ~4 minutes, which the Railway proxy
// killed. The caller polls the sibling /collect route until the grid image is ready.
// (The grid is a fire-and-forget bonus that is never shown in the UI, so a caller
// that gives up mid-poll simply skips saving the bonus metadata — nothing breaks.)
// 90s covers the worst-case createGridTask retry/backoff + single-image fallback,
// still far below the ~4-minute window that triggered the Railway HTML-timeout.
export const maxDuration = 90;

const KIE_KEY    = process.env.KIE_API_KEY ?? "";
const KIE_CREATE = "https://api.kie.ai/api/v1/jobs/createTask";

async function uploadRefToSupabase(
  base64: string,
  mimeType: string,
): Promise<string | null> {
  // Name kept for call-site stability; bytes now go to R2 (Supabase project is
  // quota-restricted — see lib/server/imageStorage.ts).
  try {
    const buffer = Buffer.from(base64, "base64");
    return (await putImage(buffer, mimeType, { keyPrefix: "avatars/refs" })).url;
  } catch (err) {
    console.error("[generate-character-grid] upload threw:", err);
    return null;
  }
}

type CreateOpts = {
  prompt: string;
  refImageUrls: string[];
  attempt?: number;
  /** If true, fall back to single-image mode using only the first url */
  forceSingle?: boolean;
};

async function createGridTask(opts: CreateOpts): Promise<string> {
  const { prompt, refImageUrls, attempt = 1, forceSingle = false } = opts;
  // nano-banana-pro takes references as the `image_input` ARRAY (up to 8) — there
  // is no `image_strength`, `image_url`, or comma-joined `image_urls` param.
  const input: Record<string, unknown> = {
    prompt,
    aspect_ratio: "4:3",
    resolution: "2K",
  };
  if (refImageUrls.length > 0) {
    input.image_input = (forceSingle ? refImageUrls.slice(0, 1) : refImageUrls).slice(0, 8);
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(KIE_CREATE, {
      method: "POST",
      headers: { Authorization: `Bearer ${KIE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: PRIMARY_MODEL, input }),
    }, 25_000);
  } catch (networkErr) {
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[generate-character-grid] network error attempt ${attempt}, retrying…`);
      await sleep(2000 * attempt);
      return createGridTask({ ...opts, attempt: attempt + 1 });
    }
    throw networkErr;
  }

  if (!res.ok) {
    const text = await res.text();
    const transient = res.status >= 500 || /bad.?gateway|timeout|rate.?limit|429/i.test(text);
    if (transient && attempt < MAX_ATTEMPTS) {
      await sleep(2000 * attempt);
      return createGridTask({ ...opts, attempt: attempt + 1 });
    }
    // If multi-ref failed validation → fall back to single-image
    if (!forceSingle && refImageUrls.length > 1 && /image_input|image_urls|image_url|invalid|param/i.test(text)) {
      console.warn("[generate-character-grid] multi-ref rejected, falling back to single image");
      return createGridTask({ ...opts, forceSingle: true, attempt: 1 });
    }
    throw new Error(`createGridTask HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json() as { code: number; msg: string; data: { taskId: string } };
  if (json.code !== 200) {
    if (!forceSingle && refImageUrls.length > 1 && /image_input|image_urls|image_url|invalid|param|unsupported/i.test(json.msg)) {
      console.warn(`[generate-character-grid] multi-ref API rejected (${json.msg}), falling back`);
      return createGridTask({ ...opts, forceSingle: true, attempt: 1 });
    }
    if (attempt < MAX_ATTEMPTS && /(rate|timeout|busy|temporar)/i.test(json.msg)) {
      await sleep(2000 * attempt);
      return createGridTask({ ...opts, attempt: attempt + 1 });
    }
    throw new Error(`createGridTask error: ${json.msg}`);
  }
  return json.data.taskId;
}

function buildGridPrompt(refCount: number, characterBible?: string, name?: string): string {
  const refRef = refCount === 1
    ? "the reference image"
    : `the ${refCount} reference images`;
  return [
    `A precise character turnaround sheet showing the EXACT SAME character from ${refRef}, arranged in a clean 3×3 grid (7 filled cells, last 2 cells empty/blank background). Identical face, identical skin tone, identical hair, identical outfit, identical art style across all 7 poses — DO NOT alter the character's identity in any way.`,
    ``,
    `GRID LAYOUT (left-to-right, top-to-bottom):`,
    `1. TOP-LEFT: Full-body front pose, standing tall, neutral expression, arms relaxed at sides.`,
    `2. TOP-CENTER: 3/4 angle headshot, soft smile, looking directly at camera, shoulders up.`,
    `3. TOP-RIGHT: Full-body side profile, walking pose, looking forward, mid-stride.`,
    `4. MIDDLE-LEFT: Full-body back view, standing, facing away from camera.`,
    `5. MIDDLE-CENTER: Dynamic action pose — caught mid-motion with a bright laugh, energetic.`,
    `6. MIDDLE-RIGHT: Sitting pose, casual relaxed posture, looking thoughtful.`,
    `7. BOTTOM-LEFT: Close-up portrait, intense direct gaze, half-smirk.`,
    `8. BOTTOM-CENTER: empty (blank background, matching grid spacing).`,
    `9. BOTTOM-RIGHT: empty (blank background, matching grid spacing).`,
    ``,
    `CRITICAL CONSISTENCY RULES:`,
    `- Match the EXACT visual medium of the references (if photos → photos, if cartoon → cartoon — no style mixing).`,
    `- Match the EXACT outfit shown in the references — same clothing items, same colors, same accessories.`,
    `- Match the EXACT hairstyle, hair color, and facial features.`,
    `- Use natural studio lighting with soft shadows, neutral seamless backdrop in light gray/cream tone.`,
    `- Each pose should have the same lighting setup so the grid looks cohesive.`,
    `- Clean grid lines between cells (thin 2px white spacing).`,
    `- No text, no labels, no watermarks — just the 7 character poses + 2 empty cells.`,
    characterBible ? `\nCHARACTER BIBLE: ${characterBible}` : ``,
    name ? `CHARACTER NAME: ${name}` : ``,
  ].filter(Boolean).join("\n");
}

// ── Main handler (CREATE) ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // AUTH GATE — this route spends KIE image-generation credits on every call.
    // Require an internal secret or a logged-in user; without this, anonymous
    // callers could burn paid image credits at will (A4 abuse).
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;

    if (!KIE_KEY) {
      return NextResponse.json({ error: "KIE_API_KEY is not set" }, { status: 500 });
    }

    const body = await req.json() as {
      images?: Array<{ data: string; mimeType: string }>;
      characterBible?: string;
      name?: string;
    };

    const images = (body.images ?? []).filter((i) => i && i.data).slice(0, 3);
    if (images.length === 0) {
      return NextResponse.json({ error: "At least 1 reference image is required" }, { status: 400 });
    }

    // Upload all ref images to Supabase Storage → public URLs
    const uploadResults = await Promise.all(
      images.map((img) => uploadRefToSupabase(img.data, img.mimeType ?? "image/jpeg")),
    );
    const refImageUrls = uploadResults.filter((u): u is string => typeof u === "string");
    if (refImageUrls.length === 0) {
      return NextResponse.json({ error: "Could not host reference images" }, { status: 500 });
    }

    const prompt = buildGridPrompt(refImageUrls.length, body.characterBible, body.name);

    // Kick off the render and return the task id immediately — the caller polls
    // /collect for the finished grid image.
    const taskId = await createGridTask({ prompt, refImageUrls });

    return NextResponse.json({
      ok: true,
      taskId,
      prompt,
      refImageUrls,
    });
  } catch (err) {
    console.error("[generate-character-grid]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Grid generation failed" },
      { status: 500 },
    );
  }
}
