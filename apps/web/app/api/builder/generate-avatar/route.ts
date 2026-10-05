import { NextRequest, NextResponse } from "next/server";
import { callClaudeJSON } from "@/lib/server/kie-claude";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";

export const maxDuration = 120;

const KIE_GEMINI_URL = "https://api.kie.ai/gemini-3-6-flash-openai/v1/chat/completions";
const KIE_CREATE_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const KIE_POLL_URL   = "https://api.kie.ai/api/v1/jobs/recordInfo";
const IMGBB_KEY = process.env.IMGBB_API_KEY ?? "";

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractBase64(dataUrl: string): { base64: string; mediaType: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

async function uploadToImgbb(base64: string): Promise<string | null> {
  if (!IMGBB_KEY) return null;
  try {
    const body = new URLSearchParams({ key: IMGBB_KEY, image: base64, expiration: "600" });
    const res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body });
    if (!res.ok) return null;
    const json = await res.json() as { success: boolean; data?: { url: string } };
    return json.success ? (json.data?.url ?? null) : null;
  } catch {
    return null;
  }
}

type KieTaskRecord = {
  code: number;
  data: {
    taskId: string;
    state: "waiting" | "queuing" | "generating" | "success" | "fail";
    resultJson?: string;
    failMsg?: string;
  };
};

async function createKieTask(prompt: string, kieKey: string, refImageUrl?: string): Promise<string> {
  const input: Record<string, string> = {
    prompt,
    aspect_ratio: "1:1",
    resolution: "1K",
  };
  if (refImageUrl) {
    input.image_url = refImageUrl;
    input.image_strength = "0.25";
  }

  const res = await fetch(KIE_CREATE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nano-banana-pro", input }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kie createTask HTTP ${res.status}: ${text}`);
  }

  const json = await res.json() as { code: number; msg: string; data: { taskId: string } };

  if (json.code !== 200) {
    if (refImageUrl) {
      console.warn("[generate-avatar] ref image rejected, retrying without:", json.msg);
      return createKieTask(prompt, kieKey);
    }
    throw new Error(`Kie createTask error: ${json.msg}`);
  }

  return json.data.taskId;
}

async function pollKieTask(taskId: string, kieKey: string, timeoutMs = 100_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let delay = 3000;

  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(delay * 1.35, 8000);

    const res = await fetch(`${KIE_POLL_URL}?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${kieKey}` },
    });
    if (!res.ok) continue;

    const json = await res.json() as KieTaskRecord;
    const { state, resultJson, failMsg } = json.data;

    if (state === "success") {
      const parsed = JSON.parse(resultJson ?? "{}") as { resultUrls?: string[] };
      const url = parsed.resultUrls?.[0];
      if (!url) throw new Error("No resultUrl in completed task");
      return url;
    }
    if (state === "fail") throw new Error(`Kie task failed: ${failMsg ?? "unknown"}`);
  }

  throw new Error(`Kie task ${taskId} timed out`);
}

async function toDataUri(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  return `data:${contentType};base64,${Buffer.from(buffer).toString("base64")}`;
}

// ── Step 1: Analyze reference images → appearance description ─────────────────

async function analyzeReferences(
  images: { base64: string; mediaType: string }[],
  personaName: string,
  aesthetic: string,
  niche: string,
  kieKey: string,
): Promise<string> {
  const imageBlocks = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.base64 },
  }));

  const textBlock = {
    type: "text" as const,
    text: [
      `Analyzing ${images.length} reference image(s) for AI influencer "${personaName}".`,
      aesthetic ? `Aesthetic: "${aesthetic}".` : "",
      niche ? `Niche: "${niche}".` : "",
      "",
      "Describe the person's appearance for AI image generation:",
      "- Face shape, skin tone, eye color and shape",
      "- Hair: color, length, texture, style",
      "- Distinctive features, expression, overall vibe",
      "",
      "Return ONLY the appearance description — plain prose, under 120 words, no preamble.",
    ].filter(Boolean).join("\n"),
  };

  // Convert Claude-style image blocks to Gemini OpenAI-compat image_url format
  const geminiImageBlocks = images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
  }));
  const response = await fetch(KIE_GEMINI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemini-3-6-flash-openai",
      stream: false,
      include_thoughts: false,
      messages: [
        { role: "system", content: "You are a visual description specialist for AI avatar generation. Be precise and concise." },
        { role: "user", content: [...geminiImageBlocks, { type: "text", text: textBlock.text }] },
      ],
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ignored = imageBlocks; // keep variable to avoid disruptive edits in surrounding code

  const payload = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message: { content: string } }>;
  };

  return (
    payload?.choices?.[0]?.message?.content?.trim() ||
    `${personaName}, ${aesthetic || "modern stylish"} aesthetic, ${niche || "lifestyle"} niche`
  );
}

// ── Step 2: Build 3 image prompts via Gemini 3 Flash ──────────────────────────

interface AvatarVariant {
  label: string;
  style: string;
  prompt: string;
}

async function buildAvatarPrompts(
  description: string,
  personaName: string,
  niche: string,
  kieKey: string,
): Promise<AvatarVariant[]> {
  const system = "You generate image prompts for AI influencer NFT avatars. Return only valid JSON.";
  const user = `Generate 3 image prompts for AI influencer "${personaName}" NFT collection.

Appearance: ${description}
Niche: ${niche || "lifestyle"}

Each prompt should be ~60 words, visually striking, ready for nano-banana image generation.

Return this exact JSON (no fences):
{
  "variants": [
    { "label": "Photorealistic", "style": "realistic", "prompt": "ultra photorealistic portrait, ${description}, professional studio lighting, sharp focus, clean white background, high-end fashion photography quality, 8K" },
    { "label": "Digital Art", "style": "illustrated", "prompt": "vibrant digital art portrait, ${description}, bold graphic illustration, gradient background in ${niche} aesthetic colors, modern NFT art quality, clean lines" },
    { "label": "NFT Avatar", "style": "nft", "prompt": "crypto art NFT avatar, ${description}, bold graphic style, glowing neon accents, deep dark gradient background, Web3 aesthetic, collectible art, square format" }
  ]
}`;

  const validate = (parsed: { variants?: AvatarVariant[] } | null): AvatarVariant[] | null =>
    parsed && Array.isArray(parsed.variants) && parsed.variants.length === 3 ? parsed.variants : null;

  // 1) Gemini 3 Flash (primary).
  try {
    const response = await fetch(KIE_GEMINI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${kieKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3-6-flash-openai",
        stream: false,
        include_thoughts: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { choices?: Array<{ message: { content: string } }> };
      const raw = payload?.choices?.[0]?.message?.content?.trim() ?? "{}";
      const stripped = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
      const v = validate(JSON.parse(stripped) as { variants?: AvatarVariant[] });
      if (v) return v;
    }
    console.warn("[generate-avatar] Gemini prompt build failed/unusable — falling back to Haiku");
  } catch (e) {
    console.warn("[generate-avatar] Gemini prompt build errored — falling back to Haiku:", e instanceof Error ? e.message : e);
  }

  // 2) Claude Haiku 4.5 (fallback when Gemini is down / returns junk).
  try {
    const parsed = await callClaudeJSON<{ variants?: AvatarVariant[] }>({ system, user, maxTokens: 1200, apiKey: kieKey });
    const v = validate(parsed);
    if (v) return v;
    console.warn("[generate-avatar] Haiku prompt build returned no valid variants — using deterministic prompts");
  } catch (e) {
    console.warn("[generate-avatar] Haiku prompt build failed — using deterministic prompts:", e instanceof Error ? e.message : e);
  }

  // 3) Deterministic fallback (both models unavailable).
  return [
    { label: "Photorealistic", style: "realistic",  prompt: `Ultra photorealistic portrait. ${description}. Professional studio lighting, sharp focus, clean background, 8K.` },
    { label: "Digital Art",    style: "illustrated", prompt: `Vibrant digital art portrait. ${description}. Bold illustration, gradient background, ${niche || "lifestyle"} energy, NFT quality.` },
    { label: "NFT Avatar",     style: "nft",         prompt: `Crypto art NFT avatar. ${description}. Glowing neon accents, dark gradient background, Web3 aesthetic, square format.` },
  ];
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // AUTH GATE — this route spends KIE credits (Gemini analysis + nano-banana
    // image generation) on every call. Require an internal secret or a logged-in
    // user; without this, anonymous callers could burn paid credits at will.
    const auth = await requireInternalOrUserAuth(request);
    if (auth.error) return auth.error;

    const body = (await request.json().catch(() => ({}))) as {
      referenceImages?: string[];
      personaName?: string;
      aesthetic?: string;
      niche?: string;
    };

    const {
      referenceImages = [],
      personaName = "AI Influencer",
      aesthetic = "",
      niche = "",
    } = body;

    if (!Array.isArray(referenceImages) || referenceImages.length === 0) {
      return NextResponse.json({ error: "referenceImages array required" }, { status: 400 });
    }

    const kieKey = process.env.KIE_API_KEY?.trim();
    if (!kieKey) {
      return NextResponse.json({ error: "KIE_API_KEY is required" }, { status: 503 });
    }

    // Parse base64 images
    const parsed = referenceImages
      .map(extractBase64)
      .filter((x): x is { base64: string; mediaType: string } => x !== null);

    if (parsed.length === 0) {
      return NextResponse.json({ error: "No valid base64 image data URLs provided" }, { status: 400 });
    }

    // Step 1: Analyze references → appearance description
    const description = await analyzeReferences(parsed, personaName, aesthetic, niche, kieKey);

    // Step 2: Build 3 prompts
    const variants = await buildAvatarPrompts(description, personaName, niche, kieKey);

    // Optionally upload first reference to imgbb for img2img conditioning
    let refImageUrl: string | undefined;
    if (parsed[0] && IMGBB_KEY) {
      const uploaded = await uploadToImgbb(parsed[0].base64);
      if (uploaded) refImageUrl = uploaded;
    }

    // Step 3: Launch all 3 Kie tasks in parallel
    const taskIds = await Promise.all(
      variants.map((v) => createKieTask(v.prompt, kieKey, refImageUrl)),
    );

    // Step 4: Poll all 3 in parallel
    const rawUrls = await Promise.allSettled(
      taskIds.map((id) => pollKieTask(id, kieKey)),
    );

    // Step 5: Download images server-side → data URIs (avoids CORS / expiry)
    const avatars = await Promise.all(
      rawUrls.map(async (result, i) => {
        if (result.status === "rejected") {
          console.error(`[generate-avatar] task ${i} failed:`, result.reason);
          return { label: variants[i].label, style: variants[i].style, url: null };
        }
        try {
          const dataUri = await toDataUri(result.value);
          return { label: variants[i].label, style: variants[i].style, url: dataUri };
        } catch (e) {
          console.error(`[generate-avatar] download failed for task ${i}:`, e);
          return { label: variants[i].label, style: variants[i].style, url: null };
        }
      }),
    );

    return NextResponse.json({ description, avatars });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    console.error("[generate-avatar]", detail);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
