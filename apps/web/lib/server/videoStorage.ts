/**
 * Video blob storage — Cloudflare R2 first, Convex storage fallback.
 *
 * Convex file storage charges for BOTH the stored GBs and every playback's
 * egress; at 130GB+ of mp4s that dominated the whole Convex bill. R2 stores
 * the same bytes at $0.015/GB-month with ZERO egress, so every video write
 * in the app funnels through putVideo() here.
 *
 * storageId convention: R2 objects are tracked as "r2:<bucket key>" in the
 * same columns that used to hold Convex storage ids (downloadCache.storageId,
 * clip audio ids, …). isR2StorageId() lets delete paths branch: r2-prefixed
 * ids are deleted here via the S3 API, bare ids still go through
 * clipStorage.deleteStorage for blobs that predate the migration.
 *
 * Fallback: when the R2_* env vars are absent (local dev before keys exist,
 * or a misconfigured deploy) putVideo silently uses Convex storage exactly
 * like the old code — a missing env var must never fail a render.
 *
 * Works in BOTH Next server routes and Convex "use node" actions (aws4fetch
 * is fetch-based sigv4 — no filesystem, no AWS SDK weight).
 */
import { AwsClient } from "aws4fetch";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { randomUUID } from "node:crypto";

const R2_ID_PREFIX = "r2:";

export function isR2StorageId(storageId: string): boolean {
  return storageId.startsWith(R2_ID_PREFIX);
}

export function r2KeyFromStorageId(storageId: string): string | null {
  return isR2StorageId(storageId) ? storageId.slice(R2_ID_PREFIX.length) : null;
}

/** `<prefix>/<yyyy-mm-dd>/<uuid>.mp4` — date folder keeps the bucket browsable
 *  and lets lifecycle rules target transient prefixes (e.g. sources/). */
export function makeVideoKey(prefix: string, ext = "mp4"): string {
  const safe = prefix.replace(/[^a-zA-Z0-9_-]+/g, "/").replace(/^\/+|\/+$/g, "") || "videos";
  const day = new Date().toISOString().slice(0, 10);
  return `${safe}/${day}/${randomUUID()}.${ext}`;
}

export function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_BASE_URL,
  );
}

export function r2PublicUrl(key: string): string {
  const base = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/${key}`;
}

function r2Client(): AwsClient {
  return new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });
}

function r2ObjectEndpoint(key: string): string {
  return `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}/${key}`;
}

export type StoredVideo = { url: string; storageId: string };

/** Object-key extension per audio MIME — the key must match the real type so
 *  players/ffmpeg don't sniff a WAV out of a `.mp4`. Anything unlisted is video. */
const AUDIO_EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3",
  "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/ogg": "ogg", "audio/flac": "flac", "audio/webm": "weba",
};

/**
 * Store video bytes; returns a public playback URL plus a storageId usable
 * with deleteVideoBlob. Prefers R2; falls back to Convex storage when R2 env
 * is missing so a render never fails on configuration.
 */
export async function putVideo(
  bytes: Uint8Array | ArrayBuffer,
  opts: { keyPrefix?: string; contentType?: string; convexUrl?: string } = {},
): Promise<StoredVideo> {
  const body = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const contentType = opts.contentType ?? "video/mp4";

  if (r2Configured()) {
    const ext = AUDIO_EXT_BY_MIME[contentType] ?? "mp4";
    const key = makeVideoKey(opts.keyPrefix ?? "videos", ext);
    const res = await r2Client().fetch(r2ObjectEndpoint(key), {
      method: "PUT",
      // Explicit Content-Length: aws4fetch re-wraps the body in a Request, which
      // undici sometimes sends as a chunked stream — R2 then rejects with
      // HTTP 411 MissingContentLength (the intermittent "setup failed" on the
      // UGC sample stock cards). Pinning the length forces a fixed-size body.
      headers: { "Content-Type": contentType, "Content-Length": String(body.byteLength) },
      body: body as unknown as BodyInit,
    });
    if (!res.ok) throw new Error(`R2 PUT failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return { url: r2PublicUrl(key), storageId: `${R2_ID_PREFIX}${key}` };
  }

  // Fallback: legacy Convex storage path (identical to the pre-R2 code).
  console.warn("[videoStorage] R2 env not configured — falling back to Convex storage");
  const convexUrl = opts.convexUrl ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("videoStorage: neither R2 env nor NEXT_PUBLIC_CONVEX_URL configured");
  const convex = new ConvexHttpClient(convexUrl);
  const uploadUrl = await convex.mutation(api.clipStorage.generateUploadUrl, {});
  const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": contentType }, body: body as unknown as BodyInit });
  const { storageId } = (await up.json()) as { storageId: string };
  const url = await convex.mutation(api.clipStorage.resolveStorageUrl, { storageId: storageId as unknown as never });
  if (!url) throw new Error("videoStorage: Convex getUrl returned null after store");
  return { url, storageId };
}

/**
 * Store a video from a file on disk WITHOUT buffering it in RAM — for the
 * multi-GB yt-dlp source downloads. Streams the file with a fixed
 * Content-Length and signs the request UNSIGNED-PAYLOAD (sigv4 can't hash a
 * stream; R2 accepts it). R2-only: callers keep their legacy Convex upload
 * as the not-configured fallback.
 */
export async function putVideoFile(
  filePath: string,
  size: number,
  opts: { keyPrefix?: string; contentType?: string } = {},
): Promise<StoredVideo> {
  if (!r2Configured()) throw new Error("putVideoFile requires R2 env");
  const contentType = opts.contentType ?? "video/mp4";
  const ext = contentType === "audio/mpeg" ? "mp3" : contentType === "audio/mp4" ? "m4a" : "mp4";
  const key = makeVideoKey(opts.keyPrefix ?? "videos", ext);
  const { createReadStream } = await import("node:fs");
  const res = await r2Client().fetch(r2ObjectEndpoint(key), {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    },
    body: createReadStream(filePath) as unknown as BodyInit,
    // @ts-expect-error duplex is required by Node's fetch for a streaming body but missing from the DOM RequestInit lib types.
    duplex: "half",
  });
  if (!res.ok) throw new Error(`R2 PUT (stream) failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { url: r2PublicUrl(key), storageId: `${R2_ID_PREFIX}${key}` };
}

/**
 * Store an operator upload straight from the incoming request body stream —
 * never buffered in RAM, so multi-GB source videos upload fine. Same
 * UNSIGNED-PAYLOAD + fixed Content-Length contract as putVideoFile. R2-only
 * (uploads never fall back to Convex storage). `ext` is the object-key
 * extension (mp4/mov/webm/png/jpg…) so ffmpeg + the source classifier see the
 * real type.
 */
export async function putVideoStream(
  body: ReadableStream<Uint8Array>,
  size: number,
  opts: { keyPrefix?: string; contentType?: string; ext?: string } = {},
): Promise<StoredVideo> {
  if (!r2Configured()) throw new Error("Media storage (R2) is not configured on this server");
  const contentType = opts.contentType ?? "video/mp4";
  const ext = (opts.ext ?? "mp4").replace(/[^a-z0-9]/gi, "").toLowerCase() || "mp4";
  const key = makeVideoKey(opts.keyPrefix ?? "uploads", ext);
  const res = await r2Client().fetch(r2ObjectEndpoint(key), {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    },
    body: body as unknown as BodyInit,
    // @ts-expect-error duplex is required by Node's fetch for a streaming body but missing from the DOM RequestInit lib types.
    duplex: "half",
  });
  if (!res.ok) throw new Error(`R2 PUT (upload) failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { url: r2PublicUrl(key), storageId: `${R2_ID_PREFIX}${key}` };
}

/**
 * Delete a stored blob by storageId. r2:-prefixed ids delete from R2 here;
 * bare Convex ids go through the secret-gated clipStorage.deleteStorage
 * mutation (pre-migration blobs). Best-effort semantics match the old path.
 */
export async function deleteVideoBlob(storageId: string, opts: { convexUrl?: string } = {}): Promise<{ ok: boolean }> {
  const key = r2KeyFromStorageId(storageId);
  if (key !== null) {
    if (!r2Configured()) return { ok: false };
    const res = await r2Client().fetch(r2ObjectEndpoint(key), { method: "DELETE" });
    return { ok: res.ok || res.status === 404 };
  }
  const convexUrl = opts.convexUrl ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  const authSecret = process.env.INTERNAL_CRON_SECRET;
  if (!convexUrl || !authSecret) return { ok: false };
  const convex = new ConvexHttpClient(convexUrl);
  try {
    return await convex.mutation(api.clipStorage.deleteStorage, { storageId, authSecret });
  } catch {
    return { ok: false };
  }
}

/** PUT a small object at an EXACT key (no date/uuid) — for fixed-path JSON
 *  like the /dev/jev metrics log. R2-only. */
export async function putR2Object(key: string, body: Uint8Array | string, contentType = "application/json"): Promise<void> {
  if (!r2Configured()) throw new Error("R2 is not configured");
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const res = await r2Client().fetch(r2ObjectEndpoint(key), {
    method: "PUT",
    headers: { "Content-Type": contentType, "Content-Length": String(bytes.byteLength) },
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`R2 PUT ${key} failed: HTTP ${res.status}`);
}

/** Signed GET of an exact key (bypasses the public CDN, so never stale).
 *  null when the object doesn't exist. */
export async function getR2Object(key: string): Promise<string | null> {
  if (!r2Configured()) return null;
  const res = await r2Client().fetch(r2ObjectEndpoint(key), { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 GET ${key} failed: HTTP ${res.status}`);
  return res.text();
}
