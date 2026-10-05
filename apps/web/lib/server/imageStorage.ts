/**
 * Image blob storage — Cloudflare R2.
 *
 * Agent avatars, Kie reference images, character grids and campaign refs used
 * to live in Supabase Storage (buckets `vello-avatars` / `vello-campaign-refs`).
 * On 2026-09-02 that project hit its free-tier quotas and Supabase started
 * answering EVERY storage request — public and service-role alike — with
 * HTTP 402 "Service for this project is restricted", which blanked every agent
 * profile image across the app. R2 already holds the videos (see
 * videoStorage.ts) with zero egress cost, so every image write goes here too.
 *
 * Works in Next.js route handlers and Node-runtime helpers (aws4fetch, no SDK).
 */
import { AwsClient } from "aws4fetch";
import { optimizePortrait } from "./optimizePortrait";
import { randomUUID } from "node:crypto";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export function extForMime(mime: string, fallback = "bin"): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return EXT_BY_MIME[base] ?? fallback;
}

export function r2ImageConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_BASE_URL,
  );
}

function client(): AwsClient {
  return new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });
}

function objectEndpoint(key: string): string {
  return `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}/${key}`;
}

export function imagePublicUrl(key: string): string {
  const base = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/${key}`;
}

/** `<prefix>/<yyyy-mm-dd>/<uuid>.<ext>` — same shape as the video keys. */
export function makeImageKey(prefix: string, ext: string): string {
  const safe = prefix.replace(/[^a-zA-Z0-9_-]+/g, "/").replace(/^\/+|\/+$/g, "") || "images";
  const day = new Date().toISOString().slice(0, 10);
  return `${safe}/${day}/${randomUUID()}.${ext}`;
}

/** True when an object already exists at `key` (used for deterministic caches). */
export async function imageExists(key: string): Promise<boolean> {
  if (!r2ImageConfigured()) return false;
  try {
    const res = await client().fetch(objectEndpoint(key), { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

export type StoredImage = { url: string; key: string };

/**
 * Store image bytes in R2 and return the public URL. Pass `key` for a
 * deterministic path (cache-style writes, e.g. the static GIF frame); otherwise
 * a date-bucketed uuid key is minted under `keyPrefix`.
 *
 * Throws when R2 isn't configured — callers that used to tolerate a missing
 * Supabase config should catch and degrade exactly as before.
 */
export async function putImage(
  bytes: Uint8Array | ArrayBuffer | Buffer,
  contentType: string,
  opts: { keyPrefix?: string; key?: string } = {},
): Promise<StoredImage> {
  if (!r2ImageConfigured()) throw new Error("imageStorage: R2_* env not configured");
  const body = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const key = opts.key ?? makeImageKey(opts.keyPrefix ?? "images", extForMime(contentType));
  const res = await client().fetch(objectEndpoint(key), {
    method: "PUT",
    // Explicit Content-Length — see videoStorage.putVideo (R2 411 on chunked bodies).
    headers: { "Content-Type": contentType, "Content-Length": String(body.byteLength) },
    body: body as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`R2 PUT failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { url: imagePublicUrl(key), key };
}

/** Fetch a remote image and mirror it into R2. Returns null on any failure. */
export async function mirrorImageToR2(
  url: string,
  opts: { keyPrefix?: string; key?: string; maxBytes?: number; timeoutMs?: number; optimize?: boolean } = {},
): Promise<StoredImage | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "image/png").split(";")[0].trim();
    if (!/^(image|video)\//i.test(mime)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > (opts.maxBytes ?? 50_000_000)) return null;
    if (opts.optimize) {
      const lightweight = await optimizePortrait(buf);
      const key = opts.key?.replace(/\.[^/.]+$/, ".webp");
      return await putImage(lightweight, "image/webp", {keyPrefix: opts.keyPrefix, key});
    }
    return await putImage(buf, mime, { keyPrefix: opts.keyPrefix, key: opts.key });
  } catch {
    return null;
  }
}

/** Read an object's text back from R2 (null when missing). Used for small JSON docs. */
export async function getObjectText(key: string): Promise<string | null> {
  if (!r2ImageConfigured()) return null;
  try {
    const res = await client().fetch(objectEndpoint(key), { method: "GET" });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Owner-scoped object inventory, including legacy portraits without a history index. */
export async function listImageObjects(prefix: string): Promise<{ key: string; modified: string }[]> {
  if (!r2ImageConfigured()) throw new Error("Image storage is not configured");
  const objects: { key: string; modified: string }[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const url = new URL(objectEndpoint(""));
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max-keys", "1000");
    if (cursor) url.searchParams.set("continuation-token", cursor);
    const res = await client().fetch(url.toString());
    if (!res.ok) throw new Error(`Image history unavailable (${res.status})`);
    const xml = await res.text();
    const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = decode(match[1].match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? "");
      const modified = match[1].match(/<LastModified>(.*?)<\/LastModified>/)?.[1] ?? "";
      if (key.startsWith(prefix)) objects.push({ key, modified });
    }
    cursor = decode(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? "");
    if (!cursor) break;
  }
  return objects.sort((a, b) => b.modified.localeCompare(a.modified));
}
