import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { safeFetchToBuffer } from "./downloader";
export const X_SCOPES =
  "tweet.read tweet.write users.read media.write offline.access";
export function xConfigured() {
  return Boolean(
    process.env.X_CLIENT_ID &&
    process.env.X_CLIENT_SECRET &&
    process.env.X_REDIRECT_URI &&
    process.env.X_TOKEN_ENCRYPTION_KEY,
  );
}
function key() {
  const k = Buffer.from(process.env.X_TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32)
    throw new Error(
      "X_TOKEN_ENCRYPTION_KEY must be a base64 encoded 32 byte key",
    );
  return k;
}
export function seal(value: unknown) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const b = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), b]).toString("base64url");
}
export function unseal<T>(value: string): T {
  const b = Buffer.from(value, "base64url");
  const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(),
  );
}
export function pkce(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}
export const xDb = () =>
  new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const secret = () => process.env.INTERNAL_CRON_SECRET ?? "";
type Account = {
  access_token: string;
  refresh_token: string;
  expiresAt: number;
  automatedPostingConsentAt?: number;
  id: string;
  handle: string;
  displayName: string;
  image?: string;
};
export async function readX(profile: string): Promise<Account | null> {
  const row = await xDb().query(
    makeFunctionReference<"query">("xAccounts:get"),
    { profile, authSecret: secret() },
  );
  return row ? unseal<Account>(row.encrypted) : null;
}
export async function saveX(profile: string, account: Account) {
  await xDb().mutation(makeFunctionReference<"mutation">("xAccounts:save"), {
    profile,
    encrypted: seal(account),
    authSecret: secret(),
  });
}
export async function removeX(profile: string) {
  await xDb().mutation(makeFunctionReference<"mutation">("xAccounts:remove"), {
    profile,
    authSecret: secret(),
  });
}
export async function xToken(params: Record<string, string>) {
  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok)
    throw new Error(
      `X authorization failed (${res.status}); reconnect your X account or check app access and credits.`,
    );
  const t = await res.json();
  if (!t.access_token) throw new Error("X returned no access token");
  return t;
}
const refreshes = new Map<string, Promise<Account>>();
async function activeX(profile: string) {
  const a = await readX(profile);
  if (!a) throw new Error("Connect X in agent settings first.");
  if (a.expiresAt > Date.now() + 60000) return a;
  let pending = refreshes.get(profile);
  if (!pending) {
    pending = (async () => {
      const t = await xToken({
        grant_type: "refresh_token",
        refresh_token: a.refresh_token,
      });
      const next = {
        ...a,
        ...t,
        refresh_token: t.refresh_token ?? a.refresh_token,
        expiresAt: Date.now() + t.expires_in * 1000,
      };
      await saveX(profile, next);
      return next;
    })();
    refreshes.set(profile, pending);
  }
  try {
    return await pending;
  } finally {
    refreshes.delete(profile);
  }
}
export async function postX(
  profile: string,
  text: string,
  urls: string[],
  video = false,
) {
  try {
    const a = await activeX(profile);
    const request = async (path: string, init: RequestInit = {}) => {
      const res = await fetch(`https://api.x.com/2${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${a.access_token}`,
          ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          ...init.headers,
        },
        signal: AbortSignal.timeout(60000),
      });
      const responseText = await res.text();
      const body = responseText ? JSON.parse(responseText) : {};
      if (!res.ok || body.errors?.length)
        throw new Error(
          `X request failed (${res.status}): ${body.detail ?? body.errors?.[0]?.detail ?? "Check permissions, credits, or reconnect X."}`,
        );
      return body;
    };
    if (urls.length > (video ? 1 : 4))
      throw new Error("X supports one video or up to four photos per post.");
    const mediaIds: string[] = [];
    for (const url of urls) {
      const { buffer, mime } = await safeFetchToBuffer(url, {
        maxBytes: video ? 100 * 1024 * 1024 : 5 * 1024 * 1024,
      });
      if (!(video ? mime.startsWith("video/") : mime.startsWith("image/")))
        throw new Error("Invalid X media type");
      let data: { id?: string; processing_info?: { state: string; check_after_secs?: number } } | undefined;
      if (video) {
        data = (await request("/media/upload/initialize", {
          method: "POST",
          body: JSON.stringify({ media_type: mime, total_bytes: buffer.length, media_category: "tweet_video" }),
        })).data;
        if (!data?.id) throw new Error("X returned no media ID");
        const uploadId = data.id;
        const chunkBytes = 4 * 1024 * 1024;
        for (let offset = 0, segment = 0; offset < buffer.length; offset += chunkBytes, segment++) {
          const form = new FormData();
          form.set("segment_index", String(segment));
          form.set("media", new Blob([new Uint8Array(buffer.subarray(offset, offset + chunkBytes))], { type: mime }), "video.mp4");
          await request(`/media/upload/${encodeURIComponent(uploadId)}/append`, { method: "POST", body: form });
        }
        data = (await request(`/media/upload/${encodeURIComponent(uploadId)}/finalize`, { method: "POST" })).data;
        if (!data) throw new Error("X returned no finalized media");
        data.id ??= uploadId;
      } else {
        data = (await request("/media/upload", {
          method: "POST",
          body: JSON.stringify({ media: buffer.toString("base64"), media_category: mime.includes("gif") ? "tweet_gif" : "tweet_image" }),
        })).data;
      }
      if (!data?.id) throw new Error("X returned no media ID");
      const id = data.id;
      const deadline = Date.now() + 120000;
      while (
        data.processing_info &&
        data.processing_info.state !== "succeeded"
      ) {
        if (data.processing_info.state === "failed" || Date.now() > deadline)
          throw new Error("X media processing failed or timed out");
        const delayMs = Math.min(10, Math.max(1, data.processing_info.check_after_secs ?? 1)) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        data = (
          await request(
            `/media/upload?command=STATUS&media_id=${encodeURIComponent(id)}`,
          )
        ).data;
        if (!data) throw new Error("X returned no media status");
      }
      mediaIds.push(id);
    }
    const body = await request("/tweets", {
      method: "POST",
      body: JSON.stringify({
        ...(text ? { text } : {}),
        ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
      }),
    });
    if (!body.data?.id) throw new Error("X returned no post ID");
    return {
      ok: true,
      status: 200,
      data: {
        results: {
          x: {
            url: `https://x.com/${a.handle}/status/${body.data.id}`,
            post_id: body.data.id,
          },
        },
      },
      postIds: { x: body.data.id },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : "X posting failed";
    return {
      ok: false,
      status: 502,
      data: { error },
      failed: [{ platform: "x", error }],
    };
  }
}

/** Tweet id from an x.com / twitter.com status URL. */
export function tweetIdFromUrl(url: string): string | undefined {
  return url.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/)?.[1];
}

/**
 * Live view count straight from the X API (v2 tweet lookup, public_metrics.impression_count).
 * App-only bearer token, so it works for any public post — no per-agent OAuth needed.
 */
export async function fetchXPostViews(tweetId: string, userToken?: string): Promise<{ ok: true; views: number; raw: Record<string, number> } | { ok: false; reason: string }> {
  const bearer = userToken ?? process.env.X_BEARER_TOKEN;
  if (!bearer) return { ok: false, reason: "x_bearer_not_configured" };
  try {
    const res = await fetch(`https://api.x.com/2/tweets/${encodeURIComponent(tweetId)}?tweet.fields=public_metrics`, {
      headers: { Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: `x_api_${res.status}` };
    const metrics = body?.data?.public_metrics as Record<string, number> | undefined;
    if (!metrics || typeof metrics.impression_count !== "number") return { ok: false, reason: "x_api_no_metrics" };
    return { ok: true, views: Math.max(0, Math.floor(metrics.impression_count)), raw: metrics };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? `x_api_${e.message}` : "x_api_error" };
  }
}

/** Same lookup, authenticated as the agent's own connected X account (its OAuth token has tweet.read). */
export async function fetchXPostViewsForProfile(profile: string, tweetId: string) {
  try {
    const a = await activeX(profile);
    return await fetchXPostViews(tweetId, a.access_token);
  } catch {
    return { ok: false as const, reason: "x_account_not_connected" };
  }
}
