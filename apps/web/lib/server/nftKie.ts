// Shared KIE (nano-banana-pro) job helpers for the NFT-avatar + character-grid
// image routes.
//
// WHY THIS EXISTS: the old routes created a KIE task and then POLLED KIE for up to
// ~4 minutes (and downloaded + assembled a GIF) all inside ONE HTTP request. On
// Railway that exceeds the proxy's request window, so Railway returns an HTML error
// page and the browser blows up with "Unexpected token '<'". The fix is to stop
// holding the request open: a fast CREATE step kicks off the KIE task(s) and returns
// immediately, and a fast COLLECT step does ONE quick poll (only downloading +
// assembling when every task is already done). These helpers are the reusable
// pieces both steps share — the KIE integration itself is unchanged, only the
// waiting moved out of the request and into client-side polling.
//
// NODE-ONLY: `persistStill`/gif helpers pull binary data + Supabase; import only
// from Next.js route handlers on the Node runtime (never from Convex-bundled code).

import { putImage } from "./imageStorage";

const KIE_KEY    = process.env.KIE_API_KEY ?? "";
const KIE_CREATE = "https://api.kie.ai/api/v1/jobs/createTask";
const KIE_POLL   = "https://api.kie.ai/api/v1/jobs/recordInfo";


// Single supported KIE model — bare "nano-banana" was deprecated. We retry on the
// SAME model with backoff instead of cascading to a different model name.
export const PRIMARY_MODEL = "nano-banana-pro";
export const MAX_ATTEMPTS = 3;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Per-request timeout — aborts hung KIE createTask/recordInfo calls.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export type TaskState = "waiting" | "queuing" | "generating" | "success" | "fail";

export type TaskRecord = {
  code: number;
  data: {
    taskId: string;
    state: TaskState;
    resultJson?: string;
    failMsg?: string;
  };
};

// ── Image hosting helpers (R2) ──────────────────────────────────────────────
// Historically these wrote to the public Supabase bucket `vello-avatars`; that
// project is quota-restricted (HTTP 402 on every storage call) so all avatar
// bytes now go to R2 via lib/server/imageStorage. Function names are kept so
// the many call sites don't churn.

/** No-op kept for API compatibility — R2 buckets need no create/public step. */
export async function ensurePublicBucket(): Promise<void> {}

// Upload base64 image → permanent public HTTPS URL (R2).
export async function uploadRefToSupabase(
  base64: string,
  mimeType: string,
  idx = 0,
): Promise<string | null> {
  void idx;
  try {
    const buffer = Buffer.from(base64, "base64");
    const { url } = await putImage(buffer, mimeType, { keyPrefix: "avatars/refs" });
    console.log("[nftKie] ref image at:", url);
    return url;
  } catch (err) {
    console.error("[nftKie] ref upload threw:", err);
    return null;
  }
}

// Upload finished GIF → permanent public HTTPS URL (R2).
export async function uploadGifToSupabase(buffer: Buffer): Promise<string | null> {
  try {
    const { url } = await putImage(buffer, "image/gif", { keyPrefix: "avatars/gifs" });
    console.log("[nftKie] gif at:", url);
    return url;
  } catch (err) {
    console.error("[nftKie] gif upload threw:", err);
    return null;
  }
}

// ── KIE createTask ──────────────────────────────────────────────────────────

export async function createNftTask(
  prompt: string,
  refImageUrls?: string[],
  attempt = 1,
): Promise<string> {
  const model = PRIMARY_MODEL;
  // nano-banana-pro takes `image_input` as an ARRAY of reference image URLs
  // (up to 8). It blends them into one identity — passing all of the user's
  // uploaded photos of the same person locks the likeness far better than one.
  // NOTE: there is NO `image_strength` knob on this model; the previous code
  // sent `image_url` + `image_strength`, which the API silently ignored — that
  // is why the reference was never applied.
  const refs = (refImageUrls ?? []).filter(Boolean);
  // When the user uploaded reference photos, FORCE the model to reproduce that
  // exact person — image_input alone lets the prompt drift into a generic face,
  // which reads as "the reference wasn't used". The directive + image_input
  // together lock the likeness.
  const framing = "Vertical 9:16 portrait framing: subject centered with comfortable headroom, face in the upper half so a square center-crop still frames the face cleanly.";
  const lockedPrompt = refs.length > 0
    ? `Reproduce the EXACT person shown in the attached reference image(s) — identical face, facial structure, skin tone, eye shape, nose, mouth, and hair. Do NOT invent or beautify a different person; this must look unmistakably like the SAME individual. ${framing} ${prompt}`
    : `${framing} ${prompt}`;
  const input: Record<string, unknown> = {
    prompt: lockedPrompt,
    // PORTRAIT 9:16, always: this image is the agent's video reference — Grok/
    // Omni render vertical shorts from it, and a square reference forced them
    // to invent the top/bottom of the frame. Square surfaces (mint card,
    // avatars) simply center-crop this portrait via CSS object-cover.
    aspect_ratio: "9:16",
    resolution: "1K",
  };
  if (refs.length > 0) {
    input.image_input = refs.slice(0, 8);
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(KIE_CREATE, {
      method: "POST",
      headers: { Authorization: `Bearer ${KIE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input }),
    }, 20_000);
  } catch (networkErr) {
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[nftKie] ${model} network error (attempt ${attempt}), retrying…`);
      await sleep(2000 * attempt);
      return createNftTask(prompt, refImageUrls, attempt + 1);
    }
    throw networkErr;
  }

  if (!res.ok) {
    const text = await res.text();
    const transient = res.status >= 500 || /bad.?gateway|timeout|rate.?limit|429/i.test(text);
    if (transient && attempt < MAX_ATTEMPTS) {
      console.warn(`[nftKie] ${model} HTTP ${res.status} (attempt ${attempt}), retrying…`);
      await sleep(2000 * attempt);
      return createNftTask(prompt, refImageUrls, attempt + 1);
    }
    throw new Error(`createTask HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json() as { code: number; msg: string; data: { taskId: string } };

  if (json.code !== 200) {
    // Transient API-level error — retry KEEPING the refs (don't throw away the
    // likeness on a rate-limit/timeout blip).
    if (attempt < MAX_ATTEMPTS && /(rate|timeout|busy|temporar)/i.test(json.msg)) {
      console.warn(`[nftKie] ${model} API error (${json.msg}) attempt ${attempt}, retrying with refs…`);
      await sleep(2000 * attempt);
      return createNftTask(prompt, refImageUrls, attempt + 1);
    }
    // Drop refs ONLY when the error is genuinely about the reference images
    // (so a generic failure never silently produces an avatar with no likeness).
    const refIssue = /image|ref|input|url|fetch|download|unsupported|file.?type|param/i.test(json.msg);
    if (refs.length > 0 && refIssue) {
      console.warn(`[nftKie] ref images rejected (${json.msg}), retrying without refs`);
      return createNftTask(prompt, undefined, attempt);
    }
    throw new Error(`createTask error (${model}): ${json.msg}`);
  }

  console.log(`[nftKie] task created with ${model}: ${json.data.taskId}`);
  return json.data.taskId;
}

// ── KIE recordInfo — SINGLE quick poll (NO long loop) ───────────────────────

export type PollResult =
  | { status: "pending" }
  | { status: "success"; url: string }
  | { status: "fail"; error: string };

/**
 * Do ONE quick recordInfo poll for a task and classify its state. This is the
 * old pollTask loop with the loop REMOVED — the waiting now lives in the client,
 * which calls the /collect route repeatedly. A network error, non-2xx, unparsable
 * body, or a not-yet-done state all map to `pending` (the client will poll again);
 * only a genuine KIE "fail" (or a success with no result URL) maps to `fail`.
 */
export async function pollNftTaskOnce(taskId: string): Promise<PollResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${KIE_POLL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${KIE_KEY}` },
    }, 10_000);
  } catch {
    return { status: "pending" }; // timed-out/failed poll — try again next tick
  }
  if (!res.ok) return { status: "pending" };

  let json: TaskRecord;
  try {
    json = await res.json() as TaskRecord;
  } catch {
    return { status: "pending" };
  }

  const data = json.data;
  if (!data) return { status: "pending" };
  const { state, resultJson, failMsg } = data;

  if (state === "success") {
    let url: string | undefined;
    try {
      const parsed = JSON.parse(resultJson ?? "{}") as { resultUrls?: string[] };
      url = parsed.resultUrls?.[0];
    } catch {
      /* fall through to the no-url failure below */
    }
    if (!url) return { status: "fail", error: "No result URL in completed task" };
    return { status: "success", url };
  }
  if (state === "fail") return { status: "fail", error: failMsg ?? "Task failed" };
  return { status: "pending" };
}

// ── download / persist ──────────────────────────────────────────────────────

export async function toDataUri(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  return `data:${contentType};base64,${Buffer.from(buffer).toString("base64")}`;
}

/**
 * Persist a generated still to Supabase and return a permanent public HTTPS URL.
 * The raw KIE URLs expire and data: URIs can't be fed to KIE's image models, so
 * the individual NFT stills MUST live at a stable http(s) URL to be usable as
 * video reference frames. Falls back to a data URI only if the upload fails.
 */
export async function persistStill(rawUrl: string, idx: number): Promise<string> {
  try {
    const res = await fetch(rawUrl);
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") ?? "image/png";
      const base64 = buffer.toString("base64");
      const hosted = await uploadRefToSupabase(base64, contentType, 1000 + idx);
      if (hosted) return hosted;
    }
  } catch (err) {
    console.error(`[nftKie] still ${idx} persist failed:`, err);
  }
  // Last resort: self-contained data URI (works for display, NOT for KIE refs).
  return toDataUri(rawUrl);
}
