// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isDriveUrl,
  loadServiceAccount,
  buildServiceAccountJwt,
  downloadDriveByteRange,
  downloadFromDriveToFile,
  getDriveFileSize,
  getDriveModifiedTime,
  listDriveFolderVideos,
  isDriveAccessBlock,
  getDriveVideoMetadata,
  fetchDriveVideoThumbnail,
  getDriveAccessToken,
} from "./driveDownload";

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

const DRIVE_URL = "https://drive.google.com/file/d/1AbCdEf12345/view";

afterEach(() => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_DRIVE_API_KEY;
  vi.restoreAllMocks();
});

describe("driveDownload", () => {
  it("coalesces concurrent service-account token requests for folder thumbnails", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const sa = { client_email: "thumbnail-test@p.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
    const mockedFetch = vi.fn(async () => new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 })));
    vi.stubGlobal("fetch", mockedFetch);
    expect(await Promise.all([getDriveAccessToken(sa), getDriveAccessToken(sa)])).toEqual(["token-1", "token-1"]);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("reads name, duration, size and thumbnail with one cheap metadata request", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    const mockedFetch = vi.fn(async (_url: string) => new Response(JSON.stringify({
      name: "Talk.mp4", mimeType: "video/mp4", size: "1200000",
      thumbnailLink: "https://lh3.googleusercontent.com/thumb", videoMediaMetadata: { durationMillis: "12500" },
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", mockedFetch);
    expect(await getDriveVideoMetadata(DRIVE_URL)).toEqual({
      name: "Talk.mp4", sizeBytes: 1200000, durationSeconds: 12.5,
      thumbnailLink: "https://lh3.googleusercontent.com/thumb",
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(String(mockedFetch.mock.calls[0][0])).toContain("fields=name,mimeType,size,thumbnailLink");
  });

  it("serves an API thumbnail and rejects non-image responses", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    const mockedFetch = vi.fn(async (url: string) => url.includes("/drive/v3/files/")
      ? new Response(JSON.stringify({ mimeType: "video/mp4", thumbnailLink: "https://lh3.googleusercontent.com/thumb" }))
      : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", mockedFetch);
    const thumb = await fetchDriveVideoThumbnail(DRIVE_URL);
    expect(thumb?.contentType).toBe("image/jpeg");
    expect(new Uint8Array(thumb!.bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("detects Drive URLs", () => {
    expect(isDriveUrl("https://drive.google.com/file/d/1AbCdEf12345/view")).toBe(true);
    expect(isDriveUrl("https://drive.google.com/open?id=1AbCdEf12345")).toBe(true);
    expect(isDriveUrl("https://youtube.com/watch?v=abc")).toBe(false);
    expect(isDriveUrl("https://example.com/v.mp4")).toBe(false);
  });

  it("loads a service account from raw JSON, base64, and unescapes private_key newlines", () => {
    const sa = { client_email: "svc@p.iam.gserviceaccount.com", private_key: "-----BEGIN-----\\nKEY\\n-----END-----" };
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(sa);
    const a = loadServiceAccount();
    expect(a?.client_email).toBe(sa.client_email);
    expect(a?.private_key).toContain("\n"); // real newline, not literal \n
    expect(a?.private_key).not.toContain("\\n");

    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify(sa)).toString("base64");
    expect(loadServiceAccount()?.client_email).toBe(sa.client_email);

    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "not json";
    expect(loadServiceAccount()).toBeNull();
  });

  it("signs a verifiable RS256 JWT with the correct claims", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const sa = { client_email: "svc@p.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
    const jwt = await buildServiceAccountJwt(sa, 1_000_000);
    const [h, c, sig] = jwt.split(".");

    // signature verifies against the public key
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${c}`); v.end();
    expect(v.verify(publicKey, fromB64url(sig))).toBe(true);

    // claims are correct
    const claims = JSON.parse(fromB64url(c).toString());
    expect(claims.iss).toBe(sa.client_email);
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.scope).toContain("drive.readonly");
    expect(claims.exp - claims.iat).toBe(3600);
  });
});

describe("Drive HTTP Range", () => {
  it("downloadDriveByteRange: 206 → ranged:true, writes only the byte window, sends Range header (API-key path)", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    const payload = Buffer.from("PARTIAL_WINDOW_BYTES");
    const seen: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response(payload, {
        status: 206,
        headers: { "content-type": "video/mp4", "content-range": `bytes 0-19/123456` },
      });
    }));

    const dir = await mkdtemp(join(tmpdir(), "vello-range-"));
    try {
      const dest = join(dir, "part");
      const r = await downloadDriveByteRange(DRIVE_URL, dest, { byteStart: 0, byteEnd: 19 }, 10 * 1024 * 1024);
      expect(r.ranged).toBe(true);
      expect(r.status).toBe(206);
      expect(r.totalBytes).toBe(123456);
      expect(await readFile(dest)).toEqual(payload);
      // Range header was actually sent on the alt=media request.
      const headers = new Headers(seen[0].init?.headers as HeadersInit);
      expect(headers.get("range")).toBe("bytes=0-19");
      expect(seen[0].url).toContain("alt=media");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("downloadDriveByteRange: 200 (Range ignored) → ranged:false, does NOT write the file", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(Buffer.from("FULL_BODY"), {
      status: 200,
      headers: { "content-type": "video/mp4" },
    })));

    const dir = await mkdtemp(join(tmpdir(), "vello-range-"));
    try {
      const dest = join(dir, "part");
      const r = await downloadDriveByteRange(DRIVE_URL, dest, { byteStart: 0, byteEnd: 19 }, 10 * 1024 * 1024);
      expect(r.ranged).toBe(false);
      expect(r.status).toBe(200);
      // ranged:false means the caller falls back; we must NOT have written a partial.
      await expect(readFile(dest)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("getDriveFileSize: reads size from Drive metadata (API-key path)", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toContain("fields=size");
      return new Response(JSON.stringify({ size: "987654321" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));
    expect(await getDriveFileSize(DRIVE_URL)).toBe(987654321);
  });

  it("getDriveFileSize: returns null when metadata is unavailable", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect(await getDriveFileSize(DRIVE_URL)).toBeNull();
  });
});

// H08/BUG-031: the transcribe-clip route needs a CHEAP, metadata-only read of a
// Drive file's current modifiedTime (no bytes) so it can detect a "Manage
// versions -> Upload new version" replace-in-place BEFORE deciding cache hit/miss.
describe("getDriveModifiedTime", () => {
  it("returns the current modifiedTime via a fields=modifiedTime metadata call (API-key path)", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({ modifiedTime: "2026-02-02T00:00:00.000Z" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));
    expect(await getDriveModifiedTime(DRIVE_URL)).toBe("2026-02-02T00:00:00.000Z");
    expect(seen[0]).toContain("fields=modifiedTime");
    expect(seen[0]).not.toContain("alt=media"); // metadata-only — never the file bytes
  });

  it("returns undefined for a non-Drive URL (no fetch made)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await getDriveModifiedTime("https://example.com/v.mp4")).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns undefined when no Drive auth is configured (public file — best-effort, not a hard failure)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await getDriveModifiedTime(DRIVE_URL)).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns undefined (never throws) on a non-OK response or a network error", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await getDriveModifiedTime(DRIVE_URL)).toBeUndefined();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await getDriveModifiedTime(DRIVE_URL)).toBeUndefined();
  });
});

type DriveNode = { id: string; name: string; mimeType: string };
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Simulate Drive files.list over a fixed nested tree: returns the children of
 *  whichever folder id appears in the `q` param, honoring the query's mimeType
 *  filters so it faithfully models BOTH the old (video-only, non-recursive) query
 *  and a new (video + folder, recursive) query. */
function stubDriveTree(tree: Record<string, DriveNode[]>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const q = new URL(url).searchParams.get("q") ?? "";
    const parent = q.match(/'([^']+)' in parents/)?.[1] ?? "";
    const wantsVideo = q.includes("mimeType contains 'video'");
    const wantsFolder = q.includes(FOLDER_MIME);
    const children = (tree[parent] ?? []).filter((f) =>
      f.mimeType === FOLDER_MIME ? wantsFolder : wantsVideo && f.mimeType.includes("video"),
    );
    return new Response(JSON.stringify({ files: children }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
}

// Google's per-file 24h download-quota / anti-abuse block returns 403 with an HTML
// "Sorry, you can't view or download this file at this time" page — the exact error
// the user hits when testing the same Drive file repeatedly.
const GOOGLE_SORRY_403 =
  '<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/>' +
  "<title>Sorry...</title><style>body { font-family: verdana, arial, sans-serif; " +
  "background-color: #fff; color: #000; }</style></head><body>Sorry, you can't view " +
  "or download this file at this time.</body></html>";

describe("driveDownload — Google download-quota (403 'Sorry') handling", () => {
  it("recognizes a public HTML quota page instead of misreporting a permission problem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(GOOGLE_SORRY_403, { status: 200, headers: { "content-type": "text/html" } })));
    const dir = await mkdtemp(join(tmpdir(), "vello-quota-public-"));
    try {
      await expect(downloadFromDriveToFile(DRIVE_URL, join(dir, "f"), 10 * 1024 * 1024))
        .rejects.toThrow(/DRIVE_QUOTA/);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
  it("downloadFromDriveToFile: a quota 403 → a friendly, actionable error (not raw HTML)", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(GOOGLE_SORRY_403, { status: 403, headers: { "content-type": "text/html" } })));
    const dir = await mkdtemp(join(tmpdir(), "vello-quota-"));
    try {
      await expect(downloadFromDriveToFile(DRIVE_URL, join(dir, "f"), 10 * 1024 * 1024))
        .rejects.toThrow(/DRIVE_QUOTA|download limit|make a copy/i);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("downloadFromDriveToFile: a NON-quota 403 keeps the raw HTTP error", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Access denied — you need permission for this file", { status: 403 })));
    const dir = await mkdtemp(join(tmpdir(), "vello-quota-"));
    try {
      await expect(downloadFromDriveToFile(DRIVE_URL, join(dir, "f"), 10 * 1024 * 1024))
        .rejects.toThrow(/Drive API download HTTP 403/);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("downloadFromDriveToFile: API credentials can't see the file → falls back to the public 'anyone with the link' download", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("googleapis.com")
      ? new Response("File not found", { status: 404 })
      : new Response(Buffer.from("PUBLIC_VIDEO"), { status: 200, headers: { "content-type": "video/mp4" } })));
    const dir = await mkdtemp(join(tmpdir(), "vello-pubfb-"));
    try {
      const out = await downloadFromDriveToFile(DRIVE_URL, join(dir, "f"), 10 * 1024 * 1024);
      expect(out.mime).toBe("video/mp4");
      expect((await readFile(join(dir, "f"))).toString()).toBe("PUBLIC_VIDEO");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("downloadFromDriveToFile: legacy uc? interstitial we can't parse → drive.usercontent confirm=t download", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      return String(url).startsWith("https://drive.usercontent.google.com/download")
        ? new Response(Buffer.from("SHARED_VIDEO"), { status: 200, headers: { "content-type": "video/mp4" } })
        : new Response("<html>Google Drive can't scan this file for viruses</html>", { status: 200, headers: { "content-type": "text/html" } });
    }));
    const dir = await mkdtemp(join(tmpdir(), "vello-uc-"));
    try {
      await downloadFromDriveToFile(DRIVE_URL, join(dir, "f"), 10 * 1024 * 1024);
      expect((await readFile(join(dir, "f"))).toString()).toBe("SHARED_VIDEO");
      expect(calls.some((u) => u.includes("confirm=t"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("getDriveFileSize: API can't see the file → reads the public download's size", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("googleapis.com")
      ? new Response("File not found", { status: 404 })
      : new Response(Buffer.from("x"), { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-0/4242" } })));
    expect(await getDriveFileSize(DRIVE_URL)).toBe(4242);
  });

  it("isDriveAccessBlock: true for the quota block + any Drive 4xx; false for a decode error", () => {
    expect(isDriveAccessBlock("DRIVE_QUOTA: Google Drive temporarily blocked this file's download")).toBe(true);
    expect(isDriveAccessBlock("Drive API stream HTTP 403: <html>...Sorry...")).toBe(true);
    expect(isDriveAccessBlock("Drive API download HTTP 404: not found")).toBe(true);
    expect(isDriveAccessBlock("ffmpeg pipe:0: could not find moov atom")).toBe(false);
    expect(isDriveAccessBlock("network timeout")).toBe(false);
  });
});

describe("listDriveFolderVideos — recursive subfolder enumeration", () => {
  it("recurses into subfolders and returns videos nested several levels deep", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    // Mirrors the reported Drive: loose root MP4s + many content sub-folders.
    stubDriveTree({
      ROOT: [
        { id: "vid-root", name: "CO402.mp4", mimeType: "video/mp4" },
        { id: "SUB1", name: "content ads", mimeType: FOLDER_MIME },
        { id: "SUB2", name: "Contents", mimeType: FOLDER_MIME },
      ],
      SUB1: [{ id: "vid-a", name: "meet-greet.mp4", mimeType: "video/mp4" }],
      SUB2: [
        { id: "SUB3", name: "raw footage hotel", mimeType: FOLDER_MIME },
        { id: "vid-b", name: "trade.mov", mimeType: "video/quicktime" },
      ],
      SUB3: [{ id: "vid-c", name: "hotel.mp4", mimeType: "video/mp4" }],
    });

    const out = await listDriveFolderVideos("ROOT");
    expect(out.map((v) => v.fileId).sort()).toEqual(["vid-a", "vid-b", "vid-c", "vid-root"]);
    // Names survive so the picker can label each clip.
    expect(out.find((v) => v.fileId === "vid-c")?.name).toBe("hotel.mp4");
  });

  it("caps a single folder's expansion at MAX_FOLDER_VIDEOS (paid-transcription fan-out guard, BUG-032b)", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    // One folder that holds far more videos than the cap — e.g. a dumping-ground
    // Drive with thousands of clips. Without the guard each becomes a paid STT call.
    const many = Array.from({ length: 205 }, (_, i) => ({
      id: `vid-${i}`,
      name: `clip-${i}.mp4`,
      mimeType: "video/mp4",
    }));
    stubDriveTree({ ROOT: many });

    const out = await listDriveFolderVideos("ROOT");
    // Default MAX_FOLDER_VIDEOS = 200 — the expansion is bounded, not the full 205.
    expect(out.length).toBe(200);
    // The kept videos are real, distinct file ids (the first 200 enumerated).
    expect(new Set(out.map((v) => v.fileId)).size).toBe(200);
  });

  it("does not loop forever on a folder cycle / shortcut", async () => {
    process.env.GOOGLE_DRIVE_API_KEY = "test-key";
    stubDriveTree({
      ROOT: [
        { id: "vid-root", name: "a.mp4", mimeType: "video/mp4" },
        { id: "SUB1", name: "sub", mimeType: FOLDER_MIME },
      ],
      // SUB1 links back to ROOT (a Drive folder shortcut) — must not infinite-loop.
      SUB1: [
        { id: "vid-a", name: "b.mp4", mimeType: "video/mp4" },
        { id: "ROOT", name: "back-to-root", mimeType: FOLDER_MIME },
      ],
    });

    const out = await listDriveFolderVideos("ROOT");
    expect(out.map((v) => v.fileId).sort()).toEqual(["vid-a", "vid-root"]);
  });
});
