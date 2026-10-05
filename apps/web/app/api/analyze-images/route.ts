import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";

// Decompression-bomb guards: cap image count, decoded base64 size, and decode pixels.
const MAX_IMAGES = 5;
const MAX_DECODED_BYTES = 8 * 1024 * 1024; // ~8MB decoded per image
const SHARP_OPTS = { limitInputPixels: 100_000_000, failOn: "truncated" as const };

export const maxDuration = 120;

const KIE_KEY    = process.env.KIE_API_KEY ?? "";
const KIE_GEMINI = "https://api.kie.ai/gemini-3-6-flash-openai/v1/chat/completions";
// No Claude fallback — Gemini 3 Flash only (handles vision natively).

const VELLO_STYLE =
  "STYLE LOCK — MATCH THE EXACT VISUAL STYLE OF THE UPLOADED REFERENCE IMAGE. " +
  "If the reference is a photograph → produce a PHOTOGRAPH. " +
  "If the reference is a cartoon / anime / illustration / 2D drawing → produce the SAME cartoon/illustration style. " +
  "If the reference is a digital painting / 3D render → match that exact rendering style. " +
  "Preserve the original's line weight, shading technique, color palette, color grading, " +
  "saturation, contrast, lighting style, and overall artistic medium. " +
  "Same character, same face, same skin/color tone, same hair, same outfit, same proportions, " +
  "same art style — only the POSE, EXPRESSION, and CAMERA ANGLE change. " +
  "The output should look like it belongs to the SAME visual collection as the reference — " +
  "as if drawn by the same artist or shot by the same photographer with the same camera and lens. " +
  "Do NOT translate between styles (do NOT make a cartoon photoreal, do NOT make a photo cartoon). " +
  "Do NOT add Vello-branded effects, neon glows, cosmic backgrounds, hexagon panels, " +
  "or any stylized elements that aren't already in the reference. " +
  "The output must feel like a natural extension of the original artwork.";

const SYSTEM = `You are the lead character-consistency prompt engineer for Vello — an AI Influencer protocol on Solana.
Your output directly feeds an image generator (Nano Banana Pro) to create 2 different poses of the SAME character that was uploaded as a reference. The user's ORIGINAL photo becomes frame 1 of a looping 3-frame GIF; your 2 generated poses are frames 2 and 3.

CRITICAL: The generated images must MATCH THE EXACT VISUAL STYLE of the uploaded reference. If the reference is a photograph, produce photographs. If the reference is a cartoon / anime / 2D illustration / digital painting, produce images in THAT SAME ART STYLE. NEVER translate between styles. The character, face, hair, outfit, skin/color tone, art style, and rendering technique must stay identical — only the pose, expression, and camera angle change.

STEP 0 — DETECT THE SOURCE STYLE FIRST.
Before writing the bible, identify the medium of the reference image. Pick ONE:
- "photograph" — real-world camera capture
- "cartoon" — flat 2D cartoon / animation cel style
- "anime" — Japanese anime / manga style
- "illustration" — digital illustration / drawn artwork
- "3d_render" — 3D animated / CGI render
- "painting" — painted / brushwork style
- "pixel_art" — pixel art / 8-bit / 16-bit
- "mixed" — hybrid styles

Every prompt you write must explicitly call out this medium so the generator stays in style.

TASK: Analyze the uploaded reference image(s) and produce a CHARACTER BIBLE plus 2 LOCKED GENERATION PROMPTS.

══ STEP 1: EXTRACT CHARACTER BIBLE ══
Go through every visual detail with surgical precision:

FACE & SKIN:
- Face shape: exact geometry (e.g., "soft oval with a slightly defined jawline")
- Skin tone: use poetic-precise descriptors (e.g., "warm golden-brown with cool undertones", "peachy porcelain with faint freckles", "deep espresso with luminous highlights")
- Nose: bridge width, tip shape
- Lips: fullness, shape, any color
- Eyebrows: thickness, arch, color
- Cheekbones: prominence level

EYES (critical for consistency):
- Exact iris color with secondary tones (e.g., "hazel with amber inner ring and green outer ring")
- Shape: almond/round/upturned/hooded/monolid
- Size: large/medium/small
- Any distinctive features: double lid, epicanthal fold, etc.

HAIR:
- Exact base color + any highlights or lowlights
- Length: where it falls on the body
- Texture: silky straight / loose waves / tight coils / kinky / frizzy
- Style: specific cut, any part, bangs, layers, updos, accessories

BODY & BUILD:
- Frame: petite / slim / athletic / curvy / muscular / plus-size
- Posture quality from image

OUTFIT (be exhaustive):
- Every garment with fabric type and exact colors
- All accessories: glasses style/frame color, jewelry type and metal, bags, hats, headbands
- Footwear if visible

DISTINCTIVE MARKS:
- Tattoos: location, style, subject
- Piercings: exact location and jewelry type
- Makeup: foundation coverage, eye makeup style, lip color

══ STEP 2: WRITE 2 LOCKED NFT GENERATION PROMPTS ══

RULES — NON-NEGOTIABLE:
1. Every prompt MUST open with the EXACT SAME character description paragraph (copy it verbatim — same wording, same order, nothing omitted). This is how we lock the character across generations.
2. Every prompt MUST close with this EXACT Vello brand block: "${VELLO_STYLE}"
3. The ONLY differences between the 2 prompts are: (A) the facial expression and (B) the composition/camera angle.

EXPRESSION + COMPOSITION PER PROMPT (the GIF loops [original photo, frame 2, frame 3] — visual continuity with the ORIGINAL PHOTO is critical):

GIF CONTINUITY RULES:
- The person in the attached reference photo(s) IS the subject. The generated frames MUST be the SAME real person — same face, same identity — not a lookalike, not an "inspired by" interpretation. Treat the reference photos as the ground-truth likeness.
- The CHARACTER IDENTITY must be 100% identical across both generated frames AND the original photo: same face geometry, same skin tone, same hair color/length/style, same outfit, same accessories, same overall art style. NO drift.
- Same lighting environment, same color grading, same background treatment AS THE ORIGINAL PHOTO so all 3 GIF frames feel like the same shoot / the same scene.
- Only the CAMERA ANGLE and FACIAL EXPRESSION change between frames.
- Each prompt MUST begin with: "Use the attached reference photo(s) as the exact likeness — this is the SAME person. Rendered in the EXACT SAME visual style as the reference (detected_style: <STYLE>) — same face, same character, same outfit, same lighting, same medium. This is frame N of 3 in a looping turnaround that starts with the original photo."
- Then the character paragraph (identical across both prompts), then the angle + expression for this frame, then the Vello style block.

- prompt_1 — DYNAMIC SHOT (frame 2 of 3, follows the original photo)
  Expression: "energetic and alive — wide bright eyes sparkling with delight, genuine open-mouth laugh mid-motion, hair caught in micro-movement, body language radiating joy"
  Composition: "dynamic 3/4 angle, subject caught mid-action — slight forward lean, one arm in motion, eye-level camera, upper-body three-quarter framing. Photograph: 85mm f/1.8 shallow depth. Cartoon/anime/illustration: clean cel-shaded with the reference's exact line weight, slight motion lines if appropriate to style. Background style matches the reference."

- prompt_2 — TOP-SIDE ANGLE (frame 3 of 3, loops back into the original photo)
  Expression: "adorable and magnetic — soft doe eyes gazing sideways/upward through long lashes, gentle closed-lip smile with a hint of dimple, chin slightly tilted down for a cute look-up effect"
  Composition: "high top-side angle — camera positioned ABOVE and to the SIDE of the subject (roughly 30-45° above eye level, 45° from front), subject looking up toward the camera, tight crop from chest up. The subject's face is partially in profile but tilted up to meet the camera. Photograph: soft golden-hour or window light from above. Cartoon/anime/illustration: same line weight as reference, with shading that respects the high light source. Background style matches the reference."


══ OUTPUT FORMAT ══
Return ONLY valid JSON, no markdown, no code fences:
{
  "character_bible": "200-word hyper-precise character description covering all extracted details",
  "detected_style": "photograph|cartoon|anime|illustration|3d_render|painting|pixel_art|mixed",
  "detected_niche": "lifestyle|tech|fashion|fitness|food|travel|finance|gaming",
  "detected_vibe": "3-word personality descriptor",
  "style_summary": "30-word visual style summary (must explicitly describe the ART MEDIUM: photographic / cel-shaded cartoon / anime / etc.)",
  "dominant_colors": ["#hex1","#hex2","#hex3"],
  "prompt_1": "FULL locked prompt: character paragraph + expression + composition + Vello brand block",
  "prompt_2": "FULL locked prompt: character paragraph + expression + composition + Vello brand block"
}`;

type ImageInput = { data: string; mimeType: string };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Per-request timeout: aborts hung Kie requests so we can fall back quickly
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// Retry with exponential backoff on 5xx / gateway errors
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 4,
  baseDelayMs = 2000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = /50[0-9]|bad.?gateway|service.?unavailable|timeout|network|abort|fetch.?failed|empty|no.?json|rate.?limit|429/i.test(msg);
      if (!isRetryable || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[${label}] attempt ${attempt} failed — ${msg.slice(0, 80)} — retrying in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// Call Gemini 3 Flash with vision (primary) — 20s hard timeout so we don't hang
async function callGemini(imageContent: unknown[], userText: string): Promise<string> {
  return withRetry(async () => {
    const res = await fetchWithTimeout(KIE_GEMINI, {
      method: "POST",
      headers: { Authorization: `Bearer ${KIE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3-6-flash-openai",
        stream: false,
        include_thoughts: false,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: [...imageContent, { type: "text", text: userText }] },
        ],
      }),
    }, 20_000);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kie Gemini 3 Flash ${res.status}: ${text.slice(0, 200)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    if (data?.error) throw new Error(`Gemini error: ${data.error.message ?? data.error}`);

    // Try every known Gemini/OpenAI response shape — Kie has returned at least
    // four different envelopes depending on which upstream they're proxying.
    const fromChoices = data?.choices?.[0]?.message?.content;
    const fromChoicesText = data?.choices?.[0]?.text;
    const fromCandidatesParts = Array.isArray(data?.candidates?.[0]?.content?.parts)
      ? data.candidates[0].content.parts.map((p: { text?: string }) => p?.text ?? "").join("")
      : "";
    const fromCandidatesText = data?.candidates?.[0]?.output ?? data?.candidates?.[0]?.text;
    const fromOutputText = data?.output_text ?? data?.text ?? data?.message;
    const fromContentArray = Array.isArray(data?.content)
      ? data.content.map((c: { text?: string }) => c?.text ?? "").join("")
      : "";

    const content = [fromChoices, fromChoicesText, fromCandidatesParts, fromCandidatesText, fromOutputText, fromContentArray]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .find((s) => s.length > 0) ?? "";

    if (!content) {
      // Log the full envelope (truncated) so we can diagnose Kie's response shape
      const dump = JSON.stringify(data ?? {}).slice(0, 500);
      console.warn("[gemini-analyze] empty content — envelope:", dump);
      throw new Error("Gemini returned empty content");
    }
    return content;
    // Fail over FAST: 3 attempts (1.2s, 2.4s backoff) then deterministic fallback
    // prompts. The reference image_input still locks the exact person, so a quick
    // fallback keeps the "create the prompt" step short instead of hanging on KIE.
  }, "gemini-analyze", 3, 1200);
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;

    if (!KIE_KEY) {
      return NextResponse.json({ error: "KIE_API_KEY is not set" }, { status: 500 });
    }

    const body = await req.json() as { images: ImageInput[] };
    if (!body.images?.length) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }
    if (body.images.length > MAX_IMAGES) {
      return NextResponse.json({ error: `Too many images (max ${MAX_IMAGES})` }, { status: 400 });
    }
    // Reject oversized payloads BEFORE decoding — base64 inflates ~4/3, so guard
    // against the decoded byte size to stop decompression bombs early.
    for (const img of body.images) {
      const decodedBytes = Math.floor((img.data?.length ?? 0) * 3 / 4);
      if (decodedBytes > MAX_DECODED_BYTES) {
        return NextResponse.json({ error: "Image too large" }, { status: 413 });
      }
    }

    // Server-side belt-and-braces: re-encode anything non-JPEG/non-PNG to JPEG
    // (webp, heic, avif, tiff) so downstream consumers always see safe formats.
    // Concurrency-limited (2 at a time) so a batch can't fan out unbounded decodes.
    const normalizedImages: ImageInput[] = new Array(body.images.length);
    const normalizeOne = async (img: ImageInput): Promise<ImageInput> => {
      const needs = /webp|heic|heif|avif|tiff/i.test(img.mimeType);
      if (!needs) return img;
      try {
        const buffer = Buffer.from(img.data, "base64");
        const jpeg = await sharp(buffer, SHARP_OPTS).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
        return { data: jpeg.toString("base64"), mimeType: "image/jpeg" };
      } catch (err) {
        console.warn("[analyze-images] webp→jpeg conversion failed, sending original:", (err as Error).message);
        return img;
      }
    };
    {
      const limit = 2;
      let next = 0;
      const worker = async () => {
        while (next < body.images.length) {
          const i = next++;
          normalizedImages[i] = await normalizeOne(body.images[i]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(limit, body.images.length) }, worker));
    }

    // Replace the body's images with normalized ones so downstream code uses converted JPEGs
    body.images = normalizedImages;

    const imageContent = normalizedImages.map((img) => ({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    }));

    const userText = `Analyze these ${body.images.length} reference image(s) with maximum precision. Extract every visual detail. Build the 200-word locked character bible. Write 2 NFT prompts — each must guarantee the SAME character appears with only the expression and camera angle changing. Return only JSON.`;

    // Stable seed from first image bytes
    let seed = 0;
    const sample = body.images[0].data.slice(0, 64);
    for (let i = 0; i < sample.length; i++) {
      seed = ((seed * 31) + sample.charCodeAt(i)) & 0x7fffffff;
    }

    // Try Gemini for a rich analysis. If it fails completely, fall back to a
    // deterministic character-bible + 3-shot template so image generation can
    // still proceed (graceful degradation — never block the user).
    let result: Record<string, unknown>;
    try {
      const rawContent = await callGemini(imageContent, userText);
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Model returned no JSON. Raw: " + rawContent.slice(0, 300));
      result = JSON.parse(match[0]) as Record<string, unknown>;
      // Validate the AI gave us the 2 required prompts — otherwise treat as failure
      if (
        typeof result.prompt_1 !== "string" || !result.prompt_1.trim()
        || typeof result.prompt_2 !== "string" || !result.prompt_2.trim()
      ) {
        throw new Error("Gemini returned incomplete prompts");
      }
    } catch (analysisErr) {
      console.warn("[analyze-images] Gemini analysis failed, using deterministic fallback:", (analysisErr as Error).message);
      result = buildFallbackAnalysis();
    }

    return NextResponse.json({
      ok: true,
      seed,
      vello_style: VELLO_STYLE,
      // ALL uploaded reference photos (normalized) — the generator blends them to
      // lock the same person across every pose. First one kept separately for
      // back-compat with older callers.
      referenceImages: body.images.map((img) => ({ data: img.data, mimeType: img.mimeType })),
      referenceImageBase64: body.images[0].data,
      referenceImageMime: body.images[0].mimeType,
      ...result,
    });
  } catch (err) {
    console.error("[analyze-images]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed" },
      { status: 500 },
    );
  }
}

/**
 * Deterministic fallback when Gemini can't produce the character bible.
 * Image-to-image generation still works because nano-banana-pro receives the
 * actual reference photo + a generic "same person" instruction. The output
 * stays anchored to the uploaded face even without an AI-written bible.
 */
function buildFallbackAnalysis(): Record<string, unknown> {
  // 3 frames designed to loop as a GIF — identical character, only angle + expression change.
  // image_strength=0.85 carries the source style; these prompts only describe pose differences.
  const lockInstruction = "Use the attached reference photo(s) as the exact likeness — this is the SAME person, not a lookalike. Keep the EXACT same character: identical face geometry, identical skin/color tone, identical hair, identical outfit, identical art style. Rendered in the SAME visual medium and style as the reference (if photo → photo; if cartoon → cartoon; if illustration → illustration). DO NOT translate between styles. Same lighting and background treatment as the reference. This is one generated frame of a 3-frame looping GIF that starts with the original photo.";
  return {
    character_bible: "Subject locked to the uploaded reference image. Face, skin tone, hair, outfit, art style, and overall medium match the original exactly.",
    detected_style: "mixed",
    detected_niche: "lifestyle",
    detected_vibe: "authentic confident grounded",
    style_summary: "Same visual style and medium as the reference — character consistency across the original photo + 2 generated frames for GIF loop",
    dominant_colors: ["#1a1a1a", "#d4c4a8", "#6b6b6b"],
    prompt_1: `Frame 2 of 3 — DYNAMIC SHOT: ${lockInstruction} Expression: energetic and alive, wide bright eyes sparkling with delight, genuine open-mouth laugh mid-motion. Composition: dynamic 3/4 angle, subject caught mid-action with slight forward lean and a moving arm, eye-level camera, upper-body three-quarter framing. ${VELLO_STYLE}`,
    prompt_2: `Frame 3 of 3 — TOP-SIDE ANGLE: ${lockInstruction} Expression: adorable and magnetic, soft doe eyes gazing upward through long lashes, gentle closed-lip smile, chin slightly tilted down for a cute look-up effect. Composition: high top-side camera angle (roughly 30-45° above eye level, 45° from front), subject looking up at the camera, tight crop from chest up, face partially in profile but tilted up. ${VELLO_STYLE}`,
  };
}
