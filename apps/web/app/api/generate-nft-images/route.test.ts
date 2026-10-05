// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The routes were split into a fast CREATE step (this file's ./route) and a fast
// COLLECT step (./collect/route) so no single request holds open long enough for
// the Railway proxy to time out. These tests cover both halves.
//
// For CREATE: the hosting guard must fire BEFORE any Kie call, so hosting is mocked
// to fail (exactly what happens when SUPABASE_SERVICE_ROLE_KEY is missing) and
// fetch is stubbed so an unguarded code path can never reach the real network.
vi.mock("@/lib/server/imageForKie", () => ({
  hostBase64ForKie: vi.fn(async () => null),
}));
vi.mock("@/lib/server/makeGif", () => ({
  makeAnimatedGif: vi.fn(async () => Buffer.alloc(0)),
}));

const TINY_PNG_B64 = "aGVsbG8="; // content irrelevant — hosting is mocked
const INTERNAL_SECRET = "test-internal-secret";

function postReq(path: string, body: unknown, opts?: { auth?: boolean }): Request {
  const withAuth = opts?.auth ?? true;
  return new Request(`http://test.local${path}`, {
    method: "POST",
    // Routes are auth-gated; the internal-secret path lets tests exercise the
    // downstream logic without mocking the Privy JWT verifier.
    headers: {
      "Content-Type": "application/json",
      ...(withAuth ? { "X-Internal-Secret": INTERNAL_SECRET } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** A JSON recordInfo Response as Kie's /jobs/recordInfo returns. */
function recordInfoResponse(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ code: 200, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("KIE_API_KEY", "test-key");
  vi.stubEnv("INTERNAL_CRON_SECRET", INTERNAL_SECRET);
  // Default: any network call throws — individual tests that need a poll response
  // re-stub fetch below.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network disabled in tests");
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("generate-nft-images CREATE — reference hosting + auth guards", () => {
  it("fails loudly when reference photos were uploaded but none could be hosted", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      postReq("/api/generate-nft-images", {
        prompt_1: "p1",
        prompt_2: "p2",
        referenceImages: [{ data: TINY_PNG_B64, mimeType: "image/png" }],
      }) as never,
    );
    expect(res.status).toBe(502);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toMatch(/reference/i);
    // Critically: it must NOT have started a Kie render without the likeness.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects anonymous callers (no auth) with 401 and never touches Kie", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      postReq("/api/generate-nft-images", { prompt_1: "p1", prompt_2: "p2" }, { auth: false }) as never,
    );
    expect(res.status).toBe(401);
    // No paid render — the gate fired before any Kie network call.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("requires prompt_1 (400) before spending credits", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq("/api/generate-nft-images", { prompt_2: "p2" }) as never);
    expect(res.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("renders ONE KIE task when prompt_2 is omitted (trader/clipper single-image cover)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ code: 200, msg: "success", data: { taskId: `task-${calls.length}` } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const { POST } = await import("./route");
    const res = await POST(postReq("/api/generate-nft-images", { prompt_1: "p1" }) as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { tasks?: Array<{ taskId: string }> };
    expect(json.tasks).toHaveLength(1);
    // Exactly one createTask hit on the paid endpoint — no duplicate rendering.
    expect(calls.filter((u) => u.includes("/api/v1/jobs/createTask"))).toHaveLength(1);
  });

  it("renders TWO KIE tasks when prompt_2 is provided (influencer GIF flow)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ code: 200, msg: "success", data: { taskId: `task-${calls.length}` } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const { POST } = await import("./route");
    const res = await POST(
      postReq("/api/generate-nft-images", { prompt_1: "p1", prompt_2: "p2" }) as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { tasks?: Array<{ taskId: string }> };
    expect(json.tasks).toHaveLength(2);
    expect(calls.filter((u) => u.includes("/api/v1/jobs/createTask"))).toHaveLength(2);
  });
});

describe("generate-nft-images COLLECT — one quick poll, no long loop", () => {
  it("rejects anonymous callers (no auth) with 401 and never polls Kie", async () => {
    const { POST } = await import("./collect/route");
    const res = await POST(
      postReq("/api/generate-nft-images/collect", { tasks: [{ taskId: "t1", label: "x" }] }, { auth: false }) as never,
    );
    expect(res.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when there are no tasks to collect", async () => {
    const { POST } = await import("./collect/route");
    const res = await POST(postReq("/api/generate-nft-images/collect", { tasks: [] }) as never);
    expect(res.status).toBe(400);
  });

  it("returns { pending:true } fast while a task is still rendering", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => recordInfoResponse({ taskId: "t1", state: "generating" })));
    const { POST } = await import("./collect/route");
    const res = await POST(
      postReq("/api/generate-nft-images/collect", { tasks: [{ taskId: "t1", label: "Dynamic Shot" }] }) as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; pending?: boolean };
    expect(json.ok).toBe(true);
    expect(json.pending).toBe(true);
  });

  it("surfaces the Kie failure message when a task failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => recordInfoResponse({ taskId: "t1", state: "fail", failMsg: "blocked by safety" })),
    );
    const { POST } = await import("./collect/route");
    const res = await POST(
      postReq("/api/generate-nft-images/collect", { tasks: [{ taskId: "t1", label: "Dynamic Shot" }] }) as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/blocked by safety/i);
  });
});
