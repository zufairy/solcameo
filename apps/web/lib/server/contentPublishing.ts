import sharp from "sharp";
import { safeFetchToBuffer } from "./downloader";
import { getApiKey, extractFailedPlatforms, extractPostIds } from "./uploadPost";
import { cleanMarketingText } from "../marketingCaption";
import { postX, readX, xConfigured } from "./xApi";
import { putImage } from "./imageStorage";
import { xTweetText } from "./uploadPost";

export const MARKETING_PROFILE = "vello_marketing";
export { compatiblePlatforms } from "../contentPlatforms";
export function contentResult(data: unknown, platforms: string[], httpOk = true) {
  const d = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const raw = d.results ?? d.platforms ?? d.platform_results;
  const map: Record<string, unknown> = Array.isArray(raw)
    ? Object.fromEntries(raw.filter(r => r && typeof r === "object" && typeof r.platform === "string").map(r => [r.platform, r]))
    : raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const normalized = { ...d, results: map };
  const status = typeof d.status === "string" ? d.status : "";
  const pending = ["pending", "queued", "processing", "in_progress"].includes(status);
  const ids = extractPostIds(normalized, platforms);
  const requestId = ids.requestId;
  const failed = pending ? [] : extractFailedPlatforms(normalized, platforms);
  const skipped = platforms.filter(p => {
    const r = map[p] ?? (p === "x" ? map.twitter : undefined);
    return r && typeof r === "object" && ((r as Record<string, unknown>).skipped === true || (r as Record<string, unknown>).fallback_to_inbox === true);
  });
  const error = failed.map(f => `${f.platform}: ${f.error}`).join("; ") || (skipped.length ? `Not publicly posted: ${skipped.join(", ")}` : String(d.error || d.message || "Publishing failed"));
  if (!httpOk || d.success === false || status === "failed" || failed.length || skipped.length) return { status: "failed", error, requestId };
  if (pending) return { status: "submitted", requestId };
  if (status === "completed" || (platforms.length > 0 && Object.keys(ids.postIds).length === platforms.length)) return { status: "posted", requestId };
  if (requestId) return { status: "submitted", requestId };
  return { status: "failed", error: "Provider returned no upload ID or confirmed post IDs" };
}
export async function publishContent(post: { _id: string; caption: string; kind: string; mediaUrl?: string; platforms: string[] }, username: string) {
  const key = getApiKey();
  if (!key) throw new Error("Upload-Post API key is not configured");
  const form = new FormData();
  form.append("user", username);
  form.append("title", cleanMarketingText(post.caption));
  form.append("description", cleanMarketingText(post.caption));
  for (const platform of post.platforms) form.append("platform[]", platform);
  form.append("async_upload", "true");
  form.append("external_id", `vello-content-${post._id}`);
  form.append("request_id", `vello-content-${post._id}`);
  if (post.platforms.includes("x")) {
    form.append("x_title", xTweetText(cleanMarketingText(post.caption)));
    form.append("x_long_text_as_post", "true");
  }
  if (post.kind === "photo") {
    if (!post.mediaUrl) throw new Error("A profile image is required for this announcement");
    // X cannot upload SVG avatars. Decode safely and send a bounded JPEG file.
    const { buffer } = await safeFetchToBuffer(post.mediaUrl, { maxBytes: 20 * 1024 * 1024, timeoutMs: 15_000 });
    const bytes = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
    form.append("photos[]", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "agent.jpg");
  } else if (post.kind === "video") {
    if (!post.mediaUrl) throw new Error("A video is required");
    form.append("video", post.mediaUrl);
    if (post.platforms.includes("youtube")) form.append("youtube_title", cleanMarketingText(post.caption).slice(0, 100));
  }
  const path = post.kind === "photo" ? "upload_photos" : post.kind === "video" ? "upload" : "upload_text";
  try {
    const res = await fetch(`https://api.upload-post.com/api/${path}`, {
      method: "POST", headers: { Authorization: `Apikey ${key}`, "Idempotency-Key": `vello-content-${post._id}` }, body: form, signal: AbortSignal.timeout(45_000),
    });
    const data: unknown = await res.json();
    return { ...contentResult(data, post.platforms, res.ok), result: JSON.stringify(data).slice(0, 20000) };
  } catch {
    // The upload may have reached the provider. Poll our supplied request ID;
    // never send a second upload just because the response was lost.
    return { status: "submitted", requestId: `vello-content-${post._id}`, error: "Waiting for confirmation after a network interruption" };
  }
}
export async function pollContent(requestId: string, platforms: string[]) {
  const res = await fetch(`https://api.upload-post.com/api/uploadposts/status?request_id=${encodeURIComponent(requestId)}`, {
    headers: { Authorization: `Apikey ${getApiKey()}` }, signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Upload status unavailable (${res.status})`);
  const data: unknown = await res.json();
  return { ...contentResult({ ...(data as object), request_id: requestId }, platforms), result: JSON.stringify(data).slice(0, 20000) };
}

export async function retryContent(requestId: string) {
  const res = await fetch("https://api.upload-post.com/api/uploadposts/posts/retry", {
    method: "POST", headers: { Authorization: `Apikey ${getApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId }), signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.error || data.message || `Retry failed (${res.status})`);
  return { status: "submitted", requestId, result: JSON.stringify(data).slice(0, 20000) };
}

/** X goes straight to the X API (OAuth 2 user token, media upload, then the post). Keeps line breaks; the text is cut to fit one post. */
export async function publishViaX(post: { _id: string; caption: string; kind: string; mediaUrl?: string }, profile: string): Promise<{ status: string; error?: string; requestId?: string; result?: string }> {
  let urls: string[] = [];
  if (post.kind !== "text" && post.mediaUrl) {
    if (post.kind === "photo") {
      // X rejects SVG and oversized avatars: decode safely and upload a bounded JPEG instead.
      const { buffer } = await safeFetchToBuffer(post.mediaUrl, { maxBytes: 20 * 1024 * 1024, timeoutMs: 15_000 });
      const jpeg = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
      urls = [(await putImage(jpeg, "image/jpeg", { key: `marketing/x/${post._id}.jpg` })).url];
    } else urls = [post.mediaUrl];
  }
  const sent = await postX(profile, xTweetText(post.caption.replace(/<[^>]*>/g, "").replace(/\s*[—–]\s*/g, ", ")), urls, post.kind === "video");
  if (!sent.ok) return { status: "failed", error: String((sent.data as { error?: string }).error ?? "X posting failed"), result: JSON.stringify(sent.data).slice(0, 20000) };
  return { status: "posted", requestId: sent.postIds?.x, result: JSON.stringify(sent.data).slice(0, 20000) };
}
/** X through the X API when the posting account is connected there, everything else through Upload-Post. */
export type PublishOutcome = { status: string; error?: string; requestId?: string; result?: string };
export async function publishRouted(post: { _id: string; caption: string; kind: string; mediaUrl?: string; platforms: string[] }, profile: string): Promise<PublishOutcome> {
  const direct = post.platforms.includes("x") && xConfigured() && !!(await readX(profile));
  if (!direct) return publishContent(post, profile);
  const x = await publishViaX(post, profile);
  const rest = post.platforms.filter(p => p !== "x");
  if (x.status !== "posted" || !rest.length) return x;
  const other = await publishContent({ ...post, platforms: rest }, profile);
  return other.status === "failed" ? { ...other, error: `Posted to X. ${other.error ?? "Other platforms failed"}` } : other;
}
