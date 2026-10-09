import { withoutPostLinks } from "../marketingCaption";
import { sanitizeYoutubeTitle } from "../youtubeTitle";
import { xConfigured, readX, postX, removeX } from "./xApi";
/**
 * Upload-Post API wrapper (server-only).
 *
 * Upload-Post (https://docs.upload-post.com) is a managed multi-platform poster:
 * one API key + one "user profile" per agent. Social accounts are linked through
 * a hosted connect page (we generate a short-lived JWT URL), so we never handle
 * per-platform OAuth ourselves. Posting is a single call with `platform[]`.
 *
 * Auth header: `Authorization: Apikey <key>`. Base: https://api.upload-post.com/api
 */

const BASE = "https://api.upload-post.com/api";

/** YouTube hard-rejects a video title longer than 100 characters (HTTP 400 that
 *  fails the WHOLE multi-platform post). This is the final, LLM-free guard every
 *  video post passes through: strip em/en dashes (the operator never wants them),
 *  collapse whitespace, and cap to 100 chars at a word boundary so the title stays
 *  readable instead of being cut mid-word. Pure + dependency-free so the transport
 *  layer can call it without importing the caption/LLM stack. */
/** YouTube classifies Shorts by the uploaded video's shape and duration, not
 *  by an Upload-Post flag or a hashtag. Keep this discovery tag, but never
 *  rely on it for eligibility: callers must prepare the actual video first. */
export function withShortsTag(description: string): string {
  const d = (description ?? "").trim();
  if (/#shorts\b/i.test(d)) return d;
  return d ? `${d}\n\n#Shorts` : "#Shorts";
}

export { sanitizeYoutubeTitle } from "../youtubeTitle";

export function getApiKey(): string | null {
  return process.env.UPLOAD_POST_API_KEY?.trim() || null;
}

export function isConfigured(): boolean {
  return !!getApiKey() || xConfigured();
}

/** Upload-post usernames allow `[A-Za-z0-9_-]`; strip anything else and bound length. */
function sanitizeProfileId(raw: string): string {
  return (raw ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100);
}

/**
 * Canonical upload-post profile id for ONE agent.
 *
 * GUARANTEE (one profile per agent, reused):
 * - The SAME agent always resolves to the SAME username here, so connecting
 *   multiple social accounts (TikTok + Instagram + Threads …) for that agent
 *   links them ALL to the same already-created profile — `ensureProfile` is
 *   idempotent, so a second/third connect never spawns a new profile.
 * - Only a DIFFERENT agent (different mintAddress) gets a new profile.
 * - The key is the agent's STABLE on-chain id (mintAddress) once minted — stable
 *   across every connect and every browser session. Pre-mint we fall back to the
 *   session id (posting requires a mint anyway, so real connects are keyed by
 *   mintAddress).
 *
 * `UPLOAD_POST_USERNAME_PREFIX` is optional account-hygiene namespacing (e.g.
 * "vello") and still yields a unique id per agent. It NEVER collapses agents to a
 * single shared profile.
 *
 * NOTE: per-agent profiles require an upload-post plan that permits multiple user
 * profiles. On a capped plan, creating the 2nd+ profile returns 403 — surfaced as
 * a clear "plan limit reached" message at connect time.
 */
export function resolveUsername(agentId: string): string {
  const base = sanitizeProfileId(agentId);
  if (!base) return "";
  const prefix = sanitizeProfileId(process.env.UPLOAD_POST_USERNAME_PREFIX ?? "");
  return prefix ? `${prefix}_${base}` : base;
}

/**
 * Platforms we surface in the UI. `id` is the canonical upload-post platform value
 * — SENT verbatim to every endpoint (/upload, /upload_photos, /upload_text). The
 * full valid set per the API docs: tiktok, instagram, bluesky, linkedin, youtube,
 * facebook, x, threads, pinterest, reddit, discord, telegram, google_business.
 * `videoId` is a READ-ONLY fallback for legacy result payloads that keyed X under
 * "twitter" — it is NEVER sent (the API rejects "twitter" now).
 */
export interface PlatformConfig {
  id: string;
  label: string;
  videoId?: string;     // legacy read-fallback only (never sent)
  text: boolean;        // supports text-only posts (/upload_text)
  photo: boolean;       // supports photo posts (/upload_photos)
  video: boolean;       // supports video posts (/upload)
}

export const UPLOAD_POST_PLATFORMS: PlatformConfig[] = [
  { id: "tiktok",         label: "TikTok",         text: false, photo: true,  video: true },
  { id: "instagram",      label: "Instagram",      text: false, photo: true,  video: true },
  { id: "youtube",        label: "YouTube",        text: false, photo: false, video: true },
  { id: "facebook",       label: "Facebook",       text: true,  photo: true,  video: true },
  { id: "linkedin",       label: "LinkedIn",       text: true,  photo: true,  video: true },
  { id: "x",              label: "X",              text: true,  photo: true,  video: true, videoId: "twitter" },
  { id: "threads",        label: "Threads",        text: true,  photo: true,  video: true },
  { id: "bluesky",        label: "Bluesky",        text: true,  photo: true,  video: true },
  { id: "reddit",         label: "Reddit",         text: true,  photo: true,  video: true },
  { id: "pinterest",      label: "Pinterest",      text: false, photo: true,  video: true },
  { id: "telegram",       label: "Telegram",       text: true,  photo: true,  video: true },
  { id: "discord",        label: "Discord",        text: true,  photo: true,  video: true },
  { id: "google_business",label: "Google Business",text: true,  photo: true,  video: false },
].filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i); // de-dupe defensively

export const PLATFORM_IDS = UPLOAD_POST_PLATFORMS.map((p) => p.id);

class NotConfiguredError extends Error {
  constructor() {
    super("UPLOAD_POST_API_KEY is not set on the server.");
    this.name = "NotConfiguredError";
  }
}
export { NotConfiguredError };

/** Thrown when a new profile can't be created because the upload-post plan's
 *  profile cap is reached — lets callers surface a clear "plan limit" message
 *  (and an actionable next step) instead of a generic 502. */
class LimitReachedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitReachedError";
  }
}
export { LimitReachedError };

/** Provider-wide API throttling. Keep the reset hint so the route can return a
 * real HTTP 429 and the Schedule UI can show when Connect becomes available. */
class RateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message?: string) {
    const wait = Math.max(1, Math.ceil(retryAfterSeconds));
    super(message || `Social connections are temporarily rate limited. Try again in ${wait} seconds.`);
    this.name = "RateLimitError";
    this.retryAfterSeconds = wait;
  }
}
export { RateLimitError };

const PROFILE_KNOWN_TTL_MS = 30 * 60_000;
// Upload-Post documents white-label connect URLs as valid for 48 hours. Keep our
// reuse window slightly shorter so a user can retry Connect without hammering the
// generate-jwt endpoint, while still avoiding expired links.
const CONNECT_URL_TTL_MS = 47 * 60 * 60_000;
const knownProfiles = new Map<string, number>();
const connectUrlCache = new Map<string, { url: string; expiresAt: number }>();
const connectUrlByUsername = new Map<string, { url: string; expiresAt: number }>();
const connectUrlFlights = new Map<string, Promise<string>>();

function profileIsKnown(username: string): boolean {
  const expiresAt = knownProfiles.get(username) ?? 0;
  if (expiresAt > Date.now()) return true;
  knownProfiles.delete(username);
  return false;
}

function rememberProfile(username: string): void {
  knownProfiles.set(username, Date.now() + PROFILE_KNOWN_TTL_MS);
}

function retryAfterSeconds(res: Response): number {
  const rawRetry = res.headers.get("retry-after")?.trim();
  if (rawRetry) {
    const seconds = Number(rawRetry);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
    const dateMs = Date.parse(rawRetry);
    if (Number.isFinite(dateMs)) return Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
  }
  const rawReset = res.headers.get("x-ratelimit-reset")?.trim();
  if (rawReset) {
    const reset = Number(rawReset);
    if (Number.isFinite(reset) && reset > 0) {
      const resetMs = reset > 10_000_000_000 ? reset : reset * 1000;
      return Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
    }
  }
  return 30;
}

function providerError(data: Record<string, unknown>, fallback: string): string {
  for (const key of ["error", "message", "detail"]) {
    if (typeof data[key] === "string" && data[key].trim()) return data[key].trim();
  }
  return fallback;
}

function authHeaders(json = false): Record<string, string> {
  const key = getApiKey();
  if (!key) throw new NotConfiguredError();
  const h: Record<string, string> = { Authorization: `Apikey ${key}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export interface EnsureProfileResult {
  /** The profile exists (created now or already present) and is usable. */
  ok: boolean;
  /** A new profile was created on this call (201). */
  created: boolean;
  /** The plan's profile cap was hit (403) — no new profile could be created. */
  limitReached: boolean;
  error?: string;
}

/**
 * Create the agent's white-label user profile if it doesn't exist, using our API
 * key — the end user never needs an upload-post login. Idempotent: an existing
 * profile is reported as ok. A 403 means the account's profile limit is reached.
 */
export async function ensureProfile(username: string): Promise<EnsureProfileResult> {
  if (profileIsKnown(username)) return { ok: true, created: false, limitReached: false };
  try {
    // A brand-new agent's FIRST connect click used to fire an existence-check GET
    // here, THEN the create POST below, THEN the generate-jwt POST in
    // generateConnectUrlUncached — 3 sequential upload-post calls on one click.
    // upload-post's rate limit is a shared bucket across every agent on this
    // account, so that burst alone could trip it well before any real per-second
    // volume did — surfacing as "Preparing the secure connect link. Retrying
    // automatically in Ns" on the very first connect attempt. The create POST
    // already treats "already exists" (400/409) as success (below), so the GET
    // was pure redundancy — skip straight to create and cut the burst to 2 calls.
    const res = await fetch(`${BASE}/uploadposts/users`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ username }),
    });
    if (res.status === 403) {
      return { ok: false, created: false, limitReached: true, error: "upload-post profile limit reached" };
    }
    if (res.status === 429) {
      throw new RateLimitError(retryAfterSeconds(res));
    }
    // 201 = created; 200/400/409 = already exists or benign validation — all usable.
    if (res.ok || res.status === 400 || res.status === 409) {
      rememberProfile(username);
      return { ok: true, created: res.status === 201, limitReached: false };
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: false,
      created: false,
      limitReached: false,
      error: providerError(data, `profile setup failed (${res.status})`),
    };
  } catch (err) {
    if (err instanceof NotConfiguredError || err instanceof RateLimitError) throw err;
    return { ok: false, created: false, limitReached: false, error: "network error creating profile" };
  }
}

/**
 * Delete the agent's entire upload-post profile — removing ALL its connected
 * social accounts at once. upload-post has no per-account disconnect API, so a
 * full reset is the only programmatic way to clear connections. The profile is
 * lazily re-created on the next status check (ensureProfile), so this is a clean
 * "disconnect everything" rather than a permanent teardown.
 */
export async function deleteProfile(username: string): Promise<{ ok: boolean; error?: string }> {
  if (xConfigured()) await removeX(username);
  if (!getApiKey()) return { ok: true };
  try {
    const res = await fetch(`${BASE}/uploadposts/users`, {
      method: "DELETE",
      headers: authHeaders(true),
      body: JSON.stringify({ username }),
    });
    // 200 = deleted; 404 = already gone (nothing connected) — both are success.
    if (res.ok || res.status === 404) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? `delete failed (${res.status})` };
  } catch (err) {
    if (err instanceof NotConfiguredError) throw err;
    return { ok: false, error: "network error deleting profile" };
  }
}

export interface ConnectedAccount {
  /** Stable platform account ID; often opaque and not a public URL slug. */
  id?: string;
  /** The connected account's own public @name (not the Vello agent handle). */
  handle?: string;
  displayName?: string;
  image?: string;
}

/** Returns a map of platform id → connection details (null when not connected). */
export async function getProfile(
  username: string,
): Promise<{ connected: Record<string, ConnectedAccount | null>; exists: boolean }> {
  const storedX = xConfigured() ? await readX(username) : null;
  const direct: ConnectedAccount | null = storedX ? { id: storedX.id, handle: storedX.handle, displayName: storedX.displayName, ...(storedX.image ? { image: storedX.image } : {}) } : null;
  if (!getApiKey()) return { exists: Boolean(direct), connected: Object.fromEntries(UPLOAD_POST_PLATFORMS.map(p => [p.id, p.id === "x" ? direct : null])) };
  const res = await fetch(`${BASE}/uploadposts/users/${encodeURIComponent(username)}`, {
    headers: authHeaders(),
  });
  const connected: Record<string, ConnectedAccount | null> = {};
  for (const p of UPLOAD_POST_PLATFORMS) connected[p.id] = null;

  if (res.status === 404) return { connected: { ...connected, x: direct }, exists: Boolean(direct) };
  if (!res.ok && direct) return { connected: { ...connected, x: direct }, exists: true };
  if (res.status === 429) throw new RateLimitError(retryAfterSeconds(res));
  if (!res.ok) throw new Error(`Social profile lookup failed (${res.status})`);
  rememberProfile(username);
  const data = (await res.json()) as {
    profile?: { social_accounts?: Record<string, unknown> };
  };
  const accounts = data.profile?.social_accounts ?? {};
  for (const p of UPLOAD_POST_PLATFORMS) {
    // X may be keyed as "x" or "twitter" depending on endpoint history.
    const raw = accounts[p.id] ?? (p.videoId ? accounts[p.videoId] : undefined);
    if (raw && raw !== "") {
      const obj = typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      connected[p.id] = {
        id: typeof obj.username === "string" ? obj.username : undefined,
        handle: typeof obj.handle === "string" ? obj.handle : undefined,
        displayName: typeof obj.display_name === "string" ? obj.display_name : undefined,
        image: typeof obj.social_images === "string" ? obj.social_images : undefined,
      };
    }
  }
  connected.x = direct;
  return { connected, exists: true };
}

/** Platforms upload-post's comments API actually supports (read + reply).
 *  TikTok has no public comments API at all; X/threads/etc aren't documented
 *  for this endpoint either — never call getComments/replyToComment for them. */
export const COMMENTABLE_PLATFORMS = ["instagram", "facebook", "youtube", "linkedin"];

export interface UploadPostComment {
  id: string;
  text: string;
  timestamp: string;
  username: string;
}

/** Comments on ONE specific live post. There is no "all comments" firehose —
 *  the API is scoped to a single post_url/post_id per call, so callers loop
 *  this over each recent posted video. Returns [] on any failure (missing
 *  post, unsupported platform, upstream error) — comments are a best-effort
 *  add-on, never worth failing the whole panel over one bad post. */
/** Identifies one specific live post to pull comments for. Prefer `postId`
 *  (the durable native platform post id) when available — the visible
 *  permalink (`postUrl`) is captured best-effort at post time and is
 *  routinely null for posts whose async publish couldn't be correlated yet
 *  (see pickCorrelatedPermalink), even though the post itself succeeded. A
 *  post missing BOTH is genuinely unaddressable and gets skipped upstream. */
export interface CommentTarget {
  postUrl?: string | null;
  postId?: string | null;
}

export async function getComments(
  username: string,
  platform: string,
  target: CommentTarget,
  limit = 20,
): Promise<UploadPostComment[]> {
  if (!target.postId && !target.postUrl) return [];
  try {
    const params = new URLSearchParams({ user: username, platform, limit: String(limit) });
    if (target.postId) params.set("post_id", target.postId);
    else params.set("post_url", target.postUrl!);
    const res = await fetch(`${BASE}/uploadposts/comments?${params.toString()}`, { headers: authHeaders() });
    if (!res.ok) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[uploadPost.getComments] ${res.status} for ${username}/${platform}`, await res.text().catch(() => ""));
      }
      return [];
    }
    const data = (await res.json().catch(() => null)) as {
      success?: boolean;
      comments?: Array<{ id: string | number; text?: string; timestamp?: string; user?: { username?: string } }>;
    } | null;
    if (!data?.success || !Array.isArray(data.comments)) return [];
    return data.comments.map((c) => ({
      id: String(c.id),
      text: c.text ?? "",
      timestamp: c.timestamp ?? "",
      username: c.user?.username ?? "unknown",
    }));
  } catch (e) {
    console.warn(`[uploadPost.getComments] failed for ${username}/${platform}:`, e instanceof Error ? e.message : e);
    return [];
  }
}

/** Reply to one comment. Instagram only supports replies (no top-level
 *  create), which is all this panel ever does anyway. */
export async function replyToComment(
  username: string,
  platform: string,
  commentId: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE}/uploadposts/comments/create`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ platform, user: username, comment_id: commentId, message }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({} as Record<string, unknown>));
      const msg = typeof j.error === "string" ? j.error : typeof j.message === "string" ? j.message : `Reply failed (${res.status})`;
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reply failed" };
  }
}

export interface GenerateConnectOptions {
  platforms?: string[];
  redirectUrl?: string;
  logoImage?: string;
  title?: string;
  description?: string;
}

/** Generate the hosted connect URL the user opens to link their accounts. */
export async function generateConnectUrl(
  username: string,
  opts: GenerateConnectOptions = {},
): Promise<string> {
  const cacheKey = JSON.stringify([username, opts.platforms ?? [], opts.redirectUrl ?? "", opts.logoImage ?? ""]);
  const cached = connectUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  if (cached) connectUrlCache.delete(cacheKey);
  const pending = connectUrlFlights.get(cacheKey);
  if (pending) return pending;

  const flight = generateConnectUrlUncached(username, opts)
    .then((url) => {
      const entry = { url, expiresAt: Date.now() + CONNECT_URL_TTL_MS };
      connectUrlCache.set(cacheKey, entry);
      connectUrlByUsername.set(username, entry);
      return url;
    })
    .catch((err) => {
      if (err instanceof RateLimitError) {
        const reusable = connectUrlByUsername.get(username);
        if (reusable && reusable.expiresAt > Date.now()) return reusable.url;
        if (reusable) connectUrlByUsername.delete(username);
      }
      throw err;
    });
  connectUrlFlights.set(cacheKey, flight);
  try {
    return await flight;
  } finally {
    connectUrlFlights.delete(cacheKey);
  }
}

async function generateConnectUrlUncached(
  username: string,
  opts: GenerateConnectOptions,
): Promise<string> {
  let profileSetupRateLimited = false;
  const ensured = await ensureProfile(username).catch((err) => {
    if (err instanceof RateLimitError) {
      profileSetupRateLimited = true;
      return { ok: true, created: false, limitReached: false } satisfies EnsureProfileResult;
    }
    throw err;
  });
  if (ensured.limitReached) {
    throw new LimitReachedError(
      "Couldn't create a profile for this agent — your upload-post plan's profile limit is reached. Upgrade your upload-post plan to give each agent its own connected accounts.",
    );
  }
  if (!ensured.ok) throw new Error(ensured.error ?? "Couldn't prepare this agent's social profile.");
  const body: Record<string, unknown> = { username };
  if (opts.platforms?.length) body.platforms = opts.platforms;
  if (opts.redirectUrl) body.redirect_url = opts.redirectUrl;
  if (opts.logoImage) body.logo_image = opts.logoImage;
  if (opts.title) body.connect_title = opts.title;
  if (opts.description) body.connect_description = opts.description;

  const res = await fetch(`${BASE}/uploadposts/users/generate-jwt`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { access_url?: string };
  if (!res.ok || !data.access_url) {
    // 404 here almost always means the profile doesn't exist because creating it
    // was rejected by the plan's profile limit (POST /users → 403).
    if (res.status === 404 && profileSetupRateLimited) {
      throw new RateLimitError(60, "Social profile setup is temporarily rate limited. Try again in 60 seconds.");
    }
    if (res.status === 404) {
      throw new LimitReachedError(
        "Couldn't create a profile for this agent — your upload-post plan's profile limit is likely reached. Upgrade your upload-post plan so each agent can have its own connected accounts.",
      );
    }
    if (res.status === 429) {
      throw new RateLimitError(retryAfterSeconds(res), providerError(data, "Social connections are temporarily rate limited."));
    }
    throw new Error(providerError(data, `Failed to generate connect URL (${res.status})`));
  }
  return data.access_url;
}

// ─── Resolving the published post link ───────────────────────────────────────

/** Public domains for each platform's post URLs — used to pick the REAL post link
 *  out of a response (not the input media URL we sent). */
const PLATFORM_DOMAINS: Record<string, string[]> = {
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  youtube: ["youtube.com", "youtu.be"],
  facebook: ["facebook.com", "fb.watch"],
  linkedin: ["linkedin.com"],
  x: ["x.com", "twitter.com"],
  threads: ["threads.net"],
};

/** Find a platform post URL inside an upload response object — preferring a URL on
 *  the platform's OWN domain (the actual post), never the input media URL. */
export function extractPostUrlFromResult(result: unknown, platform: string): string | null {
  const blob = JSON.stringify(result ?? "");
  const urls = blob.match(/https?:\/\/[^\s"'\\]+/g) ?? [];
  const domains = PLATFORM_DOMAINS[platform] ?? [];
  const onPlatform = urls.find((u) => domains.some((d) => u.includes(d)));
  return onPlatform ?? null;
}

/** Durable id fields an upload-post media-list item may carry for its published
 *  post (superset of extractPostIds' fields — defensive against shape drift). */
const MEDIA_ID_FIELDS = ["platform_post_id", "post_id", "publish_id", "id", "video_id", "media_id", "pk", "ig_id"] as const;
/** Request-level correlation ids a media item may echo back. */
const MEDIA_REQUEST_FIELDS = ["request_id", "requestId", "ref", "ref_id"] as const;

/**
 * Pick the permalink of the media-list item that PROVABLY belongs to THIS post,
 * correlating on the durable ids the post response already returned (the
 * platform_post_id and/or the upload-post request_id). Returns null when NO item
 * matches — NEVER the account's newest/unrelated post.
 *
 * This is the money-path guard behind Bug A: an async post (Instagram, etc.) whose
 * permalink isn't indexed yet must resolve to null (the durable ids still identify
 * the post for the oracle), NOT to whatever reel happens to be newest on the
 * connected account — otherwise a stale, unrelated permalink gets attached to a
 * campaign submission (and the SAME "latest" link repeats across every clip). Pure
 * + exported so the correlation rule is unit-testable in isolation.
 */
export function pickCorrelatedPermalink(
  items: unknown,
  match: { platformPostId?: string; requestId?: string },
): string | null {
  const ppid = match.platformPostId?.trim();
  const reqId = match.requestId?.trim();
  // No correlation key → we can't prove which item is THIS post → never guess.
  if (!ppid && !reqId) return null;
  if (!Array.isArray(items)) return null;
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const permalink = typeof item.permalink === "string" ? item.permalink : "";
    if (!/^https?:\/\//.test(permalink)) continue;
    const idVals = MEDIA_ID_FIELDS.map((f) => item[f]).filter((v): v is string => typeof v === "string" && v.length > 0);
    const reqVals = MEDIA_REQUEST_FIELDS.map((f) => item[f]).filter((v): v is string => typeof v === "string" && v.length > 0);
    const idMatch = ppid ? idVals.includes(ppid) : false;
    const reqMatch = reqId ? reqVals.includes(reqId) : false;
    if (idMatch || reqMatch) return permalink;
  }
  return null;
}

/**
 * The permalink for a JUST-published post, from upload-post's media list.
 * Instagram/etc. often process async and don't return the link inline, so this is
 * the way to get the share link after posting — but it ONLY returns a link it can
 * PROVE is this post via the caller-supplied durable ids (platform_post_id /
 * request_id). Without a correlation id (or when the post isn't indexed yet) it
 * returns null rather than the account's newest post (see pickCorrelatedPermalink
 * — the Bug A submit-wrong-URL guard).
 */
export async function getLatestPostLink(
  username: string,
  platform: string,
  match: { platformPostId?: string; requestId?: string },
): Promise<string | null> {
  // Fast-out: no correlation key means we could only return the account's newest
  // post — exactly the unrelated-reel bug — so don't even fetch.
  if (!match?.platformPostId && !match?.requestId) return null;
  try {
    const res = await fetch(
      `${BASE}/uploadposts/media?platform=${encodeURIComponent(platform)}&user=${encodeURIComponent(username)}`,
      { headers: authHeaders() },
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as unknown;
    const d = (data && typeof data === "object" ? (data as Record<string, unknown>) : {});
    const items: unknown = Array.isArray(data) ? data : (d.media ?? d.results ?? d.items ?? []);
    return pickCorrelatedPermalink(items, match);
  } catch {
    return null;
  }
}

// ─── Posting ─────────────────────────────────────────────────────────────────

export interface PostResult {
  ok: boolean;
  status: number;
  data: unknown;
  /** Platforms that the API body explicitly reported as failed (HTTP can be 200
   *  while a platform's OAuth is stale / its post errored). Present only when the
   *  body carried a per-platform breakdown showing at least one failure. */
  failed?: { platform: string; error: string }[];
  /** upload-post request_id (async/scheduled uploads) — durable handle for later
   *  analytics lookups. Present only when the body carried it. */
  requestId?: string;
  /** Our-platform-id → native platform_post_id, for each platform whose post id
   *  the body exposed. The id is the other durable handle the oracle reads back. */
  postIds?: Record<string, string>;
}

/**
 * Pull the durable post identifiers out of an upload response: the top-level
 * `request_id` and, per requested platform, its native `platform_post_id` (or a
 * fallback id). The oracle later reads live metrics by one of these handles.
 *
 * Defensive — any unknown/empty shape yields `{ postIds: {} }` and NEVER throws.
 * Reuses the same per-platform results-map detection as `extractFailedPlatforms`,
 * and the X→"twitter" alias from `UPLOAD_POST_PLATFORMS`.
 */
export function extractPostIds(
  result: unknown,
  requested: string[],
): { requestId?: string; postIds: Record<string, string> } {
  const postIds: Record<string, string> = {};
  if (!result || typeof result !== "object") return { postIds };
  const d = result as Record<string, unknown>;

  // request_id (snake) or requestId (camel), only if a non-empty string.
  const rawReq = d.request_id ?? d.requestId;
  const requestId = typeof rawReq === "string" && rawReq.length > 0 ? rawReq : undefined;

  const results = (d.results ?? d.platforms ?? d.platform_results) as unknown;
  if (results && typeof results === "object" && !Array.isArray(results)) {
    const map = results as Record<string, unknown>;
    for (const p of requested) {
      const cfg = UPLOAD_POST_PLATFORMS.find((c) => c.id === p);
      // Look up by our id and by the video alias (X → "twitter").
      const entry = map[p] ?? (cfg?.videoId ? map[cfg.videoId] : undefined);
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const candidates: unknown[] = [
        e.platform_post_id,
        e.publish_id,
        e.post_id,
        e.id,
        e.video_id,
        Array.isArray(e.post_ids) ? e.post_ids[0] : undefined,
      ];
      const id = candidates.find((c) => typeof c === "string" && c.length > 0) as string | undefined;
      if (id) postIds[p] = id;
    }
  }
  return requestId ? { requestId, postIds } : { postIds };
}

function appendPlatforms(form: FormData, platforms: string[], _video = false) {
  // ALWAYS send the canonical platform id (X → "x"). upload-post's current API
  // rejects the legacy "twitter" alias ("Invalid platforms: ['twitter']"); the
  // list is now consistent across the /upload, /upload_photos and /upload_text
  // endpoints. `videoId` survives ONLY as a read-fallback for old result payloads.
  for (const id of platforms) form.append("platform[]", id);
}

/**
 * A 200 from upload-post does NOT mean every platform published — the body
 * carries a per-platform breakdown and a platform with stale OAuth can fail while
 * the HTTP call succeeds. Inspect the body for EXPLICIT per-platform failures.
 * Conservative: only reports a failure when the body clearly says so (unknown
 * shapes → empty → caller keeps res.ok), so a real success is never mis-flagged.
 */
export function extractFailedPlatforms(data: unknown, requested: string[]): { platform: string; error: string }[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const results = (d.results ?? d.platforms ?? d.platform_results) as unknown;
  const out: { platform: string; error: string }[] = [];
  if (results && typeof results === "object" && !Array.isArray(results)) {
    const map = results as Record<string, unknown>;
    for (const p of requested) {
      const cfg = UPLOAD_POST_PLATFORMS.find((c) => c.id === p);
      // ALIAS-AWARE (mirrors extractPostIds): the video endpoint SENDS X under its
      // "twitter" videoId (appendPlatforms), so upload-post keys X's result under
      // "twitter" too. Reading only map["x"] here missed a genuine X failure → the
      // post was falsely reported "posted" (a sent-vs-read token mismatch). Look up
      // our id AND the video alias so a failed X post is actually detected.
      const r = map[p] ?? (cfg?.videoId ? map[cfg.videoId] : undefined);
      if (r && typeof r === "object") {
        const rr = r as Record<string, unknown>;
        const failed =
          rr.success === false ||
          rr.status === "error" || rr.status === "failed" ||
          (typeof rr.error === "string" && rr.error.length > 0);
        if (failed) out.push({ platform: p, error: String(rr.error ?? rr.message ?? rr.status ?? "post failed") });
      } else if (Object.keys(map).length > 0) {
        // The response DID carry a per-platform breakdown, but this requested
        // platform isn't in it at all — upload-post silently dropped it. This
        // is exactly how "posted to x" got claimed while nothing appeared on X:
        // requested-minus-explicit-failures counted an absent platform as a
        // success. An absent entry in a real results map is a failure.
        out.push({ platform: p, error: "no result returned by upload-post (post not confirmed)" });
      }
    }
  }
  return out;
}

/** Auth-class error heuristic: does this upload-post per-platform error mean the
 *  connected account's OAuth is stale/expired/revoked/again-consent (so the fix
 *  is for the user to RE-LINK the account, not a retry)? Pure + exported so the
 *  actionable-message rule is unit-testable. */
export function isReconnectError(error: string): boolean {
  return /expire|token|re-?auth|authoriz|authenticat|unauthor|forbidden|401|403|revok|consent|permission|scope|re-?connect|re-?link|\blogin\b|not connected|no account/i.test(
    error ?? "",
  );
}

/**
 * Turn upload-post's per-platform failures into ONE human, actionable line for the
 * Posting tab (and the drip's stored error). Names each platform by its UI label
 * and — when the error looks like a stale-token issue (isReconnectError) — appends
 * a concrete "reconnect <Platform> in the builder's Connections panel" next step,
 * so a future failure shows WHY and what to do instead of a bare "Failed". Pure +
 * exported. Returns "" for no failures (the caller then falls back to an
 * HTTP-status message).
 */
export function formatPlatformFailures(
  failed: { platform: string; error: string }[] | undefined,
): string {
  if (!failed || failed.length === 0) return "";
  return failed
    .map(({ platform, error }) => {
      const label = UPLOAD_POST_PLATFORMS.find((p) => p.id === platform)?.label ?? platform;
      const msg = (error ?? "").trim() || "post failed";
      const hint = isReconnectError(msg) ? ` — reconnect ${label} in the builder's Connections panel` : "";
      return `${label}: ${msg}${hint}`;
    })
    .join("; ");
}

// Upstream upload timeout. A video post (upload-post fetches the clip + pushes to
// each platform) is slow, but must NOT hang forever — an unbounded fetch runs past
// the gateway's own limit and surfaces to the client as a bare 502 Bad Gateway.
// Bounded here so a stuck upload returns a CLEAN, explained failure instead.
const UPLOAD_SEND_TIMEOUT_MS = Number(globalThis.process?.env?.UPLOAD_POST_TIMEOUT_MS) || 240_000;

async function send(path: string, form: FormData, requested: string[] = []): Promise<PostResult> {
  if (requested.some(p => p === "x" || p === "twitter")) {
    const x = await postX(String(form.get("user")), xTweetText(String(form.get("x_title") || form.get("title") || "")), path === "/upload" ? [String(form.get("video"))] : form.getAll("photos[]").map(String), path === "/upload");
    const others = requested.filter(p => p !== "x" && p !== "twitter");
    if (!others.length) return x;
    form.delete("platform[]"); form.delete("platforms[]");
    appendPlatforms(form, others, path === "/upload");
    const rest = await send(path, form, others);
    const restData = rest.data && typeof rest.data === "object" ? rest.data as Record<string, unknown> : {};
    const otherResults = restData.results && typeof restData.results === "object" && !Array.isArray(restData.results) ? restData.results as Record<string, unknown> : {};
    const xResult = (x.data as { results?: { x?: unknown } }).results?.x ?? { success: false, error: x.failed?.[0]?.error };
    return { ...rest, ok: rest.ok && x.ok, failed: [...(rest.failed ?? []), ...(x.failed ?? [])], postIds: { ...rest.postIds, ...x.postIds }, data: { ...restData, results: { ...otherResults, x: xResult } } };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPLOAD_SEND_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: authHeaders(), // never set Content-Type — FormData sets the boundary
      body: form,
      signal: ctrl.signal,
    });
  } catch (e) {
    // Timeout or network drop → a CLEAN failed result (never throw a bare 502).
    const timedOut = (e as Error)?.name === "AbortError";
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      data: { error: timedOut ? `upload-post timed out after ${Math.round(UPLOAD_SEND_TIMEOUT_MS / 1000)}s` : (e instanceof Error ? e.message : "upload failed") },
      failed: requested.map((platform) => ({ platform, error: timedOut ? "timed out" : "network error" })),
    };
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  const failed = extractFailedPlatforms(data, requested);
  const ids = extractPostIds(data, requested);
  // ok requires HTTP success AND no platform explicitly reported as failed.
  return {
    ok: res.ok && failed.length === 0,
    status: res.status,
    data,
    failed: failed.length ? failed : undefined,
    requestId: ids.requestId,
    postIds: Object.keys(ids.postIds).length ? ids.postIds : undefined,
  };
}

/** X's tweet-text budget for upload-post's `x_title` (X caps a tweet at 280;
 *  275 leaves room for upload-post's own handling). Cuts on a word boundary. */
export const X_TWEET_MAX = 275;
export function xTweetText(text: string | undefined | null): string {
  const t = withoutPostLinks(text ?? "").replace(/\s+\n/g, "\n").trim();
  if (t.length <= X_TWEET_MAX) return t;
  const tickers = [...new Set(t.match(/\$[A-Za-z][A-Za-z0-9]{0,9}\b/g) ?? [])];
  const missed = tickers.filter(ticker => !t.slice(0, X_TWEET_MAX - 1).includes(ticker));
  if (missed.length) {
    const tail = ` ${missed.join(" ")}`;
    const room = X_TWEET_MAX - tail.length - 1;
    return `${t.slice(0, room).replace(/\s+\S*$/, "").trimEnd()}…${tail}`;
  }
  const cut = t.slice(0, X_TWEET_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > X_TWEET_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Text-only post (X, LinkedIn, Facebook, Threads, …). */
export async function uploadText(args: {
  username: string;
  platforms: string[];
  title: string;
}): Promise<PostResult> {
  const form = new FormData();
  form.append("user", args.username);
  form.append("title", args.title);
  appendPlatforms(form, args.platforms);
  return send("/upload_text", form, args.platforms);
}

/** Photo / carousel post. `photoUrls` may be public URLs (upload-post fetches them).
 *  TikTok-specific knobs mirror the /api/upload_photos docs (tiktok_title,
 *  post_mode, privacy_level, auto_add_music, disable_comment,
 *  brand_content_toggle, brand_organic_toggle, photo_cover_index) and are only
 *  sent when provided — other platforms ignore them. */
export async function uploadPhotos(args: {
  username: string;
  platforms: string[];
  photoUrls: string[];
  title?: string;
  description?: string;
  tiktokTitle?: string;
  postMode?: "DIRECT_POST" | "MEDIA_UPLOAD";
  privacyLevel?: string;
  autoAddMusic?: boolean;
  disableComment?: boolean;
  brandContentToggle?: boolean;
  brandOrganicToggle?: boolean;
  photoCoverIndex?: number;
  /** Instagram: media_type ("IMAGE" | "STORIES") — carousels auto-handle. */
  instagramMediaType?: string;
  /** X tweet text (docs: `x_title`, falls back to `title`). Without it a photo
   *  tweet carries only the short title — the caption (`description`) is NOT
   *  used by X, so callers should pass the caption here. */
  xTitle?: string;
}): Promise<PostResult> {
  const form = new FormData();
  form.append("user", args.username);
  for (const url of args.photoUrls) form.append("photos[]", url);
  // MEDIA_UPLOAD (the "add trending audio" flow) lands the carousel in the
  // TikTok inbox so the operator finishes editing in-app — per the /upload_photos
  // docs, draft mode IGNORES title/caption/privacy/API settings. Send them for a
  // DIRECT_POST (instant publish) only; a draft post never carries a title the
  // API would silently drop anyway. auto_add_music is still forwarded in both
  // modes (harmless, and applies where the API honors it).
  const isDraft = args.postMode === "MEDIA_UPLOAD";
  if (args.title && !isDraft) form.append("title", args.title);
  if (args.description && !isDraft) form.append("description", args.description);
  if (args.tiktokTitle && !isDraft) form.append("tiktok_title", args.tiktokTitle);
  if (args.postMode) form.append("post_mode", args.postMode);
  if (args.privacyLevel && !isDraft) form.append("privacy_level", args.privacyLevel);
  if (typeof args.autoAddMusic === "boolean") form.append("auto_add_music", String(args.autoAddMusic));
  if (typeof args.disableComment === "boolean" && !isDraft) form.append("disable_comment", String(args.disableComment));
  if (typeof args.brandContentToggle === "boolean" && !isDraft) form.append("brand_content_toggle", String(args.brandContentToggle));
  if (typeof args.brandOrganicToggle === "boolean" && !isDraft) form.append("brand_organic_toggle", String(args.brandOrganicToggle));
  if (typeof args.photoCoverIndex === "number" && !isDraft) form.append("photo_cover_index", String(args.photoCoverIndex));
  if (args.instagramMediaType) form.append("media_type", args.instagramMediaType);
  if (args.platforms.includes("x")) {
    // Tweet text = the caption (280-char capped; upload-post strips URLs itself).
    if (args.xTitle && !isDraft) form.append("x_title", xTweetText(args.xTitle));
    // One tweet, not a fragile thread, when the text runs long.
    form.append("x_long_text_as_post", "true");
  }
  appendPlatforms(form, args.platforms);
  return send("/upload_photos", form, args.platforms);
}

/** Video post. `videoUrl` may be a public URL (upload-post fetches it). */
export async function uploadVideo(args: {
  username: string;
  platforms: string[];
  videoUrl: string;
  title: string;
  description?: string;
  /** Optional pre-built YouTube title (e.g. an AI-shortened, persona-matched one).
   *  Whether supplied or not, the value sent to YouTube is ALWAYS run through
   *  sanitizeYoutubeTitle so it can never exceed YouTube's 100-char limit. */
  youtubeTitle?: string;
  /** Operator-uploaded cover/thumbnail image (public URL) — the Editor tab's
   *  Cover Image tool (lib/builder/coverImageConfig.ts). Only Instagram/YouTube
   *  have a real custom-cover-image field in this API; sent to whichever of
   *  those two are IN `args.platforms` for this call (harmless — simply
   *  ignored — for every other platform). TikTok has no such field: the
   *  caller instead sends TikTok a DIFFERENT `videoUrl` with the image burned
   *  in as its first frame (lib/server/tiktokCoverBurn.ts) and this field is
   *  left unset on that call. */
  coverImageUrl?: string;
  /** TikTok only: `cover_timestamp` (ms) — picks TikTok's auto-cover frame by
   *  time. Paired with coverImageUrl's TikTok burn-in (TIKTOK_COVER_TIMESTAMP_MS
   *  lands inside the burned-in still); harmless if TikTok isn't a target. */
  coverTimestampMs?: number;
  /** X tweet text (upload-post `x_title`). X does NOT read `description`, and
   *  `title` alone is often the generic "New video" fallback — X rejects a tweet
   *  identical to one already posted, so every scheduled clip after the first
   *  failed on X only. Pass the clip's caption (or its title) here; defaults to
   *  description → title. Always capped to X's 280-char tweet limit. */
  xTitle?: string;
}): Promise<PostResult> {
  const form = new FormData();
  form.append("user", args.username);
  form.append("video", args.videoUrl);
  if (args.platforms.includes("x")) {
    const tweet = xTweetText(args.xTitle || args.description || args.title);
    if (tweet) form.append("x_title", tweet);
    // One tweet, never a thread, when the text runs long.
    form.append("x_long_text_as_post", "true");
  }
  if (args.coverImageUrl) {
    if (args.platforms.includes("instagram")) form.append("cover_url", args.coverImageUrl);
    if (args.platforms.includes("youtube")) form.append("thumbnail_url", args.coverImageUrl);
  }
  if (typeof args.coverTimestampMs === "number" && args.platforms.includes("tiktok")) {
    form.append("cover_timestamp", String(Math.round(args.coverTimestampMs)));
  }
  // required by YouTube/Reddit, harmless elsewhere — an empty args.title (a bare
  // drip post with skipAutoCaption + no transcript) was reaching YouTube as "",
  // which upload-post rejects with "Title is required for Youtube" and stranded
  // the clip in an endless schedule/cancel/retry loop. youtube_title below already
  // had this fallback; this field needed the same one.
  form.append("title", args.title || args.youtubeTitle || "New video");
  if (args.description) form.append("description", args.description);
  // YouTube needs an explicit youtube_title AND rejects anything over 100 chars —
  // send a guaranteed-safe one (the caller's short title if given, else a capped
  // version of the caption) so a long caption never 400s the whole cross-post.
  // youtube_description is a SEPARATE override from the generic `description`
  // (shared across other platforms) so #Shorts only ever gets appended to the
  // copy YouTube itself sees, never leaking into IG/TikTok/etc. captions.
  if (args.platforms.includes("youtube")) {
    form.append("youtube_title", sanitizeYoutubeTitle(args.youtubeTitle || args.title) || "New video");
    form.append("youtube_description", withShortsTag(args.description || args.title));
  }
  appendPlatforms(form, args.platforms, true);
  return send("/upload", form, args.platforms);
}

// ─── Live post analytics ─────────────────────────────────────────────────────

/** Platform tokens we can query analytics for: our canonical ids plus their
 *  video-endpoint aliases (X → "twitter"), since the post may have been recorded
 *  under either token. */
const ANALYTICS_PLATFORMS = new Set<string>([
  ...PLATFORM_IDS,
  ...UPLOAD_POST_PLATFORMS.flatMap((p) => (p.videoId ? [p.videoId] : [])),
]);

export type PostAnalyticsResult =
  | { ok: true; metrics: Record<string, number>; platformPostId?: string; postUrl?: string }
  | { ok: false; reason: "not_found" | "not_ready" | "unsupported" | "error"; status?: number };

/** Pull every genuine numeric field out of a `post_metrics` object (views,
 *  impressions, plays, likes, comments, shares, … plus any others present).
 *  Only real finite numbers and non-empty numeric STRINGS are kept (e.g. 0 stays
 *  0, "12" → 12); everything else — null, boolean, empty/whitespace string,
 *  array, object, undefined, junk like "n/a" — is DROPPED (treated as absent,
 *  NEVER coerced to 0). This preserves the "absent => undefined" contract the
 *  oracle relies on: a missing metric must not look like a real measured 0. */
function numericMetrics(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number") {
      if (Number.isFinite(v)) out[k] = v;
      continue;
    }
    if (typeof v === "string") {
      const t = v.trim();
      if (t === "") continue; // "" / whitespace => absent
      const n = Number(t);
      if (Number.isFinite(n)) out[k] = n; // numeric string still coerces ("12" → 12)
      continue;
    }
    // null, boolean, array, object, undefined, symbol, bigint => absent (drop)
  }
  return out;
}

/** Turn one resolved platform entry into a result: not_ready when metrics aren't
 *  available yet, else the numeric metrics + ids. */
function analyticsFromEntry(entry: Record<string, unknown>): PostAnalyticsResult {
  const metricsErr = entry.post_metrics_error;
  if (typeof metricsErr === "string" && metricsErr.length > 0) return { ok: false, reason: "not_ready" };
  const pm = entry.post_metrics;
  if (!pm || typeof pm !== "object") return { ok: false, reason: "not_ready" };
  const metrics = numericMetrics(pm);
  const platformPostId = typeof entry.platform_post_id === "string" ? entry.platform_post_id : undefined;
  const postUrl = typeof entry.post_url === "string" ? entry.post_url : undefined;
  return { ok: true, metrics, platformPostId, postUrl };
}

/**
 * Read live per-post metrics from upload-post. Two lookup modes:
 *  - by `request_id` (the durable async-upload handle) →
 *    `GET /uploadposts/post-analytics/{request_id}` (+ `?platform=` when known);
 *  - by native `platform_post_id` →
 *    `GET /uploadposts/post-analytics?platform_post_id=&platform=&user=`.
 *
 * Defensive about the body shape (a `platforms` map keyed by platform, or a flat
 * per-platform object at the top level). Never throws except `NotConfiguredError`.
 */
export async function getPostAnalytics(
  args:
    | { requestId: string; platform?: string }
    | { platformPostId: string; platform: string; username: string },
): Promise<PostAnalyticsResult> {
  const platform = "platform" in args ? args.platform : undefined;
  // Reject unknown platforms up front (saves a wasted request).
  if (platform && !ANALYTICS_PLATFORMS.has(platform)) return { ok: false, reason: "unsupported" };

  let url: string;
  if ("requestId" in args) {
    url = `${BASE}/uploadposts/post-analytics/${encodeURIComponent(args.requestId)}`;
    if (platform) url += `?platform=${encodeURIComponent(platform)}`;
  } else {
    url =
      `${BASE}/uploadposts/post-analytics` +
      `?platform_post_id=${encodeURIComponent(args.platformPostId)}` +
      `&platform=${encodeURIComponent(args.platform)}` +
      `&user=${encodeURIComponent(args.username)}`;
  }

  try {
    const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(8_000) });
    if (res.status === 404) return { ok: false, reason: "not_found", status: 404 };
    if (!res.ok) return { ok: false, reason: "error", status: res.status };
    const data = (await res.json()) as Record<string, unknown>;

    // Resolve the platform entry. When a platform is given, look it up alias-aware
    // (mirrors extractPostIds): the canonical token, then its videoId alias
    // (x → "twitter"), then the reverse (a canonical platform whose videoId === the
    // queried token, "twitter" → x). As a last resort, if nothing matched and the
    // map holds exactly one entry, use it ONLY when it provably belongs to the queried
    // post — i.e. in platformPostId mode its platform_post_id equals the queried id.
    // (In requestId mode there is no id to verify against, so we must NOT guess: a
    // wrong single entry would settle/pay the wrong post. Defer to not_ready instead.)
    // With no platform, take the first entry. Falls back to the flat shape
    // (top-level post_metrics).
    const queriedPostId = "platformPostId" in args ? args.platformPostId : undefined;
    let entry: Record<string, unknown> | undefined;
    const platforms = data.platforms;
    if (platforms && typeof platforms === "object" && !Array.isArray(platforms)) {
      const map = platforms as Record<string, unknown>;
      let picked: unknown;
      if (platform) {
        const cfg = UPLOAD_POST_PLATFORMS.find((c) => c.id === platform);
        const reverseId = UPLOAD_POST_PLATFORMS.find((c) => c.videoId === platform)?.id;
        picked =
          map[platform] ??
          (cfg?.videoId ? map[cfg.videoId] : undefined) ??
          (reverseId ? map[reverseId] : undefined);
        if (picked === undefined || picked === null) {
          const values = Object.values(map);
          // Single-entry last resort: only safe when we can verify the entry belongs
          // to the queried post (platformPostId mode + matching platform_post_id).
          if (values.length === 1 && queriedPostId !== undefined) {
            const only = values[0];
            if (
              only &&
              typeof only === "object" &&
              String((only as Record<string, unknown>).platform_post_id) === queriedPostId
            ) {
              picked = only;
            }
          }
        }
      } else {
        // No platform to disambiguate: auto-pick ONLY when the map is unambiguous
        // (exactly one entry). With >1 entries we cannot tell which post is ours,
        // so picking the first could measure the WRONG post — defer to not_ready.
        const values = Object.values(map);
        if (values.length === 1) picked = values[0];
      }
      if (picked && typeof picked === "object") entry = picked as Record<string, unknown>;
    }
    if (!entry && data.post_metrics && typeof data.post_metrics === "object") entry = data;

    if (!entry) return { ok: false, reason: "not_ready" };
    return analyticsFromEntry(entry);
  } catch (err) {
    if (err instanceof NotConfiguredError) throw err;
    return { ok: false, reason: "error" };
  }
}

export type RecentMediaItem = {
  postId: string;
  postUrl: string | null;
  /** Epoch ms — the platform's own publish time, the best match key against our
   *  own clip.postedAt for a clip that never captured an id at post time. */
  uploadedAt: number | null;
};

/**
 * "Check the agent's own post history" — GET /uploadposts/media?platform=&user=,
 * the connected-account's native recent-media list. This is a DIFFERENT
 * endpoint from `/uploadposts/post-analytics/cached`: the cached-analytics
 * snapshot endpoint returned an EMPTY `posts` array for every real account
 * tested here (its snapshot job apparently never ran for these profiles), so
 * it cannot be used for backfill. `/media` reliably returns the real
 * platform_post_id + permalink + publish timestamp straight from the
 * connected platform (verified against a live TikTok-connected profile: 48
 * views came back once fed through getPostAnalytics with this id). It carries
 * NO view count itself — pair the matched id with getPostAnalytics/
 * fetchUploadPostViews (platformPostId mode) to get the actual metrics.
 */
export async function getRecentMedia(
  username: string,
  platform: string,
  opts?: { timeoutMs?: number },
): Promise<RecentMediaItem[]> {
  if (!platform) return [];
  const timeoutMs = opts?.timeoutMs ?? 8_000;
  try {
    const url = `${BASE}/uploadposts/media?platform=${encodeURIComponent(platform)}&user=${encodeURIComponent(username)}`;
    const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => ({}))) as unknown;
    const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const items: unknown[] = Array.isArray(data) ? (data as unknown[]) : Array.isArray(d.media) ? (d.media as unknown[]) : [];
    const out: RecentMediaItem[] = [];
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      const row = it as Record<string, unknown>;
      const postId = typeof row.id === "string" ? row.id : typeof row.id === "number" ? String(row.id) : null;
      if (!postId) continue;
      // TikTok/etc return `timestamp` in unix SECONDS; be defensive about ms too.
      const rawTs = row.timestamp;
      let uploadedAt: number | null = null;
      if (typeof rawTs === "number" && Number.isFinite(rawTs)) uploadedAt = rawTs > 1e12 ? rawTs : rawTs * 1000;
      else if (typeof rawTs === "string" && rawTs.trim()) {
        const n = Number(rawTs);
        uploadedAt = Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : (Number.isFinite(Date.parse(rawTs)) ? Date.parse(rawTs) : null);
      }
      out.push({
        postId,
        postUrl: typeof row.permalink === "string" ? row.permalink : typeof row.post_url === "string" ? row.post_url : null,
        uploadedAt,
      });
    }
    return out;
  } catch {
    return [];
  }
}


/** Platforms upload-post's profile analytics can report followers for without
 *  extra ids. Facebook is excluded: it requires a `page_id` query param. */
export const FOLLOWER_PLATFORMS = ["tiktok", "instagram", "youtube", "x", "threads", "linkedin", "bluesky", "pinterest", "reddit"];

export interface ProfileFollowers {
  ok: boolean;
  /** Sum of followers across every platform that reported a number. */
  total: number;
  /** Per-platform follower counts (only platforms that answered with a number). */
  byPlatform: Record<string, number>;
  /** upload-post answered 429 — the caller should stop this pass and retry later. */
  rateLimited?: boolean;
  error?: string;
}

/**
 * Live follower counts for ONE upload-post profile:
 * `GET /api/analytics/{profile_username}?platforms=a,b,c` → `{ tiktok: { followers, … }, … }`.
 * A platform that isn't connected (or errors) answers `{ success:false, message }`
 * for that key only — skipped, never fails the whole call. Never throws.
 */
export async function getProfileFollowers(username: string, platforms: string[]): Promise<ProfileFollowers> {
  const wanted = platforms.map((p) => p.toLowerCase()).filter((p) => FOLLOWER_PLATFORMS.includes(p));
  if (!username || !wanted.length) return { ok: true, total: 0, byPlatform: {} };
  try {
    const res = await fetch(
      `${BASE}/analytics/${encodeURIComponent(username)}?platforms=${wanted.map(encodeURIComponent).join(",")}`,
      { headers: authHeaders(), signal: AbortSignal.timeout(45_000) },
    );
    if (res.status === 429) return { ok: false, total: 0, byPlatform: {}, rateLimited: true, error: "rate limited" };
    if (!res.ok) return { ok: false, total: 0, byPlatform: {}, error: `HTTP ${res.status}` };
    const data = (await res.json()) as Record<string, unknown>;
    const byPlatform: Record<string, number> = {};
    for (const p of wanted) {
      const v = data[p];
      if (!v || typeof v !== "object") continue;
      const n = Number((v as { followers?: unknown }).followers);
      if (Number.isFinite(n) && n >= 0) byPlatform[p] = Math.floor(n);
    }
    const total = Object.values(byPlatform).reduce((a, b) => a + b, 0);
    return { ok: true, total, byPlatform };
  } catch (e) {
    return { ok: false, total: 0, byPlatform: {}, error: e instanceof Error ? e.message : String(e) };
  }
}
