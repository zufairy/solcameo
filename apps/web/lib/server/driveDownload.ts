import { driveFileId } from "./sourceKey";
import { probeRemoteVideoDurationSeconds } from "./ffmpegBin";

/**
 * Google Drive video ingestion. Auth, in priority order:
 *  - Service account (GOOGLE_SERVICE_ACCOUNT_JSON) → Drive API with a Bearer
 *    token; works on PRIVATE / shared-drive files the SA can access.
 *  - API key (GOOGLE_DRIVE_API_KEY) → Drive API with ?key=…; works for PUBLIC
 *    ("anyone with the link") files AND folders. Use this when an org policy
 *    (iam.disableServiceAccountKeyCreation) blocks creating SA keys — an API key
 *    is NOT a service-account key, so it is not blocked, and it is the right
 *    tool for public content.
 *  - Public fallback (neither set) → the `uc?export=download` flow, single
 *    FILES only ("anyone with the link"); FOLDERS cannot be listed without one
 *    of the API auths above.
 * No googleapis dependency — raw JWT (node crypto) + fetch keeps deps light.
 */

interface ServiceAccount { client_email: string; private_key: string; }

export function isDriveUrl(url: string): boolean {
  return driveFileId(url) !== null;
}

/** Lightweight Drive metadata for pickers and pricing. Never probes media: a
 * missing duration/thumbnail while Drive processes a new upload is normal. */
export async function getDriveVideoMetadata(url: string): Promise<{ name?: string; durationSeconds?: number; sizeBytes?: number; thumbnailLink?: string } | null> {
  const id = driveFileId(url);
  if (!id) return null;
  const auth = await resolveDriveAuth().catch(() => null);
  if (!auth) return null;
  try {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType,size,thumbnailLink,videoMediaMetadata(durationMillis)&supportsAllDrives=true`, auth, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return null;
    const data = await res.json() as { name?: string; mimeType?: string; size?: string; thumbnailLink?: string; videoMediaMetadata?: { durationMillis?: string | number } };
    if (data.mimeType && !data.mimeType.startsWith("video/")) return null;
    const ms = Number(data.videoMediaMetadata?.durationMillis);
    const size = Number(data.size);
    return { name: data.name, thumbnailLink: data.thumbnailLink, durationSeconds: Number.isFinite(ms) && ms > 0 ? ms / 1000 : undefined, sizeBytes: Number.isFinite(size) && size > 0 ? size : undefined };
  } catch { return null; }
}

/** Proxy Drive's short-lived thumbnail through server auth for private files. */
export async function fetchDriveVideoThumbnail(url: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const id = driveFileId(url);
  if (!id) return null;
  const auth = await resolveDriveAuth().catch(() => null);
  const metadata = auth ? await getDriveVideoMetadata(url) : null;
  const candidates = [metadata?.thumbnailLink, `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w320`].filter(Boolean) as string[];
  for (const link of candidates) {
    try {
      const host = new URL(link).hostname.toLowerCase();
      if (!(host === "google.com" || host.endsWith(".google.com") || host.endsWith(".googleusercontent.com"))) continue;
      const res = await fetch(link, { headers: link === metadata?.thumbnailLink && auth && "token" in auth ? { Authorization: `Bearer ${auth.token}` } : {}, signal: AbortSignal.timeout(8_000) });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.startsWith("image/") || Number(res.headers.get("content-length") ?? 0) > 3_000_000) continue;
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength <= 3_000_000) return { bytes, contentType: type };
    } catch { /* Try the public thumbnail endpoint next. */ }
  }
  return null;
}

/** Duration of a Drive video, priced BEFORE any download. In order:
 *   1. Drive API metadata (videoMediaMetadata.durationMillis) — instant, but
 *      needs a service account / API key, and Drive fills it in only once its
 *      own video processing finishes (fresh uploads often have none yet).
 *   2. ffmpeg reading just the container header over the API media URL.
 *   3. ffmpeg over the PUBLIC download URL ("anyone with the link") — works
 *      with no Google credentials configured at all, and when the service
 *      account simply wasn't given access to a publicly shared file.
 *  Undefined when none of them can read it (caller decides how strict to be). */
export async function getDriveVideoDuration(url: string): Promise<number | undefined> {
  const fileId = driveFileId(url);
  if (!fileId) return undefined;
  const auth = await resolveDriveAuth().catch(() => null);
  if (auth) {
    try {
      const res = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=videoMediaMetadata(durationMillis),size&supportsAllDrives=true`,
        auth,
      );
      if (res.ok) {
        const data = (await res.json()) as { videoMediaMetadata?: { durationMillis?: string | number } };
        const ms = Number(data.videoMediaMetadata?.durationMillis);
        if (Number.isFinite(ms) && ms > 0) return ms / 1000;
        const media = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
        const probed = "token" in auth
          ? await probeRemoteVideoDurationSeconds(media, { Authorization: `Bearer ${auth.token}` })
          : await probeRemoteVideoDurationSeconds(`${media}&key=${encodeURIComponent(auth.apiKey)}`);
        if (probed) return probed;
      }
    } catch { /* fall through to the public path */ }
  }
  try {
    const { res } = await resolvePublicDriveResponse(fileId, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(20_000) });
    const finalUrl = res.url;
    await res.body?.cancel().catch(() => {});
    if (!finalUrl) return undefined;
    return (await probeRemoteVideoDurationSeconds(finalUrl)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detect a Google Drive FOLDER url (`/drive/folders/<id>` or `open?id=<id>` on a
 * folders path) and return its folder id, else null. Distinct from a single
 * FILE url (driveFileId) — a folder must be expanded into its member files
 * before transcription.
 */
export function driveFolderId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/(?:drive\/)?folders\/([^/?]+)/);
    if (m) return clean(m[1]);
  } catch {
    /* not a URL */
  }
  return null;
}

const clean = (s: string): string | null => (/^[A-Za-z0-9_-]{6,}$/.test(s) ? s : null);

export interface DriveFolderVideo { fileId: string; name: string }

/** Canonical single-file Drive URL for a fileId — `driveFileId()` parses it back
 *  and `sourceKey()` keys it as `gdrive:<fileId>`. */
export function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * List the VIDEO files inside a Drive folder AND its sub-folders via the Drive v3
 * `files.list` endpoint, using the existing service-account token (scope
 * `drive.readonly`) or API key. Supports shared drives. RECURSES into sub-folders
 * (campaign folders routinely nest their footage one or two levels deep, e.g.
 * "Ball footage", "content ads", …). Returns `[]` gracefully when no auth is
 * configured — the caller then has nothing to expand and continues. Paginates so
 * large folders are fully enumerated.
 */
export async function listDriveFolderVideos(folderId: string): Promise<DriveFolderVideo[]> {
  // 1) Try the Drive API (service account, or API key). GOTCHA: an API KEY can
  //    DOWNLOAD a public file but usually returns an EMPTY list for a link-shared
  //    ("anyone with the link") folder — files.list won't enumerate it. So if the
  //    API yields nothing (or errors), fall through to the public scrape below.
  const auth = await resolveDriveAuth();
  if (auth) {
    try {
      const out = await listDriveFolderVideosApi(folderId, auth);
      // The recurser already stops at MAX_FOLDER_VIDEOS; slice is a defensive
      // guarantee at the public boundary (BUG-032b) — one folder can never return
      // more than the cap, so its paid-transcription fan-out stays bounded.
      if (out.length > 0) return capVideos(out, folderId);
    } catch (e) {
      console.warn(`[drive] folder list error — trying public scrape: ${e instanceof Error ? e.message : e}`);
    }
  }
  // 2) PUBLIC SCRAPE — works for any "anyone with the link" folder, no auth.
  return capVideos(await scrapePublicDriveFolder(folderId), folderId);
}

/** Enforce MAX_FOLDER_VIDEOS at the folder-expansion boundary, logging a truncation
 *  so an oversized folder is visible rather than silently (or expensively) huge. */
function capVideos(videos: DriveFolderVideo[], folderId: string): DriveFolderVideo[] {
  if (videos.length <= MAX_FOLDER_VIDEOS) return videos;
  console.warn(`[drive] folder ${folderId} has ${videos.length} videos — capping to ${MAX_FOLDER_VIDEOS} (BUG-032b fan-out guard; raise CLIP_MAX_FOLDER_VIDEOS if intentional)`);
  return videos.slice(0, MAX_FOLDER_VIDEOS);
}

const API_MAX_DEPTH = 5; // top folder + up to 5 nested levels
const API_MAX_FOLDERS = 300; // total files.list calls per resolve (runaway guard)
/**
 * Hard cap on the number of videos a SINGLE folder link expands to (BUG-032b).
 * Without it, one Drive folder — recursed over up to API_MAX_FOLDERS sub-folders ×
 * pageSize 1000 — could fan out to thousands of member videos, each of which the
 * campaign pre-transcribe then sends to the paid STT route. The realistic campaign
 * footage folder holds well under this; a folder past it is truncated (with a warn)
 * so a rogue/huge folder can't run up an unbounded paid-transcription bill. Shared
 * by BOTH the Drive-API and the public-scrape enumerators. Env-tunable for the rare
 * legitimately-large library. Applied as the caller expands each source; the
 * campaign layer applies a further TOTAL cap across all sources.
 */
const MAX_FOLDER_VIDEOS = Number(globalThis.process?.env?.CLIP_MAX_FOLDER_VIDEOS) || 200;

/** Recursively enumerate videos in a folder subtree via the Drive API. Drive's
 *  `'<id>' in parents` matches only DIRECT children and has no recursive operator,
 *  so each sub-folder must be listed by its own id. The query returns videos AND
 *  folders (a folder's `application/vnd.google-apps.folder` mimeType does NOT match
 *  `mimeType contains 'video'`, so folders MUST be requested explicitly or they'd be
 *  invisible); folders are recursed into. Depth + total-folder + cycle guards mirror
 *  the public scraper so a deep or self-referential tree can't run away. */
async function listDriveFolderVideosApi(rootId: string, auth: DriveAuth): Promise<DriveFolderVideo[]> {
  const out: DriveFolderVideo[] = [];
  const seenFiles = new Set<string>();
  const visited = new Set<string>();
  const budget = { folders: 0 };
  await listFolderApiInto(rootId, 0, auth, out, seenFiles, visited, budget);
  return out;
}

async function listFolderApiInto(
  folderId: string,
  depth: number,
  auth: DriveAuth,
  out: DriveFolderVideo[],
  seenFiles: Set<string>,
  visited: Set<string>,
  budget: { folders: number },
): Promise<void> {
  if (depth > API_MAX_DEPTH) return;
  if (budget.folders >= API_MAX_FOLDERS) return;
  if (out.length >= MAX_FOLDER_VIDEOS) return; // video cap reached — stop enumerating (BUG-032b)
  if (visited.has(folderId)) return; // shortcut/diamond guard — don't re-list a subtree
  visited.add(folderId);
  budget.folders++;

  const subfolders: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and (mimeType contains 'video' or mimeType = 'application/vnd.google-apps.folder')`,
      fields: "nextPageToken,files(id,name,mimeType)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      orderBy: "folder,name",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const r = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, auth);
    if (!r.ok) {
      // A ROOT-level failure bubbles so the caller falls back to the public scrape;
      // a sub-folder failure is logged and skipped so one bad folder can't drop the rest.
      if (depth === 0) throw new Error(`folder list HTTP ${r.status}`);
      console.warn(`[drive] sub-folder list HTTP ${r.status} — skipping ${folderId}`);
      return;
    }
    const j = (await r.json()) as { nextPageToken?: string; files?: { id?: string; name?: string; mimeType?: string }[] };
    for (const f of j.files ?? []) {
      if (!f.id) continue;
      if (f.mimeType === "application/vnd.google-apps.folder") {
        if (!visited.has(f.id)) subfolders.push(f.id);
      } else if (!seenFiles.has(f.id)) {
        // The query already restricts non-folders to videos.
        seenFiles.add(f.id);
        out.push({ fileId: f.id, name: f.name ?? f.id });
        if (out.length >= MAX_FOLDER_VIDEOS) return; // hit the fan-out cap — stop (BUG-032b)
      }
    }
    pageToken = j.nextPageToken;
  } while (pageToken);

  for (const sub of subfolders) {
    if (budget.folders >= API_MAX_FOLDERS) break;
    if (out.length >= MAX_FOLDER_VIDEOS) break; // fan-out cap reached — don't recurse further
    await listFolderApiInto(sub, depth + 1, auth, out, seenFiles, visited, budget);
  }
}

const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi|m4v|m3u8|flv|wmv)$/i;
const SCRAPE_MAX_DEPTH = 3; // top folder + up to 3 nested levels
const SCRAPE_MAX_FOLDERS = 40; // total embeddedfolderview fetches per resolve (runaway guard)

/** Scrape Google Drive's public embedded-folder view (no auth) for a link-shared
 *  folder the Drive API can't enumerate. Brittle (parses Google HTML) — returns []
 *  on any failure. RECURSES into subfolders (many campaign folders nest videos one
 *  or two levels deep). Keeps likely-video files (by extension); extension-less names
 *  are kept too (the downloader/transcribe step skips non-video sources gracefully). */
async function scrapePublicDriveFolder(folderId: string): Promise<DriveFolderVideo[]> {
  const out: DriveFolderVideo[] = [];
  const seen = new Set<string>();
  const visited = new Set<string>();
  const budget = { folders: 0 };
  await scrapeFolderInto(folderId, 0, out, seen, visited, budget);
  return out;
}

async function scrapeFolderInto(
  folderId: string,
  depth: number,
  out: DriveFolderVideo[],
  seen: Set<string>,
  visited: Set<string>,
  budget: { folders: number },
): Promise<void> {
  if (depth > SCRAPE_MAX_DEPTH) return;
  if (budget.folders >= SCRAPE_MAX_FOLDERS) return;
  if (out.length >= MAX_FOLDER_VIDEOS) return; // video cap reached — stop scraping (BUG-032b)
  // Skip already-scraped folders — shortcuts/diamonds otherwise re-scrape the
  // same subtree, burning the fetch budget and silently truncating the list.
  if (visited.has(folderId)) return;
  visited.add(folderId);
  budget.folders++;
  let html: string;
  try {
    const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VelloClipper/1.0)" },
    });
    if (!r.ok) return;
    html = await r.text();
  } catch {
    return;
  }
  // Each entry chunk: `id="entry-<id>" ... href=".../file/d/<id>/" | ".../drive/folders/<id>" ... flip-entry-title">NAME<`
  const subfolders: string[] = [];
  const chunks = html.split('class="flip-entry"').slice(1);
  for (const chunk of chunks) {
    const idM = chunk.match(/id="entry-([A-Za-z0-9_-]{20,})"/);
    if (!idM) continue;
    const id = idM[1];
    const nameM = chunk.match(/flip-entry-title">([^<]*)</);
    const name = (nameM?.[1] ?? id).trim();
    const isFolder = /drive\/folders\/[A-Za-z0-9_-]{20,}/.test(chunk);
    if (isFolder) {
      subfolders.push(id);
    } else if (!seen.has(id) && (VIDEO_EXT.test(name) || !/\.[A-Za-z0-9]{2,4}$/.test(name))) {
      seen.add(id);
      out.push({ fileId: id, name });
      if (out.length >= MAX_FOLDER_VIDEOS) return; // hit the fan-out cap — stop (BUG-032b)
    }
  }
  for (const sub of subfolders) {
    if (budget.folders >= SCRAPE_MAX_FOLDERS) break;
    if (out.length >= MAX_FOLDER_VIDEOS) break; // fan-out cap reached — don't recurse further
    if (visited.has(sub)) continue;
    await scrapeFolderInto(sub, depth + 1, out, seen, visited, budget);
  }
}

export function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const sa = JSON.parse(json) as { client_email?: string; private_key?: string };
    if (!sa.client_email || !sa.private_key) return null;
    return { client_email: sa.client_email, private_key: String(sa.private_key).replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

/** A plain Drive API key (GOOGLE_DRIVE_API_KEY) — for PUBLIC files/folders when
 *  a service account is unavailable (e.g. org policy blocks SA key creation). */
export function loadDriveApiKey(): string | null {
  return process.env.GOOGLE_DRIVE_API_KEY?.trim() || null;
}

/** Resolve Drive auth: service account (Bearer) preferred, else an API key
 *  (?key=) for public content, else null (caller uses the public uc? fallback
 *  for single files; folders need one of these). */
type DriveAuth = { token: string } | { apiKey: string };
async function resolveDriveAuth(): Promise<DriveAuth | null> {
  const sa = loadServiceAccount();
  if (sa) return { token: await getDriveAccessToken(sa) };
  const apiKey = loadDriveApiKey();
  if (apiKey) return { apiKey };
  return null;
}

/** Fetch a Drive API URL with whichever auth we have (Bearer header or &key=).
 *  `init` is additive (existing callers pass none → unchanged): when present its
 *  headers are MERGED with the Bearer header so a `Range` header can ride along. */
function driveFetch(baseUrl: string, auth: DriveAuth, init?: RequestInit): Promise<Response> {
  if ("token" in auth) {
    return fetch(baseUrl, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${auth.token}` },
    });
  }
  const sep = baseUrl.includes("?") ? "&" : "?";
  return fetch(`${baseUrl}${sep}key=${encodeURIComponent(auth.apiKey)}`, init);
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Build the signed RS256 JWT a service account exchanges for an access token. */
export async function buildServiceAccountJwt(sa: ServiceAccount, nowSec?: number): Promise<string> {
  const { createSign } = await import("node:crypto");
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${b64url(signer.sign(sa.private_key))}`;
}

/** Mint a Drive-readonly access token from a service-account JWT (RS256). */
export async function getDriveAccessToken(sa: ServiceAccount): Promise<string> {
  if (driveTokenCache?.email === sa.client_email && driveTokenCache.expiresAt > Date.now()) return driveTokenCache.token;
  if (driveTokenPending?.email === sa.client_email) return driveTokenPending.promise;
  const promise = (async () => {
    const jwt = await buildServiceAccountJwt(sa);
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
      signal: AbortSignal.timeout(8_000),
    });
    const j = (await r.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!j.access_token) throw new Error(`Drive SA auth failed: ${j.error_description ?? JSON.stringify(j).slice(0, 160)}`);
    driveTokenCache = { email: sa.client_email, token: j.access_token, expiresAt: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 120) * 1000 };
    return j.access_token;
  })();
  driveTokenPending = { email: sa.client_email, promise };
  try { return await promise; } finally { if (driveTokenPending?.promise === promise) driveTokenPending = undefined; }
}

let driveTokenCache: { email: string; token: string; expiresAt: number } | undefined;
let driveTokenPending: { email: string; promise: Promise<string> } | undefined;

/** Google's per-file 24h download-quota / anti-abuse block responds 403 with an HTML
 *  "Sorry, you can't view or download this file at this time" page (NOT a real API
 *  error). Detect it so callers show an actionable message and DON'T retry — retrying
 *  just re-trips the quota. */
function isDriveQuotaPage(status: number, body: string): boolean {
  return (status === 403 || status === 200) &&
    /Sorry,? you can(?:not|'t) view or download this file at this time|download quota|cannotDownload|quotaExceeded|too many users/i.test(body);
}

/** Error for a non-OK Drive API response: a friendly, actionable message for the quota
 *  block (prefixed `DRIVE_QUOTA:` so callers can classify it), else the raw
 *  `Drive API <label> HTTP <status>: <body>` (unchanged for access/other errors). */
function driveApiError(label: string, status: number, body: string): Error {
  if (isDriveQuotaPage(status, body)) {
    return new Error(
      "DRIVE_QUOTA: Google Drive temporarily blocked this file's download — its ~24h " +
      "download limit was hit (usually from pulling the same file many times). Fix: make a " +
      "COPY of the file in your own Drive and use that link, upload the video directly, or wait ~24h.",
    );
  }
  return new Error(`Drive API ${label} HTTP ${status}: ${body.slice(0, 200)}`);
}

/** True for a Drive error where re-fetching won't help — the quota block, or any Drive
 *  API 4xx (auth/quota/not-found). Callers use this to skip a redundant disk re-download
 *  or an amplifying retry (both just re-hit Drive and worsen the quota). */
export function isDriveAccessBlock(msg: string): boolean {
  return /DRIVE_QUOTA|Drive API [\w ]*HTTP 4\d\d/i.test(msg);
}

/**
 * Cheap, metadata-only read of a Drive file's CURRENT modifiedTime — no bytes
 * downloaded. Lets a caller (the transcribe-clip cache lookup, H08/BUG-031)
 * detect a "Manage versions -> Upload new version" replace-in-place (same
 * fileId/link, new content) up front, before deciding a cache hit/miss.
 *
 * Best-effort by design: returns `undefined` (never throws) for a non-Drive
 * URL, when no Drive auth is configured (the public download flow has no cheap
 * metadata endpoint either — same limitation downloadFromDrive already has), or
 * on any fetch/parse failure. Callers treat undefined as "no signal" and must
 * NOT infer staleness from its absence (see sourceContentChanged).
 */
export async function getDriveModifiedTime(url: string): Promise<string | undefined> {
  const fileId = driveFileId(url);
  if (!fileId) return undefined;
  try {
    const auth = await resolveDriveAuth();
    if (!auth) return undefined;
    const r = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime&supportsAllDrives=true`,
      auth,
    );
    if (!r.ok) return undefined;
    return ((await r.json()) as { modifiedTime?: string }).modifiedTime;
  } catch {
    return undefined;
  }
}

export interface DriveFile { buffer: Buffer; mime: string; modifiedTime?: string }

export async function downloadFromDrive(url: string): Promise<DriveFile> {
  const fileId = driveFileId(url);
  if (!fileId) throw new Error("Not a Google Drive URL");
  const auth = await resolveDriveAuth();
  if (auth) {
    // Read modifiedTime first so the cache can invalidate when the file changes.
    let modifiedTime: string | undefined;
    try {
      const meta = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime&supportsAllDrives=true`,
        auth,
      );
      if (meta.ok) modifiedTime = ((await meta.json()) as { modifiedTime?: string }).modifiedTime;
    } catch { /* metadata is best-effort */ }

    const r = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      auth,
    );
    if (!r.ok) throw driveApiError("download", r.status, await r.text());
    return { buffer: await readCapped(r), mime: r.headers.get("content-type") ?? "video/mp4", modifiedTime };
  }
  return downloadPublic(fileId);
}

/** Hard cap (matches the downloader 500MB ceiling) so a giant/lying Drive file
 *  can't OOM the shared process — the only ingestion path that lacked one. */
const MAX_DRIVE_BYTES = 500 * 1024 * 1024;

/** Read a fetch Response to a Buffer, aborting past MAX_DRIVE_BYTES (declared
 *  Content-Length AND a streaming counter). */
async function readCapped(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DRIVE_BYTES) {
    throw new Error(`Drive file too large (${declared} bytes > ${MAX_DRIVE_BYTES} cap).`);
  }
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_DRIVE_BYTES) throw new Error(`Drive file exceeded ${MAX_DRIVE_BYTES}-byte cap.`);
    return buf;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DRIVE_BYTES) throw new Error(`Drive file exceeded ${MAX_DRIVE_BYTES}-byte cap during download.`);
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Wall-clock + idle-stall self-bound for a Drive transfer — the Drive path was the
 * only downloader lacking one (direct fetch + yt-dlp already abort on a wall clock),
 * so a stalled socket could loop reader.read() forever, holding the fd/socket. The
 * wall caps the whole transfer; the idle watchdog (reset via bump() on each chunk)
 * trips only when the socket delivers NOTHING for DRIVE_TRANSFER_IDLE_MS, so a
 * slow-but-progressing multi-GB pull finishes while a wedged socket is aborted.
 * Both bounds are env-tunable; the wall default matches CLIP_AUDIO_EXTRACT_WALL_MS
 * so legitimately-slow big-source pulls aren't cut short.
 */
const DRIVE_TRANSFER_WALL_MS = Number(globalThis.process?.env?.CLIP_DRIVE_TRANSFER_WALL_MS) || 25 * 60_000;
const DRIVE_TRANSFER_IDLE_MS = Number(globalThis.process?.env?.CLIP_DRIVE_IDLE_MS) || 90_000;

interface DriveTransferGuard { signal: AbortSignal; bump: () => void; abort: () => void; clear: () => void; }
function newDriveTransferGuard(): DriveTransferGuard {
  const ctrl = new AbortController();
  const idleErr = () => new Error(`Drive transfer stalled (no data for ${DRIVE_TRANSFER_IDLE_MS}ms) — aborted`);
  const wall = setTimeout(() => ctrl.abort(new Error(`Drive transfer exceeded ${DRIVE_TRANSFER_WALL_MS}ms wall clock — aborted`)), DRIVE_TRANSFER_WALL_MS);
  let idle = setTimeout(() => ctrl.abort(idleErr()), DRIVE_TRANSFER_IDLE_MS);
  const bump = () => { clearTimeout(idle); idle = setTimeout(() => ctrl.abort(idleErr()), DRIVE_TRANSFER_IDLE_MS); };
  return {
    signal: ctrl.signal,
    bump,
    abort: () => ctrl.abort(),
    clear: () => { clearTimeout(wall); clearTimeout(idle); },
  };
}

/**
 * Stream a Drive download to a temp FILE on disk (never buffers the whole file in
 * RAM), enforcing `cap` on both the declared Content-Length and a live counter.
 * This is the multi-GB-safe path used by the clip download route — peak heap is
 * one chunk, so a ~2GB Drive video can't OOM the shared process. Mirrors
 * downloadFromDrive's auth → public-fallback logic. Returns the resolved mime.
 */
export async function downloadFromDriveToFile(
  url: string,
  destPath: string,
  cap: number,
  opts?: {
    range?: { byteStart: number; byteEnd: number };
    onProgress?: (progress: { downloadedBytes: number; totalBytes: number; speed?: string }) => void;
  },
): Promise<{ mime: string; modifiedTime?: string; ranged?: boolean }> {
  const fileId = driveFileId(url);
  if (!fileId) throw new Error("Not a Google Drive URL");

  // RANGED path (additive): attempt a byte-window fetch. When the server does
  // NOT honor Range (status 200, not 206), fall through to the full download
  // below — so the caller always gets a complete usable artifact at destPath.
  if (opts?.range) {
    try {
      const ranged = await downloadDriveByteRange(url, destPath, opts.range, cap, opts.onProgress);
      if (ranged.ranged) return { mime: ranged.mime, ranged: true };
      // Range not honored — the partial (if any) was a 200 full body; but to be
      // safe we re-run the canonical full path below (which truncates destPath).
      console.warn(`[drive] Range not honored (HTTP ${ranged.status}) — falling back to full download for ${fileId}`);
    } catch (e) {
      console.warn(`[drive] ranged fetch failed (${e instanceof Error ? e.message : e}) — falling back to full download for ${fileId}`);
    }
  }

  const auth = await resolveDriveAuth();
  if (auth) {
    let modifiedTime: string | undefined;
    try {
      const meta = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime&supportsAllDrives=true`,
        auth,
      );
      if (meta.ok) modifiedTime = ((await meta.json()) as { modifiedTime?: string }).modifiedTime;
    } catch { /* metadata is best-effort */ }

    const guard = newDriveTransferGuard();
    let apiError: Error | null = null;
    try {
      const r = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
        auth,
        { signal: guard.signal },
      );
      if (r.ok) {
        await streamCappedToFile(r, destPath, cap, guard, opts?.onProgress);
        return { mime: r.headers.get("content-type") ?? "video/mp4", modifiedTime, ranged: false };
      }
      const err = driveApiError("download", r.status, await r.text());
      // 401/403/404 = these credentials can't see the file. A file shared
      // "anyone with the link" is still downloadable publicly, so try that
      // before failing (quota blocks and other errors are real — rethrow).
      if (![401, 403, 404].includes(r.status) || err.message.startsWith("DRIVE_QUOTA")) throw err;
      apiError = err;
    } finally {
      guard.clear();
    }
    const pubGuard = newDriveTransferGuard();
    try {
      const res = await resolvePublicDriveResponse(fileId, { signal: pubGuard.signal });
      await streamCappedToFile(res.res, destPath, cap, pubGuard, opts?.onProgress);
      return { mime: res.mime, modifiedTime, ranged: false };
    } catch {
      throw apiError;
    } finally {
      pubGuard.clear();
    }
  }
  const guard = newDriveTransferGuard();
  try {
    const res = await resolvePublicDriveResponse(fileId, { signal: guard.signal });
    await streamCappedToFile(res.res, destPath, cap, guard, opts?.onProgress);
    return { mime: res.mime, ranged: false };
  } finally {
    guard.clear();
  }
}

/**
 * Open the Drive file as a raw byte STREAM (never touches disk) so the caller can
 * pipe it straight through ffmpeg for an audio-only extract — the whole video is
 * never stored, so source size is bounded only by transfer time, not the disk cap.
 * Mirrors downloadFromDrive's auth → public-fallback resolution. The caller MUST
 * consume or cancel `body`. Throws on a non-OK response or a missing body.
 */
export async function openDriveStream(url: string): Promise<{ body: ReadableStream<Uint8Array>; mime: string }> {
  const fileId = driveFileId(url);
  if (!fileId) throw new Error("Not a Google Drive URL");
  const auth = await resolveDriveAuth();
  // Wall-clock only: the body is consumed by the CALLER (the audio-extract pump),
  // so there's no read loop here to reset an idle watchdog. The wall lets a stalled
  // Drive socket be torn down (abort → the caller's reader.read() rejects → the
  // socket/fd is freed) instead of pinning the pump forever. unref + a no-op abort
  // on an already-finished fetch keep a fast stream from holding the event loop.
  const ctrl = new AbortController();
  const wall = setTimeout(() => ctrl.abort(new Error(`Drive stream exceeded ${DRIVE_TRANSFER_WALL_MS}ms wall clock — aborted`)), DRIVE_TRANSFER_WALL_MS);
  (wall as unknown as { unref?: () => void }).unref?.();
  if (auth) {
    const r = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      auth,
      { signal: ctrl.signal },
    );
    if (!r.ok) throw driveApiError("stream", r.status, await r.text());
    if (!r.body) throw new Error("Drive API stream: empty body");
    return { body: r.body as ReadableStream<Uint8Array>, mime: r.headers.get("content-type") ?? "video/mp4" };
  }
  const { res, mime } = await resolvePublicDriveResponse(fileId, { signal: ctrl.signal });
  if (!res.body) throw new Error("Drive public stream: empty body");
  return { body: res.body as ReadableStream<Uint8Array>, mime };
}

/**
 * Probe whether a Drive file supports HTTP Range, and (if so) fetch a byte
 * window to `destPath`. Officially supported on the SA/API-key `alt=media` path
 * (Google docs: `Range: bytes=…` → 206); best-effort (probe + report) on the
 * public `uc?export=download` path. Returns `{ ranged:false }` when the server
 * returned a full 200 (Range ignored) — the caller then does a full download.
 * Caps + streams to disk via the same `streamCappedToFile` as the full path.
 */
export async function downloadDriveByteRange(
  url: string,
  destPath: string,
  range: { byteStart: number; byteEnd: number },
  cap: number,
  onProgress?: (progress: { downloadedBytes: number; totalBytes: number; speed?: string }) => void,
): Promise<{ mime: string; ranged: boolean; totalBytes?: number; status: number }> {
  const fileId = driveFileId(url);
  if (!fileId) throw new Error("Not a Google Drive URL");
  const start = Math.max(0, Math.floor(range.byteStart));
  const end = Math.max(start, Math.floor(range.byteEnd));
  const rangeHeader = `bytes=${start}-${end}`;
  const auth = await resolveDriveAuth();

  if (auth) {
    const guard = newDriveTransferGuard();
    try {
      const r = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
        auth,
        { headers: { Range: rangeHeader }, signal: guard.signal },
      );
      if (!r.ok && r.status !== 206) {
        throw driveApiError("ranged download", r.status, await r.text());
      }
      const mime = r.headers.get("content-type") ?? "video/mp4";
      const totalBytes = parseContentRangeTotal(r.headers.get("content-range"));
      if (r.status !== 206) {
        // Server ignored Range and returned the FULL file — let the caller fall
        // back (drain/cancel the body so the socket isn't left half-read).
        await r.body?.cancel().catch(() => {});
        return { mime, ranged: false, totalBytes, status: r.status };
      }
      await streamCappedToFile(r, destPath, cap, guard, onProgress);
      return { mime, ranged: true, totalBytes, status: r.status };
    } finally {
      guard.clear();
    }
  }

  // Public endpoint — Range is UNDOCUMENTED; probe the returned status.
  const guard = newDriveTransferGuard();
  try {
    const { res, mime } = await resolvePublicDriveResponse(fileId, { headers: { Range: rangeHeader }, signal: guard.signal });
    const totalBytes = parseContentRangeTotal(res.headers.get("content-range"));
    if (res.status !== 206) {
      await res.body?.cancel().catch(() => {});
      return { mime, ranged: false, totalBytes, status: res.status };
    }
    await streamCappedToFile(res, destPath, cap, guard, onProgress);
    return { mime, ranged: true, totalBytes, status: res.status };
  } finally {
    guard.clear();
  }
}

/** Parse the total size out of a `Content-Range: bytes <s>-<e>/<total>` header. */
function parseContentRangeTotal(h: string | null): number | undefined {
  const m = h?.match(/\/(\d+)\s*$/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Total byte size of a Drive file. SA/API-key path: Drive metadata
 * (`files/<id>?fields=size`). Public path: a `Range: bytes=0-0` GET reading the
 * `Content-Range` total (HEAD is unreliable through Drive's confirm redirect).
 * Returns null when size can't be determined (caller then skips the byte-window
 * plan and does a full download).
 */
export async function getDriveFileSize(url: string): Promise<number | null> {
  const fileId = driveFileId(url);
  if (!fileId) return null;
  const auth = await resolveDriveAuth().catch(() => null);
  if (auth) {
    try {
      const r = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=size&supportsAllDrives=true`,
        auth,
      );
      if (r.ok) {
        const j = (await r.json()) as { size?: string };
        const n = Number(j.size);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch { /* fall through — the file may still be public */ }
  }
  try {
    const { res } = await resolvePublicDriveResponse(fileId, { headers: { Range: "bytes=0-0" } });
    const total = parseContentRangeTotal(res.headers.get("content-range"));
    await res.body?.cancel().catch(() => {});
    if (total && Number.isFinite(total)) return total;
    const declared = Number(res.headers.get("content-length"));
    return Number.isFinite(declared) && declared > 0 ? declared : null;
  } catch {
    return null;
  }
}

/** Stream a fetch Response body to a file, aborting (and unlinking the partial)
 *  past `cap` (declared Content-Length AND a streaming counter). Respects
 *  backpressure so a fast source can't outrun disk and grow heap. When a `guard`
 *  is passed, each received chunk bumps its idle watchdog (so a slow-but-moving
 *  pull isn't cut) and a cap-exceed aborts the fetch so the socket is torn down
 *  rather than left half-read. */
async function streamCappedToFile(
  res: Response,
  destPath: string,
  cap: number,
  guard?: DriveTransferGuard,
  onProgress?: (progress: { downloadedBytes: number; totalBytes: number; speed?: string }) => void,
): Promise<void> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) {
    guard?.abort();
    throw new Error(`Drive file too large (${declared} bytes > ${cap} cap).`);
  }
  const { createWriteStream } = await import("node:fs");
  const { unlink } = await import("node:fs/promises");
  const ws = createWriteStream(destPath);
  const startedAt = Date.now();
  let lastProgressAt = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (!res.body) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > cap) throw new Error(`Drive file exceeded ${cap}-byte cap.`);
      await new Promise<void>((resolve, reject) => ws.write(buf, (e) => (e ? reject(e) : resolve())));
    } else {
      let total = 0;
      reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        guard?.bump();
        total += value.byteLength;
        if (total > cap) { guard?.abort(); throw new Error(`Drive file exceeded ${cap}-byte cap during download.`); }
        const now = Date.now();
        if (onProgress && (now - lastProgressAt >= 750 || (Number.isFinite(declared) && total >= declared))) {
          lastProgressAt = now;
          const bytesPerSecond = total / Math.max(0.25, (now - startedAt) / 1000);
          onProgress({
            downloadedBytes: total,
            totalBytes: Number.isFinite(declared) && declared > 0 ? declared : 0,
            speed: bytesPerSecond > 0 ? `${(bytesPerSecond / 1024 / 1024).toFixed(1)}MiB/s` : undefined,
          });
        }
        // Backpressure pause — bump after the drain so a slow disk doesn't read as
        // an idle network stall.
        if (!ws.write(value)) { await new Promise<void>((r) => ws.once("drain", r)); guard?.bump(); }
      }
    }
    await new Promise<void>((resolve, reject) => ws.end((e?: Error | null) => (e ? reject(e) : resolve())));
  } catch (e) {
    ws.destroy();
    await reader?.cancel().catch(() => {});
    await unlink(destPath).catch(() => {});
    throw e;
  }
}

/** Resolve the public ("anyone with the link") Drive download Response (handles
 *  the large-file confirm page), shared by the Buffer and file-streaming paths.
 *  `init.headers` is additive (existing callers pass none → unchanged): when
 *  present (e.g. a `Range` header) it is forwarded to every inner fetch hop so a
 *  ranged request reaches the final download URL. The caller inspects res.status
 *  (206 vs 200) / res.headers.get("accept-ranges") to learn if Range was honored. */
async function resolvePublicDriveResponse(
  fileId: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
): Promise<{ res: Response; mime: string }> {
  const fetchInit: RequestInit = {
    redirect: "follow",
    ...(init?.headers ? { headers: init.headers } : {}),
    ...(init?.signal ? { signal: init.signal } : {}),
  };
  let res = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, fetchInit);
  let mime = res.headers.get("content-type") ?? "";
  let errorPage = "";
  if (/text\/html/i.test(mime)) {
    const html = await res.text();
    errorPage = html;
    const action = html.match(/action="([^"]+)"/)?.[1];
    const fields = [...html.matchAll(/name="([^"]+)"\s+value="([^"]*)"/g)];
    if (action && fields.length) {
      const u = new URL(action.replace(/&amp;/g, "&"));
      for (const [, k, val] of fields) u.searchParams.set(k, val);
      res = await fetch(u.toString(), fetchInit);
    } else {
      const token = html.match(/confirm=([0-9A-Za-z_-]+)/)?.[1];
      if (token) res = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}&confirm=${token}`, fetchInit);
    }
    mime = res.headers.get("content-type") ?? "";
  }
  // Google's current direct-download host. The legacy uc? flow above sometimes
  // lands on an interstitial whose form we can't parse (or a non-OK hop) for a
  // file that IS shared "anyone with the link" — confirm=t skips the virus-scan
  // page outright, so try it before declaring the file private.
  if (!res.ok || /text\/html/i.test(mime)) {
    try {
      const direct = await fetch(`https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`, fetchInit);
      const directMime = direct.headers.get("content-type") ?? "";
      if (direct.ok && !/text\/html/i.test(directMime)) return { res: direct, mime: directMime || "video/mp4" };
      if (/text\/html/i.test(directMime)) {
        const directPage = (await direct.text()).slice(0, 2000);
        if (!isDriveQuotaPage(200, errorPage)) errorPage = directPage;
      }
      await direct.body?.cancel().catch(() => {});
    } catch (e) {
      if (init?.signal?.aborted) throw e;
    }
  }
  if (isDriveQuotaPage(res.status, errorPage)) throw driveApiError("public download", 403, errorPage);
  if (!res.ok) {
    throw new Error(`Drive public download HTTP ${res.status} — share the file 'anyone with the link', or set GOOGLE_SERVICE_ACCOUNT_JSON for private access.`);
  }
  if (/text\/html/i.test(mime)) {
    throw new Error("Drive returned an HTML page, not the video — the file is private. Share it 'anyone with the link' or use a service account.");
  }
  return { res, mime: mime || "video/mp4" };
}

/** Public "anyone with the link" download (Buffer path) — handles the large-file
 *  confirm page. RAM-buffered (500MB cap) for small transcription-audio pulls;
 *  the multi-GB video path uses downloadFromDriveToFile instead. */
async function downloadPublic(fileId: string): Promise<DriveFile> {
  const { res, mime } = await resolvePublicDriveResponse(fileId);
  return { buffer: await readCapped(res), mime };
}
