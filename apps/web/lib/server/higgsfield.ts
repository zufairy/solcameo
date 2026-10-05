/**
 * Minimal Higgsfield platform REST client (server-only). Credentials come from
 * HF_CREDENTIALS ("<key-id>:<secret>") and never leave the server.
 * Lifecycle: POST /<model> → { request_id } → GET /requests/<id>/status until
 * completed | failed | nsfw | canceled. Outputs are retained ~7 days, so callers
 * mirror them into our own storage.
 */
const BASE = "https://api.higgsfield.ai";

export type HfStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export interface HfResult {
  status: HfStatus;
  requestId: string;
  imageUrls: string[];
  videoUrl?: string;
  error?: string;
}

export class HfError extends Error {
  constructor(message: string, public status: number, public code: "auth" | "credits" | "bad_input" | "upstream") {
    super(message);
  }
}

/** Env names we accept, so a differently-named Railway variable still works. */
export const CREDENTIAL_ENV_NAMES = [
  "HF_CREDENTIALS", "HIGGSFIELD_CREDENTIALS", "HIGGSFIELD_API_KEY", "HF_API_KEY",
] as const;

function credentials(): string {
  const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").replace(/^Key\s+/i, "");
  // 1. A combined "<key-id>:<secret>" under any known name.
  for (const name of CREDENTIAL_ENV_NAMES) {
    const v = clean(process.env[name]);
    if (v.includes(":")) return v;
  }
  // 2. Split id + secret variables.
  const id = clean(process.env.HF_API_KEY_ID) || clean(process.env.HIGGSFIELD_API_KEY_ID) || clean(process.env.HF_API_KEY) || clean(process.env.HIGGSFIELD_API_KEY);
  const secret = clean(process.env.HF_API_SECRET) || clean(process.env.HF_API_KEY_SECRET) || clean(process.env.HIGGSFIELD_API_SECRET) || clean(process.env.HIGGSFIELD_API_KEY_SECRET);
  if (id && secret) return `${id}:${secret}`;
  throw new HfError(
    "Character generation is not configured: set HF_CREDENTIALS (format key-id:key-secret) in the server environment and redeploy",
    503,
    "auth",
  );
}

export function higgsfieldConfigured(): boolean {
  try { credentials(); return true; } catch { return false; }
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Key ${credentials()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (res.ok) return data;
  const detail = (data as { detail?: unknown } | null)?.detail;
  const msg = typeof detail === "string" ? detail : text.slice(0, 200) || `HTTP ${res.status}`;
  if (res.status === 401) throw new HfError("Higgsfield rejected our credentials", 502, "auth");
  if (res.status === 403) throw new HfError("Not enough Higgsfield credits", 402, "credits");
  if (res.status === 400 || res.status === 422) throw new HfError(msg, 400, "bad_input");
  throw new HfError(msg, 502, "upstream");
}

export async function submitImage(
  endpoint: string,
  input: { prompt: string; aspect_ratio?: string; resolution?: string; batch_size?: 1 | 4; image_reference_url?: string },
  idempotencyKey: string,
): Promise<string> {
  const data = (await call(`/${endpoint}`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ batch_size: 1, ...input }),
  })) as { request_id?: string } | null;
  if (!data?.request_id) throw new HfError("Higgsfield returned no request id", 502, "upstream");
  return data.request_id;
}

/** An uploaded image must use an editing endpoint, never a text-only Soul model. */
export async function submitReferenceEdit(prompt: string, imageUrl: string | string[], aspectRatio: string, idempotencyKey: string): Promise<string> {
  const data = await call("/alibaba/qwen-image-3/edit", {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ prompt, image_urls: Array.isArray(imageUrl) ? imageUrl : [imageUrl], aspect_ratio: aspectRatio === "4:5" ? "3:4" : aspectRatio, resolution: "1k", prompt_extend: false, enable_thinking: false }),
  }) as { request_id?: string };
  if (!data?.request_id) throw new HfError("Higgsfield returned no request id", 502, "upstream");
  return data.request_id;
}

export async function submitQwenImage(prompt: string, aspectRatio: string, idempotencyKey: string): Promise<string> {
  const data = await call("/alibaba/qwen-image-3/text-to-image", {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ prompt, aspect_ratio: aspectRatio === "4:5" ? "3:4" : aspectRatio, resolution: "1k", prompt_extend: true, enable_thinking: true, prompt_extend_mode: "direct" }),
  }) as { request_id?: string };
  if (!data?.request_id) throw new HfError("Higgsfield returned no request id", 502, "upstream");
  return data.request_id;
}

/** Genjutsu: motion-transfer / object-swap. A reference video + 1–8 images → a new video. */
export const GENJUTSU_ENDPOINTS = {
  "motion-transfer": "higgsfield/genjutsu/motion-transfer/v1.0",
  "object-swap": "higgsfield/genjutsu/object-swap/v1.0",
} as const;
export type GenjutsuMode = keyof typeof GENJUTSU_ENDPOINTS;

export async function submitVideo(
  mode: GenjutsuMode,
  input: { video_url: string; image_urls: string[]; prompt?: string; resolution?: "480p" | "720p" | "1080p" },
  idempotencyKey: string,
): Promise<string> {
  const data = (await call(`/${GENJUTSU_ENDPOINTS[mode]}`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  })) as { request_id?: string } | null;
  if (!data?.request_id) throw new HfError("Higgsfield returned no request id", 502, "upstream");
  return data.request_id;
}

export function parseResult(data: unknown, requestId: string): HfResult {
  const d = (data ?? {}) as { status?: string; images?: { url?: string }[]; video?: { url?: string }; error?: string };
  const status = (["queued", "in_progress", "completed", "failed", "nsfw", "canceled"].includes(d.status ?? "")
    ? d.status
    : "in_progress") as HfStatus;
  const imageUrls = (d.images ?? []).map((i) => i?.url).filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u));
  const videoUrl = typeof d.video?.url === "string" && /^https:\/\//.test(d.video.url) ? d.video.url : undefined;
  return { status, requestId, imageUrls, videoUrl, error: typeof d.error === "string" ? d.error : undefined };
}

export async function getStatus(requestId: string): Promise<HfResult> {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new HfError("Bad request id", 400, "bad_input");
  return parseResult(await call(`/requests/${requestId}/status`), requestId);
}
