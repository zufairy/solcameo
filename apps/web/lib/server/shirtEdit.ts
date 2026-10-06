import { fetchWithTimeout } from "@/lib/server/nftKie";

/**
 * Kie image-edit models, tried in order. The first is Wan 2.7 image edit (override the
 * slug with KIE_SHIRT_MODEL if Kie renames it); the rest are slugs this app already
 * uses for reference edits, so a rejected Wan request still produces a result.
 * Every entry takes the portrait first and the optional logo second.
 */
export interface ShirtEngine { id: string; slug: string; build: (prompt: string, urls: string[], ratio: string) => Record<string, unknown> }

export const SHIRT_ENGINES: ShirtEngine[] = [
  { id: "wan", slug: process.env.KIE_SHIRT_MODEL?.trim() || "wan/2-7-image-pro", build: (prompt, urls) => ({ prompt: prompt.slice(0, 5000), input_urls: urls.slice(0, 4) }) },
  { id: "qwen", slug: "qwen3/image-to-image", build: (prompt, urls, ratio) => ({ prompt: prompt.slice(0, 5000), image_urls: urls.slice(0, 3), image_size: ratio, resolution: "2K", output_format: "png" }) },
  { id: "gpt", slug: "gpt-image-2-image-to-image", build: (prompt, urls, ratio) => ({ prompt: prompt.slice(0, 20000), input_urls: urls.slice(0, 16), aspect_ratio: ratio, resolution: "2K" }) },
];

const KIE_CREATE = "https://api.kie.ai/api/v1/jobs/createTask";

export class ShirtEditError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

/** Starts one edit on engine `engineIndex`; the caller walks the chain on failure. */
export async function createShirtTask(args: { prompt: string; urls: string[]; ratio: string; engineIndex: number }): Promise<{ taskId: string; engine: string }> {
  const key = (process.env.KIE_API_KEY ?? "").trim();
  if (!key) throw new ShirtEditError("Shirt studio is not configured", 503);
  const engine = SHIRT_ENGINES[args.engineIndex];
  if (!engine) throw new ShirtEditError("No shirt engine available", 502);
  let res: Response;
  try {
    res = await fetchWithTimeout(KIE_CREATE, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: engine.slug, input: engine.build(args.prompt, args.urls, args.ratio) }),
    }, 25_000);
  } catch {
    throw new ShirtEditError("The image service did not respond. Please retry.");
  }
  const text = await res.text();
  if (!res.ok) throw new ShirtEditError(`${engine.id}: HTTP ${res.status} ${text.slice(0, 160)}`);
  let json: { code?: number; msg?: string; data?: { taskId?: string } } = {};
  try { json = JSON.parse(text); } catch { /* handled below */ }
  if (json.code !== 200 || !json.data?.taskId) throw new ShirtEditError(`${engine.id}: ${json.msg ?? "task was not accepted"}`);
  return { taskId: json.data.taskId, engine: engine.id };
}
