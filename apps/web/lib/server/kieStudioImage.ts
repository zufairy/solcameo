// Studio portraits from reference photos, rendered by KIE nano-banana-pro.
//
// Flow: `hostReferencesForKie` once per batch (KIE only reliably accepts public PNG references), then one fast
// `createStudioImageTask` per take, which returns a task id at once. The browser polls /api/character/status, which
// asks KIE once per call (`pollNftTaskOnce`), so no request is ever held open while an image renders.
import { fetchWithTimeout, sleep, PRIMARY_MODEL, MAX_ATTEMPTS } from "./nftKie";
import { putImage } from "./imageStorage";

const KIE_CREATE = "https://api.kie.ai/api/v1/jobs/createTask";
const key = () => process.env.KIE_API_KEY ?? "";

/** Ratios nano-banana-pro renders. Anything else is mapped to a portrait-friendly one. */
const RATIOS: Record<string, string> = { "3:4": "3:4", "4:5": "4:5", "1:1": "1:1", "9:16": "9:16", "16:9": "16:9", "2:3": "2:3" };
export const kieRatio = (ratio: string) => RATIOS[ratio] ?? "3:4";

export class KieStartError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export const kieConfigured = () => !!key();

/**
 * Copy the user's uploaded references to public, extensioned PNGs. KIE rejects some JPEG/WebP URLs ("file type not
 * supported") and then the likeness is lost, so every reference is re-hosted as PNG once per batch. A reference that
 * cannot be read is skipped; if none can, the caller falls back to the original URLs.
 */
export async function hostReferencesForKie(urls: string[], scope: string): Promise<string[]> {
  const sharp = (await import("sharp")).default;
  const hosted = await Promise.all(urls.map(async (url) => {
    try {
      const res = await fetchWithTimeout(url, {}, 15_000);
      if (!res.ok) return null;
      const png = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
      return (await putImage(png, "image/png", { keyPrefix: `characters/${scope}/kie-ref` })).url;
    } catch { return null; }
  }));
  return hosted.filter((u): u is string => !!u);
}

/** Start one nano-banana-pro render. Returns the KIE task id. Retries transient failures and drops refs only when KIE rejects them. */
export async function createStudioImageTask(args: { prompt: string; refs: string[]; aspectRatio: string }, attempt = 1): Promise<string> {
  const { prompt, refs, aspectRatio } = args;
  const input: Record<string, unknown> = { prompt, aspect_ratio: kieRatio(aspectRatio), resolution: "1K", output_format: "png" };
  if (refs.length) input.image_input = refs.slice(0, 8);

  let res: Response;
  try {
    res = await fetchWithTimeout(KIE_CREATE, { method: "POST", headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: PRIMARY_MODEL, input }) }, 15_000);
  } catch (e) {
    if (attempt < MAX_ATTEMPTS) { await sleep(600 * attempt); return createStudioImageTask(args, attempt + 1); }
    throw new KieStartError(e instanceof Error ? e.message : "KIE is unreachable", true);
  }
  const text = await res.text();
  let json: { code?: number; msg?: string; data?: { taskId?: string } } = {};
  try { json = JSON.parse(text); } catch { /* handled below */ }

  if (res.ok && json.code === 200 && json.data?.taskId) return json.data.taskId;

  const message = json.msg || text.slice(0, 160) || `HTTP ${res.status}`;
  const transient = res.status >= 500 || res.status === 429 || /rate|timeout|busy|temporar|gateway/i.test(message);
  if (transient && attempt < MAX_ATTEMPTS) { await sleep(600 * attempt); return createStudioImageTask(args, attempt + 1); }
  // KIE refused the references themselves: render from the traits alone rather than failing the run.
  if (refs.length && /image|ref|input|url|fetch|download|unsupported|file.?type/i.test(message)) return createStudioImageTask({ ...args, refs: [] }, attempt);
  throw new KieStartError(message, transient || res.status === 402);
}
