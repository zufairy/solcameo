// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getFunctionName } from "convex/server";

/**
 * #23 (free-skilled-clips): a direct authed POST to /api/video/clip used to render
 * fully-skilled clips for FREE by simply omitting `billing` (the canvas pre-charges
 * skills at run-start via /api/economy/clip-precheck, but the route itself never
 * verified). The route is now the never-trust-the-client backstop:
 *
 *  - non-internal + skill-class ops + NO billing identity (no mint AND no
 *    sessionId) → fail-closed 402 `billing_required`.
 *  - billing.mintAddress → each priced skill DERIVED from the ops server-side
 *    (exclusive-emitter inversion, lib/server/clipOpsBilling.ts) is charged via
 *    usage:recordUsage with idemKey `${runId}:skill:${skillId}` — EXACTLY the
 *    clip-precheck key (clip-precheck/route.ts) so a canvas run dedups instead
 *    of double-charging.
 *  - billing.sessionId (draft, unminted) renders FREE — product decision.
 *  - the $0.40 "render" fee stays NOT metered on the canvas path (no `step`);
 *    the legacy `billing.step` render-meter behavior is preserved.
 *
 * Convex + auth + downloader + render core are mocked; we assert the route's
 * billing decisions. FunctionReferences are matched by getFunctionName (anyApi
 * proxies aren't identity-stable).
 */

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.INTERNAL_CRON_SECRET = "cron-secret";
  return {
    queryMock: vi.fn(),
    mutationMock: vi.fn(),
    meterMock: vi.fn(),
    fetchBufMock: vi.fn(),
    renderMock: vi.fn(),
    authMock: vi.fn(),
  };
});

vi.mock("@/lib/server/agentGenerationBilling", () => ({ chargeAgentGeneration: async (mintAddress: string, runId: string, service: string) => {
  try { return await h.mutationMock((await import("@/convex/_generated/api")).api.usage.recordUsage, { mintAddress, service, qty: 1, idemKey: `${runId}:skill:${service}`, walletOnly: true, requireTransfer: true, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" }); }
  catch { return { ok: false, reason: "billing_unavailable" }; }
} }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn().mockImplementation(() => ({ query: h.queryMock, mutation: h.mutationMock })),
}));
vi.mock("@/lib/server/requireAuth", () => ({
  requireInternalOrUserAuth: h.authMock,
  requireOwnerWithSiws: vi.fn(() => null),
  requireSiwsSession: vi.fn(() => null),
}));
vi.mock("@/lib/economy/meterAgentService", () => ({ meterAgentService: h.meterMock }));
vi.mock("@/lib/server/downloader", () => ({ safeFetchToBuffer: h.fetchBufMock }));
vi.mock("@/lib/server/clipRender", () => {
  class ClipRenderError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.code = code; }
  }
  return { renderClipFromFile: h.renderMock, ClipRenderError };
});

import { POST } from "./route";

const MINT = "MintAAA";
const RECORD_USAGE = "usage:recordUsage";

function makeReq(body: unknown) {
  return { json: async () => body } as unknown as import("next/server").NextRequest;
}
const baseBody = { sourceUrl: "https://cdn.example/src.mp4", startSeconds: 0, endSeconds: 30 };
const PRICED_OPS = [
  { op: "face_reframe", mode: "auto" },
  { op: "title_card", text: "T", durationSec: 1.5, style: {} },
  { op: "emphasis", kind: "zoom_punch", atSec: 2 },
];
const AMBIGUOUS_OPS = [
  { op: "subtitles", style: {} },
  { op: "text_overlay", text: "HOOK", position: "top", startSec: 0, endSec: 3, style: {} },
  { op: "audio_overlay", audioUrl: "https://x/a.mp3", atSec: 0, gainDb: -16 },
];

/** recordUsage calls the route made, as [name, args] pairs */
const usageCalls = () =>
  h.mutationMock.mock.calls
    .filter((c) => getFunctionName(c[0]) === RECORD_USAGE)
    .map((c) => c[1] as Record<string, unknown>);

/** default: no prior precheck charge for the run (the #23 direct-caller shape) */
let hasRunSkillChargeResult = false;
/** Skill idemKeys "persisted" by recordUsage so far — hasRunSkillCharge reflects
 *  ONLY rows committed before it is queried, exactly like the real DB. This is
 *  what makes the forge test meaningful: if the route queries the proof AFTER its
 *  own charge loop, it sees the loop's fresh rows (the bug); querying BEFORE the
 *  loop sees an empty set (the fix). */
const chargedSkillKeys = new Set<string>();

beforeEach(() => {
  vi.clearAllMocks();
  hasRunSkillChargeResult = false;
  chargedSkillKeys.clear();
  h.authMock.mockResolvedValue({ user: { id: "u1" }, token: "tok", internal: false, provenWallet: "W" });
  h.queryMock.mockImplementation(async (ref: unknown, args: unknown) => {
    switch (getFunctionName(ref as Parameters<typeof getFunctionName>[0])) {
      case "usage:hasRunSkillCharge": {
        if (hasRunSkillChargeResult) return true;
        const prefix = `${(args as { runId?: string })?.runId}:skill:`;
        return [...chargedSkillKeys].some((k) => k.startsWith(prefix));
      }
      default: return { creatorWallet: "W", agentWallet: "wallet123" }; // getByMintServer
    }
  });
  // Default: every skill charge succeeds and is "persisted" (visible to a later query).
  h.mutationMock.mockImplementation(async (ref: unknown, args: unknown) => {
    if (getFunctionName(ref as Parameters<typeof getFunctionName>[0]) === RECORD_USAGE) {
      const k = (args as { idemKey?: string })?.idemKey;
      if (k) chargedSkillKeys.add(k);
      return { ok: true, costUsdc: 0.43 };
    }
    return { ok: true };
  });
  h.meterMock.mockResolvedValue({ ok: true });
  h.fetchBufMock.mockResolvedValue({ buffer: new ArrayBuffer(8) });
  h.renderMock.mockResolvedValue({ clipUrl: "https://cdn.example/clip.mp4", warnings: [] });
});

describe("POST /api/video/clip — #23 billing backstop", () => {
  it("402s a non-internal render of skill-class ops with NO billing identity (the exploit)", async () => {
    const res = await POST(makeReq({ ...baseBody, ops: AMBIGUOUS_OPS }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ ok: false, error: "billing_required" });
    expect(h.renderMock).not.toHaveBeenCalled();
    expect(usageCalls()).toHaveLength(0);
  });

  it("402s priced-derivable ops with NO billing identity too", async () => {
    const res = await POST(makeReq({ ...baseBody, ops: [{ op: "face_reframe" }] }));
    expect(res.status).toBe(402);
    expect(h.renderMock).not.toHaveBeenCalled();
  });

  it("still renders a plain cut (no skill-class ops) without billing — unchanged", async () => {
    const res = await POST(makeReq({
      ...baseBody,
      ops: [{ op: "reframe", mode: "crop" }, { op: "logo_overlay", imageUrl: "https://x/l.png", corner: "tr", opacity: 0.8 }],
    }));
    expect(await res.json()).toMatchObject({ ok: true, clipUrl: "https://cdn.example/clip.mp4" });
    expect(usageCalls()).toHaveLength(0);
    expect(h.meterMock).not.toHaveBeenCalled();
  });

  it("renders a DRAFT (sessionId, no mint) preview free — product decision", async () => {
    const res = await POST(makeReq({
      ...baseBody,
      ops: [...PRICED_OPS, ...AMBIGUOUS_OPS],
      billing: { sessionId: "sess-1", runId: "run-1" },
    }));
    expect(await res.json()).toMatchObject({ ok: true });
    expect(usageCalls()).toHaveLength(0);
    expect(h.meterMock).not.toHaveBeenCalled();
  });

  it("charges exactly the exclusively-derived priced skills with the precheck idemKey (dedup contract)", async () => {
    const res = await POST(makeReq({
      ...baseBody,
      ops: [...PRICED_OPS, ...AMBIGUOUS_OPS, { op: "emphasis", kind: "speed", atSec: 1 }],
      billing: { mintAddress: MINT, runId: "run-1" },
    }));
    expect(await res.json()).toMatchObject({ ok: true });

    const calls = usageCalls();
    const bySkill = Object.fromEntries(calls.map((c) => [c.service, c]));
    expect(Object.keys(bySkill).sort()).toEqual(["clip.facetrack", "clip.title", "clip.zoom"]);
    for (const skillId of ["clip.facetrack", "clip.title", "clip.zoom"]) {
      expect(bySkill[skillId]).toMatchObject({
        mintAddress: MINT,
        service: skillId,
        qty: 1,
        idemKey: `run-1:skill:${skillId}`,
        authSecret: "cron-secret",
      });
    }
    // The $0.40 render fee stays absorbed on the canvas path (no `step`).
    expect(h.meterMock).not.toHaveBeenCalled();
    // Ownership was resolved for the billed mint (non-internal caller).
    expect(h.queryMock).toHaveBeenCalled();
  });

  it("proceeds when the charge is a precheck DUPLICATE (idemKey dedup — no double-charge)", async () => {
    h.mutationMock.mockResolvedValue({ ok: true, costUsdc: 0.43, duplicate: true });
    const res = await POST(makeReq({
      ...baseBody,
      ops: [{ op: "face_reframe" }],
      billing: { mintAddress: MINT, runId: "run-1" },
    }));
    expect(await res.json()).toMatchObject({ ok: true });
    expect(h.renderMock).toHaveBeenCalled();
  });

  it("402s a clean charge DENIAL (needs_funding) before any render work", async () => {
    h.mutationMock.mockResolvedValue({ ok: false, reason: "needs_funding", costUsdc: 0.43 });
    const res = await POST(makeReq({
      ...baseBody,
      ops: [{ op: "face_reframe" }],
      billing: { mintAddress: MINT, runId: "run-1" },
    }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ ok: false, error: "needs_funding" });
    expect(h.renderMock).not.toHaveBeenCalled();
    expect(h.fetchBufMock).not.toHaveBeenCalled();
  });

  it("503s FAIL-CLOSED when the charge throws (cannot prove the priced skill was metered)", async () => {
    h.mutationMock.mockRejectedValue(new Error("convex down"));
    const res = await POST(makeReq({
      ...baseBody,
      ops: [{ op: "face_reframe" }],
      billing: { mintAddress: MINT, runId: "run-1" },
    }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "billing_unavailable" });
    expect(h.renderMock).not.toHaveBeenCalled();
  });

  it("still charges without a runId (direct caller) — just without an idemKey", async () => {
    const res = await POST(makeReq({
      ...baseBody,
      ops: [{ op: "face_reframe" }],
      billing: { mintAddress: MINT },
    }));
    expect(await res.json()).toMatchObject({ ok: true });
    const calls = usageCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].service).toBe("clip.facetrack");
    expect(calls[0].idemKey).toMatch(/^clip:.*:skill:/);
  });

  it("lets INTERNAL callers render without billing (cloud path bills separately)", async () => {
    h.authMock.mockResolvedValue({ internal: true });
    const res = await POST(makeReq({ ...baseBody, ops: [...PRICED_OPS, ...AMBIGUOUS_OPS] }));
    expect(await res.json()).toMatchObject({ ok: true });
    expect(usageCalls()).toHaveLength(0);
  });

  it("preserves the legacy billing.step render meter AND adds the skill charges", async () => {
    const res = await POST(makeReq({
      ...baseBody,
      ops: [{ op: "face_reframe" }],
      billing: { mintAddress: MINT, runId: "run-1", step: "cut" },
    }));
    expect(await res.json()).toMatchObject({ ok: true });
    expect(h.meterMock).toHaveBeenCalledWith(MINT, "render", 1, "run-1:cut");
    expect(usageCalls().map((c) => c.service)).toEqual(["clip.facetrack"]);
  });

  // #23 review finding (MEDIUM): a clean per-skill denial at RENDER must not turn
  // a documented run-start under-charge into a paid-then-zero-clips pool abort —
  // BUT only when there's proof precheck already ran for this run (else it's the
  // #23 direct-caller shape and must stay blocked).
  it("BLOCKS on a clean daily_cap denial when another skill deduped (genuine precheck dedup hit)", async () => {
    // No pre-existing proof (hasRunSkillCharge snapshot = false), but one skill
    // returns duplicate:true — a genuine idempotency dedup that only happens when
    // precheck already charged it at run-start. That dedup alone proves precheck ran.
    hasRunSkillChargeResult = false;
    h.mutationMock.mockImplementation(async (_ref, args: { service: string }) =>
      args.service === "clip.facetrack"
        ? { ok: true, costUsdc: 0.43, duplicate: true }  // precheck already charged this one
        : { ok: false, reason: "daily_cap", costUsdc: 0.12 }); // sibling denied on the cap race
    const res = await POST(makeReq({
      ...baseBody,
      ops: [{ op: "face_reframe" }, { op: "title_card", text: "T", durationSec: 1.5, style: {} }],
      billing: { mintAddress: MINT, runId: "run-1" },
    }));
    expect(await res.json()).toMatchObject({ ok: false });
    expect(h.renderMock).not.toHaveBeenCalled();
  });

  it("BLOCKS on a clean daily_cap denial when hasRunSkillCharge proves precheck ran", async () => {
    hasRunSkillChargeResult = true;
    h.mutationMock.mockResolvedValue({ ok: false, reason: "daily_cap", costUsdc: 0.43 });
    const res = await POST(makeReq({
      ...baseBody,
      ops: [{ op: "face_reframe" }],
      billing: { mintAddress: MINT, runId: "run-1" },
    }));
    expect(await res.json()).toMatchObject({ ok: false });
    expect(h.renderMock).not.toHaveBeenCalled();
  });

  it("BLOCKS on a mid-run needs_funding denial when precheck ran (funds dropped after run-start)", async () => {
    hasRunSkillChargeResult = true;
    h.mutationMock.mockResolvedValue({ ok: false, reason: "needs_funding", costUsdc: 0.43 });
    const res = await POST(makeReq({
      ...baseBody,
      ops: [{ op: "face_reframe" }],
      billing: { mintAddress: MINT, runId: "run-1" },
    }));
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("STILL 402s a clean daily_cap denial when there is NO precheck proof (#23 direct caller)", async () => {
    hasRunSkillChargeResult = false;
    h.mutationMock.mockResolvedValue({ ok: false, reason: "daily_cap", costUsdc: 0.43 });
    const res = await POST(makeReq({
      ...baseBody,
      ops: [{ op: "face_reframe" }],
      billing: { mintAddress: MINT, runId: "run-1" },
    }));
    expect(res.status).toBe(402);
    expect(h.renderMock).not.toHaveBeenCalled();
  });

  it("does NOT forge the precheck proof from its OWN in-loop charges (multi-skill direct caller)", async () => {
    // The #23-forge exploit: a direct caller (NO precheck) funds only the cheapest
    // skill. The loop charges clip.filters ($0.15, persists a row) then clip.facetrack
    // ($0.43) denies. If the proof is checked AFTER the loop, hasRunSkillCharge sees
    // the fresh clip.filters row and forges "precheck ran" → renders the $0.43 vision
    // work free. The proof MUST be snapshotted before the loop → this stays a 402.
    hasRunSkillChargeResult = false;
    let n = 0;
    h.mutationMock.mockImplementation(async (ref: unknown, args: unknown) => {
      if (getFunctionName(ref as Parameters<typeof getFunctionName>[0]) !== RECORD_USAGE) return { ok: true };
      n += 1;
      const k = (args as { idemKey?: string })?.idemKey;
      if (n === 1) { if (k) chargedSkillKeys.add(k); return { ok: true, costUsdc: 0.15 }; }
      return { ok: false, reason: "needs_funding", costUsdc: 0.43 };
    });
    const res = await POST(makeReq({
      ...baseBody,
      ops: [{ op: "color_filter", preset: "warm" }, { op: "face_reframe" }],
      billing: { mintAddress: MINT, runId: "run-1" },
    }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ ok: false, error: "needs_funding" });
    expect(h.renderMock).not.toHaveBeenCalled();
  });

  it("ALWAYS 402s a suspended agent even with precheck proof (never render for suspended)", async () => {
    hasRunSkillChargeResult = true;
    h.mutationMock.mockResolvedValue({ ok: false, reason: "suspended" });
    const res = await POST(makeReq({
      ...baseBody,
      ops: [{ op: "face_reframe" }],
      billing: { mintAddress: MINT, runId: "run-1" },
    }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ ok: false, error: "suspended" });
    expect(h.renderMock).not.toHaveBeenCalled();
  });
});
