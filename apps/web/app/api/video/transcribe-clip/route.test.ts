// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// ── Regression for transcribe-clip provider behaviors (commits 65e49f1, 77cc487):
//   2) ElevenLabs 200-with-0-words throws a PROVIDER-NAMED error mentioning
//      music/speech (NOT "no parseable JSON"); KIE prose/refusal throws a
//      kie-gemini-named error with the content head; EL→KIE cross-fallback fires
//      when both keys are set.
//   3) A Google Drive viewer URL is fetched via downloadFromDriveToFile (the
//      Drive-aware downloader), NEVER safeFetchToBuffer (the HTML-interstitial bug).
//
// The route is a Next POST handler wiring auth + ffmpeg + Convex + STT providers.
// We mock those so a request reaches the provider runners deterministically.

// Internal-secret auth → skip SIWS/ownership entirely.
vi.mock("@/lib/server/requireAuth", () => ({
  requireInternalOrUserAuth: vi.fn(async () => ({ internal: true })),
  requireOwnerWithSiws: vi.fn(() => null),
  requireSiwsSession: vi.fn(() => null),
}));

vi.mock("@/lib/server/ffmpegBin", () => ({ resolveFfmpegPath: () => "/fake/ffmpeg" }));

// child_process.spawn: every ffmpeg invocation "closes" with code 0. A probe
// (args === ["-i", <path>]) emits a Duration line on stderr so probeDuration > 0.
// probeSeconds is mutable so a test can simulate a LONG source (chunked KIE path).
const probeState = vi.hoisted(() => ({ seconds: 90 }));
function durationLine(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = (sec % 60).toFixed(2).padStart(5, "0");
  return `  Duration: ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s}, start: 0.0\n`;
}
vi.mock("node:child_process", () => ({
  spawn: vi.fn((_bin: string, args: string[]) => {
    const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    const isProbe = args.length === 2 && args[0] === "-i";
    queueMicrotask(() => {
      if (isProbe) proc.stderr.emit("data", Buffer.from(durationLine(probeState.seconds)));
      proc.emit("close", 0);
    });
    return proc;
  }),
}));

// fs/promises: tmp dir + file IO are no-ops returning small buffers.
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async (p: string) => `${p}xxxx`),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => Buffer.from("FAKEAUDIOBYTES")),
  rm: vi.fn(async () => {}),
}));

// Downloader + Drive: capture which path a source takes. The mock factories are
// hoisted, so the spies live in a vi.hoisted() block shared with the factories.
const { safeFetchToBuffer, downloadFromDriveToFile, getDriveModifiedTime } = vi.hoisted(() => ({
  safeFetchToBuffer: vi.fn(async () => ({ buffer: Buffer.from("video"), mime: "video/mp4" })),
  downloadFromDriveToFile: vi.fn(async () => ({ mime: "video/mp4" }) as { mime: string; modifiedTime?: string }),
  // Default: no signal (matches pre-fix behavior) — tests that care override
  // per-call with mockResolvedValueOnce.
  getDriveModifiedTime: vi.fn(async () => undefined as string | undefined),
}));
vi.mock("@/lib/server/downloader", () => ({ safeFetchToBuffer }));
vi.mock("@/lib/server/driveDownload", () => ({
  isDriveUrl: (u: string) => /drive\.google\.com|docs\.google\.com/.test(u),
  downloadFromDriveToFile,
  getDriveModifiedTime,
}));

// convex/browser: ConvexHttpClient is real production code (route.ts constructs
// one whenever NEXT_PUBLIC_CONVEX_URL is set) — mock its query/mutation so cache
// tests control exactly what the "cluster" returns. Convex's api proxy is NOT
// identity-stable across property accesses, so calls are matched by
// getFunctionName (a stable "module:fn" string), same convention as
// app/api/economy/settle-tab/route.test.ts.
const convexMock = vi.hoisted(() => ({ queryMock: vi.fn(), mutationMock: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn().mockImplementation(() => ({ query: convexMock.queryMock, mutation: convexMock.mutationMock })),
}));

// analyzeTranscript: only reached on success — return a trivial analysis.
vi.mock("@/lib/server/clipAnalysis", () => ({
  analyzeTranscript: vi.fn(async () => ({ moments: [], version: 1 })),
  ANALYSIS_VERSION: 1,
}));

// meter: not exercised (no billing object) but mock to be safe.
vi.mock("@/lib/economy/meterAgentService", () => ({ meterAgentService: vi.fn(async () => ({ ok: true })) }));

import { NextRequest } from "next/server";
import { getFunctionName } from "convex/server";

type RouteModule = { POST: (req: NextRequest) => Promise<Response> };

// The route reads ELEVENLABS_API_KEY / KIE_API_KEY into MODULE-LEVEL constants at
// import time, so provider selection is frozen at first import. To control which
// keys are "set" per test, set env then re-import the module fresh.
async function loadPOST(env: { eleven?: boolean; kie?: boolean; convexUrl?: string }): Promise<RouteModule["POST"]> {
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.KIE_API_KEY;
  delete process.env.KIE_API_TOKEN;
  if (env.convexUrl) {
    // Cache path enabled — the master-cache tests below own convex/browser via
    // convexMock (query/mutation), so a real network call is never reached.
    process.env.NEXT_PUBLIC_CONVEX_URL = env.convexUrl;
    process.env.INTERNAL_CRON_SECRET = "cron-secret";
  } else {
    delete process.env.NEXT_PUBLIC_CONVEX_URL; // no cache → straight to transcribe
    delete process.env.INTERNAL_CRON_SECRET;
  }
  if (env.eleven) process.env.ELEVENLABS_API_KEY = "el-key";
  if (env.kie) process.env.KIE_API_KEY = "kie-key";
  vi.resetModules();
  const mod = (await import("./route")) as RouteModule;
  return mod.POST;
}

const makeReq = (body: unknown) =>
  new NextRequest("https://vello.gg/api/video/transcribe-clip", {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": "s" },
    body: JSON.stringify(body),
  });

/** Queue ElevenLabs / KIE responses by URL. */
function stubProviders(opts: {
  eleven?: () => Response;
  kie?: () => Response;
}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (typeof url === "string" && url.includes("elevenlabs.io")) {
      if (!opts.eleven) throw new Error("unexpected elevenlabs call");
      return opts.eleven();
    }
    if (typeof url === "string" && url.includes("api.kie.ai")) {
      if (!opts.kie) throw new Error("unexpected kie call");
      return opts.kie();
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

beforeEach(() => {
  safeFetchToBuffer.mockClear();
  downloadFromDriveToFile.mockReset();
  downloadFromDriveToFile.mockResolvedValue({ mime: "video/mp4" });
  getDriveModifiedTime.mockReset();
  getDriveModifiedTime.mockResolvedValue(undefined);
  convexMock.queryMock.mockReset();
  convexMock.mutationMock.mockReset();
  probeState.seconds = 90;
});
afterEach(() => vi.unstubAllGlobals());

const elevenOk = (words: { text: string; start: number; end: number; type?: string }[]) =>
  new Response(JSON.stringify({ words }), { status: 200, headers: { "content-type": "application/json" } });

describe("transcribe-clip — provider error surfacing", () => {
  it("ElevenLabs 200 with 0 words throws a PROVIDER-NAMED 'no speech words' error (not 'no parseable JSON')", async () => {
    const POST = await loadPOST({ eleven: true }); // EL primary, no KIE → no fallback
    stubProviders({ eleven: () => elevenOk([]) }); // music-only: zero speech words
    const res = await POST(makeReq({ sourceUrl: "https://example.com/v.mp4" }));
    expect(res.status).toBe(500);
    const j = (await res.json()) as { ok: boolean; error: string };
    expect(j.ok).toBe(false);
    expect(j.error).toMatch(/elevenlabs returned no speech words/i);
    expect(j.error).toMatch(/music-only\/silent\/non-speech/i);
    expect(j.error).not.toMatch(/no parseable JSON/i);
  });

  it("falls back EL → KIE when BOTH keys are set and EL finds no words", async () => {
    const POST = await loadPOST({ eleven: true, kie: true });
    let kieCalled = false;
    stubProviders({
      eleven: () => elevenOk([]), // EL: no words → fall back
      kie: () => {
        kieCalled = true;
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            duration: 90,
            segments: [{ start: 0, end: 5, text: "hello there friends" }],
            words: [{ word: "hello", start: 0, end: 1 }, { word: "there", start: 1, end: 2 }],
          }) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const res = await POST(makeReq({ sourceUrl: "https://example.com/v.mp4" }));
    const j = (await res.json()) as { ok: boolean; provider?: string; error?: string };
    void j.error;
    expect(kieCalled).toBe(true);          // cross-fallback fired
    expect(j.ok).toBe(true);
    expect(j.provider).toBe("kie-gemini"); // succeeded on the fallback provider
  });

  it("KIE prose/refusal throws a kie-gemini-named error including the refusal text", async () => {
    const POST = await loadPOST({ kie: true }); // KIE primary (no EL)
    stubProviders({
      kie: () => new Response(JSON.stringify({
        choices: [{ message: { content: "I'm sorry, I can't transcribe this audio." } }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    // runKie retries the chunk 3× with 5s/10s backoff; drive those timers so the
    // deterministic refusal surfaces without a real ~15s wait.
    vi.useFakeTimers();
    try {
      const resP = POST(makeReq({ sourceUrl: "https://example.com/v.mp4" }));
      await vi.runAllTimersAsync();
      const res = await resP;
      expect(res.status).toBe(500);
      const j = (await res.json()) as { ok: boolean; error: string };
      expect(j.error).toMatch(/kie-gemini/i);
      expect(j.error).toMatch(/prose\/refusal|I'm sorry/i);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("transcribe-clip — Google Drive routing (HTML-interstitial regression)", () => {
  it("routes a Drive viewer URL through downloadFromDriveToFile (2GB cap), NEVER safeFetchToBuffer", async () => {
    const POST = await loadPOST({ eleven: true });
    // Provide a successful EL transcript so the run completes past the download step.
    stubProviders({ eleven: () => elevenOk([
      { text: "hello", start: 0, end: 1 }, { text: "world.", start: 1, end: 2 },
    ]) });
    const driveUrl = "https://drive.google.com/file/d/1AbCdEf12345/view";
    const res = await POST(makeReq({ sourceUrl: driveUrl }));
    const j = (await res.json()) as { ok: boolean; error?: string };
    expect(j.ok).toBe(true);
    expect(downloadFromDriveToFile).toHaveBeenCalledTimes(1);
    // The HTML-interstitial bug was using safeFetchToBuffer on a Drive viewer page.
    expect(safeFetchToBuffer).not.toHaveBeenCalled();
    // Called with the 2GB cap (third arg).
    const callArgs = downloadFromDriveToFile.mock.calls[0] as unknown[];
    expect(callArgs[0]).toBe(driveUrl);
    expect(callArgs[2]).toBe(2 * 1024 * 1024 * 1024);
  });

  it("a non-Drive URL uses safeFetchToBuffer, not the Drive downloader", async () => {
    const POST = await loadPOST({ eleven: true });
    stubProviders({ eleven: () => elevenOk([
      { text: "hello", start: 0, end: 1 }, { text: "world.", start: 1, end: 2 },
    ]) });
    const res = await POST(makeReq({ sourceUrl: "https://example.com/clip.mp4" }));
    const j = (await res.json()) as { ok: boolean };
    expect(j.ok).toBe(true);
    expect(safeFetchToBuffer).toHaveBeenCalledTimes(1);
    expect(downloadFromDriveToFile).not.toHaveBeenCalled();
  });
});

// ── Regression for chunked transcription (commits 2648fa0 / b673c89) ──
// Long audio in one KIE request reliably truncates, so the KIE runner splits at
// ~4 min (CHUNK=240s), transcribes chunks SEQUENTIALLY (parallel trips KIE's rate
// limit), and REBASES each chunk's slice-local timestamps by its offset. This
// pins: one KIE call per chunk, in order, and absolute (offset) stitched timings.
describe("transcribe-clip — KIE chunked transcription (sequential + rebased)", () => {
  it("splits a long source into sequential chunks and rebases per-chunk timestamps to absolute", async () => {
    probeState.seconds = 600; // > CHUNK(240)+60 → 3 chunks of 240/240/120
    const POST = await loadPOST({ kie: true });

    // Every chunk returns the SAME slice-local transcript (word at t=1). After
    // rebasing, chunk i's word must land at i*240 + 1.
    const callOrder: number[] = [];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("api.kie.ai")) {
        callOrder.push(n++);
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            duration: 240,
            segments: [{ start: 1, end: 2, text: "word here" }],
            words: [{ word: "word", start: 1, end: 1.5 }],
          }) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const res = await POST(makeReq({ sourceUrl: "https://example.com/long.mp4" }));
    const j = (await res.json()) as { ok: boolean; provider?: string; words?: { start: number }[] };
    expect(j.ok).toBe(true);
    expect(j.provider).toBe("kie-gemini");

    // One KIE call per chunk, issued in order (sequential: 0,1,2 — never interleaved).
    expect(callOrder).toEqual([0, 1, 2]);

    // Rebased to ABSOLUTE timeline: words near 0/240/480 (each chunk's local +1s,
    // possibly rescaled — assert the three chunks landed in distinct windows).
    const starts = (j.words ?? []).map((w) => w.start).sort((a, b) => a - b);
    expect(starts.length).toBeGreaterThanOrEqual(3);
    expect(starts[0]).toBeLessThan(240);                         // chunk 0
    expect(starts.some((s) => s >= 240 && s < 480)).toBe(true);  // chunk 1 offset
    expect(starts.some((s) => s >= 480)).toBe(true);             // chunk 2 offset
  });
});

// ── H08/BUG-031: the shared transcript/analysis cache must NOT keep HITting a
// Drive campaign source forever once the SAME fileId/link is replaced in place
// ("Manage versions -> Upload new version"). getDriveModifiedTime + convex are
// mocked so these tests assert the route's own hit/miss + cache-write decision,
// not a real cluster or Drive API.
const CACHE_GET_NAME = "transcriptCache:getByKey";
const CACHE_PUT_NAME = "transcriptCache:put";
const UPLOAD_URL_NAME = "clipStorage:generateUploadUrl";
const DRIVE_URL = "https://drive.google.com/file/d/1AbCdEf12345/view";
const fnName = (ref: unknown) => getFunctionName(ref as Parameters<typeof getFunctionName>[0]);

describe("transcribe-clip — Drive replace-in-place cache invalidation (H08/BUG-031)", () => {
  it("cache HIT when the Drive source's current modifiedTime matches the cached row", async () => {
    const POST = await loadPOST({ eleven: true, convexUrl: "https://example.convex.cloud" });
    getDriveModifiedTime.mockResolvedValueOnce("2026-01-01T00:00:00.000Z"); // unchanged since caching
    convexMock.queryMock.mockImplementation(async (ref: unknown) => {
      if (fnName(ref) === CACHE_GET_NAME) {
        return {
          version: 1, durationSeconds: 42, transcriptUrl: "https://fake-storage.example/t.json",
          analysis: { moments: [] }, provider: "elevenlabs", sourceModifiedTime: "2026-01-01T00:00:00.000Z",
        };
      }
      return null;
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "https://fake-storage.example/t.json") {
        return new Response(JSON.stringify({ segments: [{ start: 0, end: 1, text: "hi" }], words: [{ word: "hi", start: 0, end: 1 }] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const res = await POST(makeReq({ sourceUrl: DRIVE_URL, campaignSource: true }));
    const j = (await res.json()) as { ok: boolean; cached?: boolean };
    expect(j.ok).toBe(true);
    expect(j.cached).toBe(true);
    expect(downloadFromDriveToFile).not.toHaveBeenCalled(); // reused the cached transcript, no re-download
  });

  it("cache MISS + re-transcribes when the Drive source's modifiedTime changed (replaced in place)", async () => {
    const POST = await loadPOST({ eleven: true, convexUrl: "https://example.convex.cloud" });
    getDriveModifiedTime.mockResolvedValueOnce("2026-02-02T00:00:00.000Z"); // CURRENT — differs from cached row
    downloadFromDriveToFile.mockResolvedValueOnce({ mime: "video/mp4", modifiedTime: "2026-02-02T00:00:00.000Z" });
    convexMock.queryMock.mockImplementation(async (ref: unknown) => {
      if (fnName(ref) === CACHE_GET_NAME) {
        return {
          version: 1, durationSeconds: 42, transcriptUrl: "https://fake-storage.example/t.json",
          analysis: { moments: [] }, provider: "elevenlabs", sourceModifiedTime: "2026-01-01T00:00:00.000Z", // STALE
        };
      }
      return null;
    });
    convexMock.mutationMock.mockImplementation(async (ref: unknown) => {
      const name = fnName(ref);
      if (name === UPLOAD_URL_NAME) return "https://fake-upload.example/put";
      if (name === CACHE_PUT_NAME) return "cache-row-id";
      return {};
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("elevenlabs.io")) {
        return elevenOk([{ text: "hello", start: 0, end: 1 }, { text: "world.", start: 1, end: 2 }]);
      }
      if (url === "https://fake-upload.example/put") {
        return new Response(JSON.stringify({ storageId: "storage123" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      // The STALE row's transcript blob — reachable ONLY if the staleness check
      // fails to force a miss (i.e. the bug regresses) and old code proceeds to
      // treat this as a HIT. Serving valid (but STALE) content here means a
      // regression surfaces as `cached:true` (a wrong but honest answer), not an
      // unrelated "unexpected fetch" crash.
      if (url === "https://fake-storage.example/t.json") {
        return new Response(JSON.stringify({ segments: [{ start: 0, end: 1, text: "STALE V1 content" }], words: [] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const res = await POST(makeReq({ sourceUrl: DRIVE_URL, campaignSource: true }));
    const j = (await res.json()) as { ok: boolean; cached?: boolean };
    expect(j.ok).toBe(true);
    expect(j.cached).toBe(false);                             // MISS despite version match — modifiedTime differs
    expect(downloadFromDriveToFile).toHaveBeenCalledTimes(1);  // re-downloaded + re-transcribed the NEW bytes

    // The fresh modifiedTime is recorded so the NEXT run can detect the next replace.
    const putCall = convexMock.mutationMock.mock.calls.find((c) => fnName(c[0]) === CACHE_PUT_NAME);
    expect(putCall?.[1]).toMatchObject({ sourceModifiedTime: "2026-02-02T00:00:00.000Z" });
  });

  it("a non-Drive source (no modifiedTime signal) still cache-HITs normally — unaffected regression check", async () => {
    const POST = await loadPOST({ eleven: true, convexUrl: "https://example.convex.cloud" });
    convexMock.queryMock.mockImplementation(async (ref: unknown) => {
      if (fnName(ref) === CACHE_GET_NAME) {
        return {
          version: 1, durationSeconds: 10, transcriptUrl: "https://fake-storage.example/t2.json",
          analysis: { moments: [] }, provider: "elevenlabs", sourceModifiedTime: null,
        };
      }
      return null;
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "https://fake-storage.example/t2.json") {
        return new Response(JSON.stringify({ segments: [], words: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const res = await POST(makeReq({ sourceUrl: "https://example.com/clip.mp4", campaignSource: true }));
    const j = (await res.json()) as { ok: boolean; cached?: boolean };
    expect(j.ok).toBe(true);
    expect(j.cached).toBe(true);
    expect(getDriveModifiedTime).not.toHaveBeenCalled(); // not a Drive URL — no metadata call made
  });
});

// ── LANGUAGE DETECTION + PINNING (the "Malay captions came back wrong" bug) ────
// Scribe in auto mode can land on a near-neighbour language (ms ↔ id) or drift
// across a file, and the KIE Gemini fallback will happily TRANSLATE to English —
// both produce captions whose words nobody said. The route now: pins an explicit
// language, reports the detected one, re-runs once when auto-detect confidence is
// low, and pins the first chunk's language onto every later chunk.
describe("transcribe-clip — language detection + pinning", () => {
  /** Parse the multipart body ElevenLabs received; returns the language_code field. */
  function elevenLanguageField(body: unknown): string | null {
    // The route sends FormData — read the field directly instead of re-parsing bytes.
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      const v = body.get("language_code");
      return typeof v === "string" ? v : null;
    }
    return null;
  }

  it("pins language_code on the ElevenLabs request when the caller passes languageCode", async () => {
    const POST = await loadPOST({ eleven: true });
    const seen: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (typeof url === "string" && url.includes("elevenlabs.io")) {
        seen.push(elevenLanguageField(init?.body));
        return new Response(JSON.stringify({
          language_code: "ms", language_probability: 0.99,
          words: [{ text: "apa", start: 0, end: 0.4 }, { text: "khabar", start: 0.4, end: 1 }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const res = await POST(makeReq({ sourceUrl: "https://example.com/v.mp4", languageCode: "ms" }));
    const j = (await res.json()) as { ok: boolean; language?: string };
    expect(j.ok).toBe(true);
    expect(seen).toEqual(["ms"]);   // pinned, exactly one call (no low-confidence re-run)
    expect(j.language).toBe("ms");
  });

  it("reports the DETECTED language when the caller pins none", async () => {
    const POST = await loadPOST({ eleven: true });
    stubProviders({
      eleven: () => new Response(JSON.stringify({
        language_code: "ms", language_probability: 0.97,
        words: [{ text: "selamat", start: 0, end: 0.5 }, { text: "pagi", start: 0.5, end: 1 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    const res = await POST(makeReq({ sourceUrl: "https://example.com/v.mp4" }));
    const j = (await res.json()) as { ok: boolean; language?: string };
    expect(j.ok).toBe(true);
    expect(j.language).toBe("ms");
  });

  it("re-runs ONCE pinned to the detected language when auto-detect confidence is low", async () => {
    const POST = await loadPOST({ eleven: true });
    const seen: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (typeof url === "string" && url.includes("elevenlabs.io")) {
        const pinned = elevenLanguageField(init?.body);
        seen.push(pinned);
        return new Response(JSON.stringify({
          language_code: "ms",
          language_probability: pinned ? 1 : 0.42,   // first pass unsure, pinned pass certain
          words: pinned
            ? [{ text: "apa", start: 0, end: 0.4 }, { text: "khabar", start: 0.4, end: 1 }]
            : [{ text: "apa", start: 0, end: 0.4 }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const res = await POST(makeReq({ sourceUrl: "https://example.com/v.mp4" }));
    const j = (await res.json()) as { ok: boolean; language?: string; words?: unknown[] };
    expect(j.ok).toBe(true);
    expect(seen).toEqual([null, "ms"]);      // auto-detect, then the pinned re-run
    expect(j.words).toHaveLength(2);          // the pinned run's transcript is the one kept
    expect(j.language).toBe("ms");
  });

  it("fails FAST on an ElevenLabs billing 401 (no retry) and names the account fix", async () => {
    const POST = await loadPOST({ eleven: true });
    let calls = 0;
    stubProviders({
      eleven: () => {
        calls++;
        return new Response(JSON.stringify({ detail: { status: "payment_issue", message: "Your subscription has a failed or incomplete payment." } }), { status: 401 });
      },
    });
    const res = await POST(makeReq({ sourceUrl: "https://example.com/v.mp4" }));
    const j = (await res.json()) as { ok: boolean; error: string };
    expect(j.ok).toBe(false);
    expect(calls).toBe(1);                                  // 401 is deterministic — not retried
    expect(j.error).toMatch(/billing\/invoice/i);
  });

  it("KIE chunked path pins chunk 1's detected language onto later chunks (no mid-video drift)", async () => {
    probeState.seconds = 700;                    // > 240 + 60 → 3 chunks
    const POST = await loadPOST({ kie: true });
    const prompts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (typeof url === "string" && url.includes("api.kie.ai")) {
        prompts.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            language: "ms", duration: 240,
            segments: [{ start: 0, end: 5, text: "selamat pagi semua" }],
            words: [{ word: "selamat", start: 0, end: 1 }, { word: "pagi", start: 1, end: 2 }],
          }) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const res = await POST(makeReq({ sourceUrl: "https://example.com/long.mp4" }));
    const j = (await res.json()) as { ok: boolean; language?: string };
    expect(j.ok).toBe(true);
    expect(prompts.length).toBeGreaterThan(1);
    expect(prompts[0]).not.toMatch(/The spoken language is/);      // chunk 1 detects
    expect(prompts[1]).toMatch(/The spoken language is \\"ms\\"/);   // chunk 2+ pinned
    expect(j.language).toBe("ms");
  });

  it("every STT prompt forbids translating the speech to English", async () => {
    const POST = await loadPOST({ kie: true });
    const prompts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (typeof url === "string" && url.includes("api.kie.ai")) {
        prompts.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            language: "ms", duration: 90,
            segments: [{ start: 0, end: 5, text: "apa khabar" }],
            words: [{ word: "apa", start: 0, end: 1 }],
          }) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    await POST(makeReq({ sourceUrl: "https://example.com/v.mp4" }));
    expect(prompts[0]).toMatch(/do NOT translate/i);
    expect(prompts[0]).toMatch(/NEVER translate/i);
  });
});

describe("transcribe-clip — music-aware caption source (captions must be the video's speech, not the music)", () => {
  it("drops words that overlap a Scribe-tagged (music)/(singing) audio-event window", async () => {
    const POST = await loadPOST({ eleven: true });
    // Song baked into the video: singing/music tagged 0-4s, real speech 4-8s.
    stubProviders({
      eleven: () => elevenOk([
        { type: "audio_event", text: "(music)", start: 0, end: 4 },
        { text: "la", start: 0, end: 0.5 }, { text: "la", start: 0.5, end: 1 },   // lyrics inside the music window
        { type: "audio_event", text: "(singing)", start: 2, end: 4 },
        { text: "hello", start: 4, end: 5 }, { text: "world", start: 5, end: 6 }, // speech after the music
      ]),
    });
    const res = await POST(makeReq({ sourceUrl: "https://example.com/v.mp4" }));
    const j = (await res.json()) as { ok: boolean; words?: { word: string }[]; segments?: { text: string }[] };
    expect(j.ok).toBe(true);
    // The lyric words ("la la") are gone — only the spoken speech survives.
    expect(j.words).toEqual([{ word: "hello", start: 4, end: 5 }, { word: "world", start: 5, end: 6 }]);
    expect(j.segments?.[0]?.text).toBe("hello world");
  });

  it("keeps speech words that do NOT overlap a music window (background bed under speech)", async () => {
    const POST = await loadPOST({ eleven: true });
    stubProviders({
      eleven: () => elevenOk([
        { type: "audio_event", text: "(music)", start: 0, end: 1 },   // brief intro music
        { text: "welcome", start: 1.5, end: 2.5 }, { text: "back", start: 2.5, end: 3.5 },
      ]),
    });
    const res = await POST(makeReq({ sourceUrl: "https://example.com/v.mp4" }));
    const j = (await res.json()) as { ok: boolean; words?: { word: string }[] };
    expect(j.ok).toBe(true);
    expect(j.words).toEqual([{ word: "welcome", start: 1.5, end: 2.5 }, { word: "back", start: 2.5, end: 3.5 }]);
  });

  it("music-only audio returns NO captions and does NOT fall back to KIE (which would transcribe the lyrics)", async () => {
    const POST = await loadPOST({ eleven: true, kie: true }); // both keys: fallback WOULD fire if it weren't suppressed
    let kieCalled = false;
    stubProviders({
      eleven: () => elevenOk([
        { type: "audio_event", text: "(music)", start: 0, end: 30 },
        { type: "audio_event", text: "(singing)", start: 0, end: 30 },
        // zero word tokens: the whole file is a song/backing track
      ]),
      kie: () => {
        kieCalled = true;
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            duration: 30,
            segments: [{ start: 0, end: 30, text: "these are the lyrics" }],
            words: [{ word: "these", start: 0, end: 1 }],
          }) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const res = await POST(makeReq({ sourceUrl: "https://example.com/v.mp4" }));
    const j = (await res.json()) as { ok: boolean; provider?: string; words?: unknown[]; error?: string };
    expect(j.ok).toBe(true);
    expect(kieCalled).toBe(false);          // NO lyric-transcribing fallback
    expect(j.words).toEqual([]);            // no captions burned
    expect(j.provider).toBe("elevenlabs");
  });

  it("still falls back EL → KIE when EL finds no words AND no music window (silent/unknown, not music)", async () => {
    const POST = await loadPOST({ eleven: true, kie: true });
    let kieCalled = false;
    stubProviders({
      eleven: () => elevenOk([]), // no audio events at all → not diagnosed as music
      kie: () => {
        kieCalled = true;
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            duration: 90,
            segments: [{ start: 0, end: 5, text: "hello there" }],
            words: [{ word: "hello", start: 0, end: 1 }, { word: "there", start: 1, end: 2 }],
          }) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const res = await POST(makeReq({ sourceUrl: "https://example.com/v.mp4" }));
    const j = (await res.json()) as { ok: boolean; provider?: string };
    expect(kieCalled).toBe(true);
    expect(j.ok).toBe(true);
    expect(j.provider).toBe("kie-gemini");
  });
});
