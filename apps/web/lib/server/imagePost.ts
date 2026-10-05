import { callClaudeJSON } from "@/lib/server/kie-claude";
import { fetchWithTimeout, pollNftTaskOnce, persistStill, sleep, MAX_ATTEMPTS } from "@/lib/server/nftKie";
import { resolveImageEngine, type ImageEngine } from "@/lib/builder/imageEngines";

/**
 * IMAGE POSTS — generate the still an agent publishes, from its persona.
 *
 * The prompt is the product here. A generic "make a nice image about X" returns
 * stock-looking art that reads as nobody's post; the persona, the agent's memories
 * and the operator's standing idea are what make the image look like it came from
 * THIS account. So the prompt is composed from those, fresh each time, rather than
 * reusing one saved string — the same reason the episode planner exists.
 */

const KIE_CREATE = "https://api.kie.ai/api/v1/jobs/createTask";

// GPT Image 2 ships as TWO separate KIE models, not one with an optional ref
// param: "gpt-image-2-text-to-image" (imageEngines.ts's "gpt-image-2" slug, no
// image input at all) and "gpt-image-2-image-to-image" (takes up to 16 refs via
// `input_urls`, not `image_input`). docs.kie.ai/market/gpt/gpt-image-2-image-to-image
const GPT_IMAGE_2_IMAGE_TO_IMAGE_SLUG = "gpt-image-2-image-to-image";

// Qwen Image 3 is the SAME split (text-to-image vs image-to-image = different
// slugs), but ALSO uses entirely different param names from every other engine
// here — `image_size` (not `aspect_ratio`) and `image_urls` (not `image_input`/
// `input_urls`), max 3 refs. docs.kie.ai/market/qwen3/text-to-image + .../image-to-image
const QWEN_IMAGE_3_IMAGE_TO_IMAGE_SLUG = "qwen3/image-to-image";

export interface ImagePersona {
  name: string;
  characterBible?: string;
  niche?: string;
  aesthetic?: string;
  brandColor?: string;
  /** Newest / most important first; bounded by the caller. */
  memories?: string[];
}

/**
 * Compose the image prompt. Persona first, then the operator's idea, then whatever
 * the agent has been talking about lately — a prompt that leads with the idea drifts
 * away from the account's look.
 *
 * Returns "" only when the model is unreachable; the caller then falls back to a
 * deterministic prompt rather than skipping the post.
 */
export async function buildImagePrompt(args: {
  persona: ImagePersona;
  /** The operator's standing brief from the app's idea box. */
  idea?: string;
  /** What this post is about, when the caller has a topic. */
  topic?: string;
  apiKey?: string;
}): Promise<string> {
  const { persona, idea, topic } = args;
  const system =
    "You write IMAGE GENERATION prompts for a social media post. One paragraph, concrete and visual: " +
    "subject, setting, composition, lighting, colour, mood. No camera brand names, no hashtags, no text " +
    "instructions unless the brief asks for words in the image. Never describe a real or famous person.";
  const user = [
    `ACCOUNT: ${persona.name}${persona.niche ? ` — ${persona.niche}` : ""}`,
    persona.characterBible ? `WHO THEY ARE: ${persona.characterBible.slice(0, 500)}` : "",
    persona.aesthetic ? `VISUAL STYLE TO HOLD: ${persona.aesthetic.slice(0, 300)}` : "",
    persona.brandColor ? `BRAND COLOUR: ${persona.brandColor}` : "",
    idea?.trim() ? `OPERATOR'S BRIEF (follow it): ${idea.trim().slice(0, 600)}` : "",
    topic?.trim() ? `THIS POST IS ABOUT: ${topic.trim().slice(0, 300)}` : "",
    persona.memories?.length
      ? `RECENTLY ON THIS ACCOUNT (don't repeat these images, build on them):\n${persona.memories.slice(0, 5).map((m) => `- ${m}`).join("\n")}`
      : "",
    'Return ONLY JSON { "prompt": "..." }',
  ].filter(Boolean).join("\n\n");

  try {
    const out = await callClaudeJSON<{ prompt?: unknown }>({ system, user, apiKey: args.apiKey, maxTokens: 500 });
    const p = out && typeof out.prompt === "string" ? out.prompt.trim() : "";
    return p.slice(0, 1500);
  } catch (e) {
    console.warn(`[imagePost] prompt generation failed: ${e instanceof Error ? e.message : e}`);
    return "";
  }
}

/** Deterministic prompt for when the model is unreachable — a plain on-brand still
 *  beats skipping the post. */
export function fallbackImagePrompt(persona: ImagePersona, idea?: string): string {
  const subject = idea?.trim() || persona.niche || persona.name;
  return [
    `A striking vertical social-media image about ${subject}.`,
    persona.aesthetic?.trim() ? `Visual style: ${persona.aesthetic.trim().slice(0, 200)}.` : "",
    persona.brandColor ? `Accent colour ${persona.brandColor}.` : "",
    "Clean composition, strong focal point, natural lighting, no text overlays, no watermarks.",
  ].filter(Boolean).join(" ");
}

/**
 * Create a KIE image task on the CHOSEN engine.
 *
 * Kept separate from nftKie's avatar helper because that one pins nano-banana-pro and
 * prepends a likeness-lock directive meant for a real person's photos — wrong for a
 * post image, and wrong for the engines that take no references at all.
 */
export async function createImageTask(args: {
  engine: ImageEngine;
  prompt: string;
  /** Character references — ignored by engines that don't accept them. */
  refImageUrls?: string[];
  aspectRatio?: string;
  apiKey?: string;
  attempt?: number;
}): Promise<string> {
  const attempt = args.attempt ?? 1;
  const key = (args.apiKey ?? process.env.KIE_API_KEY ?? "").trim();
  if (!key) throw new Error("KIE_API_KEY is not set");

  const refs = (args.refImageUrls ?? []).filter(Boolean).slice(0, 8);
  // GPT Image 2's own "text-to-image" slug genuinely can't take references — but
  // when the operator attached one, route to KIE's SEPARATE image-to-image model
  // instead of dropping the reference (that used to just silently ignore it and
  // render a generic image). Every other engine keeps its normal single slug.
  const useGptImageToImage = args.engine.id === "gpt-image-2" && refs.length > 0;
  const isQwen = args.engine.id === "qwen-image-3";
  const modelSlug = useGptImageToImage
    ? GPT_IMAGE_2_IMAGE_TO_IMAGE_SLUG
    : isQwen
      ? (refs.length > 0 ? QWEN_IMAGE_3_IMAGE_TO_IMAGE_SLUG : args.engine.slug)
      : args.engine.slug;

  const input: Record<string, unknown> = useGptImageToImage
    ? {
        prompt: args.prompt.slice(0, 20_000),
        // KIE_GPTImage2_ImageToImage: up to 16 source images via input_urls (not
        // image_input — that's the nano-banana param name).
        input_urls: refs.slice(0, 16),
        // "auto" only pairs with 1K resolution per the model's own constraint —
        // an explicit ratio + this engine's fixed 2K resolution never hits that.
        aspect_ratio: args.aspectRatio ?? "9:16",
        resolution: args.engine.resolution,
      }
    : isQwen
      ? {
          // Qwen3 (text-to-image AND image-to-image share this shape): `image_size`
          // is the aspect-ratio field here, not `aspect_ratio`. Up to 3 refs via
          // `image_urls` when the image-to-image slug is in play.
          prompt: args.prompt.slice(0, 5_000),
          image_size: args.aspectRatio ?? "9:16",
          resolution: args.engine.resolution,
          output_format: "png",
          ...(refs.length > 0 ? { image_urls: refs.slice(0, 3) } : {}),
        }
      : {
          prompt: args.prompt.slice(0, 20_000),
          // 9:16 by default: these are social posts, and a landscape still gets letterboxed
          // or centre-cropped by every feed it lands in.
          aspect_ratio: args.aspectRatio ?? "9:16",
          resolution: args.engine.resolution,
          output_format: "jpg",
          ...(args.engine.acceptsReferences && refs.length > 0 ? { image_input: refs } : {}),
        };

  let res: Response;
  try {
    res = await fetchWithTimeout(KIE_CREATE, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelSlug, input }),
    }, 20_000);
  } catch (networkErr) {
    if (attempt < MAX_ATTEMPTS) {
      await sleep(2000 * attempt);
      return createImageTask({ ...args, attempt: attempt + 1 });
    }
    throw networkErr;
  }

  if (!res.ok) {
    const text = await res.text();
    const transient = res.status >= 500 || /bad.?gateway|timeout|rate.?limit|429/i.test(text);
    if (transient && attempt < MAX_ATTEMPTS) {
      await sleep(2000 * attempt);
      return createImageTask({ ...args, attempt: attempt + 1 });
    }
    throw new Error(`${modelSlug} createTask HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { code: number; msg?: string; data?: { taskId?: string } };
  if (json.code !== 200 || !json.data?.taskId) {
    if (attempt < MAX_ATTEMPTS) {
      await sleep(2000 * attempt);
      return createImageTask({ ...args, attempt: attempt + 1 });
    }
    throw new Error(`${modelSlug} createTask: ${json.msg ?? `code ${json.code}`}`);
  }
  return json.data.taskId;
}

export interface GeneratedImage {
  imageUrl: string;
  prompt: string;
  engineId: string;
  engineLabel: string;
}

/**
 * The whole flow: prompt from the persona, generate on the chosen engine, and persist
 * the result somewhere durable.
 *
 * Persisting matters — a KIE result URL expires, and upload-post fetches the image
 * when it publishes, which can be minutes later on a scheduled post. Publishing the
 * raw KIE URL is how you get a post with a broken image.
 */
export async function generatePostImage(args: {
  persona: ImagePersona;
  engineId?: string;
  idea?: string;
  topic?: string;
  refImageUrls?: string[];
  apiKey?: string;
  /** Hard ceiling on the poll loop. */
  maxWaitMs?: number;
}): Promise<GeneratedImage> {
  const engine = resolveImageEngine(args.engineId);
  const generated = await buildImagePrompt({ persona: args.persona, idea: args.idea, topic: args.topic, apiKey: args.apiKey });
  const prompt = generated || fallbackImagePrompt(args.persona, args.idea);

  const taskId = await createImageTask({
    engine, prompt,
    refImageUrls: args.refImageUrls,
    apiKey: args.apiKey,
  });

  const deadline = Date.now() + (args.maxWaitMs ?? 180_000);
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${engine.label} did not finish in time`);
    await sleep(4000);
    const poll = await pollNftTaskOnce(taskId);
    if (poll.status === "fail") throw new Error(poll.error || `${engine.label} failed to render`);
    if (poll.status !== "success") continue;
    const imageUrl = await persistStill(poll.url, 0);
    if (!imageUrl) throw new Error("could not store the generated image");
    return { imageUrl, prompt, engineId: engine.id, engineLabel: engine.label };
  }
}
