// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Regression for BUG-025 (P0): hire-generate must VERIFY the claimed on-chain
// payment before forwarding to run-task (skipBalanceCheck:true) and crediting the
// agent's earnings. Trusting the body alone let any signed-in user farm free KIE
// renders + inject fabricated earnings. The route now mirrors campaigns/topup,
// market/buy-shares and nft/mint: verifyUsdcDeposit (real transfer, correct
// destination, ≥ price, funded by the SIWS-proven caller) + single-use consume.
//
// The route wires auth + Convex + verifyUsdcDeposit + a self-call to run-task; we
// mock those so a request deterministically reaches (or is blocked before) the gate.

// Auth: configurable per test. Default = a signed-in user with a SIWS-proven wallet.
const authState = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: { user: { id: "did:test" }, token: "t", internal: false, provenWallet: "PAYER_WALLET" } as any,
}));
vi.mock("@/lib/server/requireAuth", () => ({
  requireInternalOrUserAuth: vi.fn(async () => authState.result),
  siwsRequiredResponse: () =>
    new Response(JSON.stringify({ error: "Wallet sign-in required", code: "siws_required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
}));

// verifyUsdcDeposit: capture args so we can assert the gate targets the PAID wallet
// and binds the deposit to the proven caller; toggle a throw to simulate a bad tx.
const verifyState = vi.hoisted(() => ({
  shouldThrow: false,
  error: "deposit tx not found / not confirmed",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lastArgs: null as any,
}));
vi.mock("@/lib/trader/verifyUsdcDeposit", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verifyUsdcDeposit: vi.fn(async (a: any) => {
    verifyState.lastArgs = a;
    if (verifyState.shouldThrow) throw new Error(verifyState.error);
    return { creditedUsdc: a.minAmountUsdc };
  }),
}));

// Convex: getByMint → agent doc; consumeHireSignature / recordHireEarning captured.
const convexState = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: { name: "A", niche: "n", creatorWallet: "CREATOR", agentWallet: "AGENT_WALLET", monetization: { costPerVideo: 1 } } as any,
  consumeThrows: false,
  // # of leading recordHireEarning attempts that should throw (transient-failure sim).
  recordFailuresRemaining: 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  calls: { query: [] as any[], mutation: [] as any[] },
}));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn().mockImplementation(() => ({
    query: vi.fn(async (_ref: unknown, args: unknown) => {
      convexState.calls.query.push(args);
      return convexState.agent;
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutation: vi.fn(async (_ref: unknown, args: any) => {
      convexState.calls.mutation.push(args);
      // consumeHireSignature carries txSignature (+usdc) and NO hireKey.
      if (args && args.txSignature !== undefined && args.hireKey === undefined) {
        if (convexState.consumeThrows) throw new Error("Transaction already processed");
        return { ok: true };
      }
      // recordHireEarning — optionally fail the leading N attempts (transient blip).
      if (args && args.hireKey !== undefined && convexState.recordFailuresRemaining > 0) {
        convexState.recordFailuresRemaining--;
        throw new Error("convex transient error");
      }
      return undefined;
    }),
  })),
}));

// The self-call to /api/agents/run-task — count invocations to prove a render is
// only kicked off AFTER the payment gate passes.
const runTask = vi.hoisted(() => ({ calls: 0, status: 200, body: { ok: true, taskId: "task_1" } as unknown }));
vi.mock("@/lib/server/fetchInternal", () => ({
  fetchSelf: vi.fn(async () => {
    runTask.calls++;
    return new Response(JSON.stringify(runTask.body), {
      status: runTask.status,
      headers: { "content-type": "application/json" },
    });
  }),
}));

import { NextRequest } from "next/server";

type RouteModule = { POST: (req: NextRequest) => Promise<Response> };

async function loadPOST(): Promise<RouteModule["POST"]> {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://convex.test";
  process.env.INTERNAL_CRON_SECRET = "secret";
  delete process.env.NEXT_PUBLIC_USDC_MINT; // fall back to getUsdcMint() (devnet)
  delete process.env.KIE_API_KEY; // description-only body → no KIE/scrape fetches
  vi.resetModules();
  const mod = (await import("./route")) as RouteModule;
  return mod.POST;
}

const makeReq = (body: unknown) =>
  new NextRequest("https://vello.gg/api/agents/hire-generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const consumeCall = () =>
  convexState.calls.mutation.find((m) => m && m.txSignature !== undefined && m.hireKey === undefined);
const recordCall = () => convexState.calls.mutation.find((m) => m && m.hireKey !== undefined);

beforeEach(() => {
  authState.result = { user: { id: "did:test" }, token: "t", internal: false, provenWallet: "PAYER_WALLET" };
  convexState.agent = { name: "A", niche: "n", creatorWallet: "CREATOR", agentWallet: "AGENT_WALLET", monetization: { costPerVideo: 1 } };
  convexState.consumeThrows = false;
  convexState.recordFailuresRemaining = 0;
  convexState.calls = { query: [], mutation: [] };
  verifyState.shouldThrow = false;
  verifyState.lastArgs = null;
  runTask.calls = 0;
  runTask.status = 200;
  runTask.body = { ok: true, taskId: "task_1" };
  // Guard: any un-mocked network call fails loudly.
  vi.stubGlobal("fetch", vi.fn(async (u: unknown) => { throw new Error(`unexpected fetch ${String(u)}`); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("hire-generate — payment gate (BUG-025)", () => {
  it("rejects a hire with NO payment signature (402) and never renders or credits", async () => {
    const POST = await loadPOST();
    const res = await POST(makeReq({ mint: "M", description: "make a video" }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/payment signature/i);
    expect(runTask.calls).toBe(0);
    expect(convexState.calls.mutation.length).toBe(0);
  });

  it("rejects when the on-chain deposit can't be verified (402) and never renders", async () => {
    verifyState.shouldThrow = true;
    const POST = await loadPOST();
    const res = await POST(makeReq({ mint: "M", description: "x", txSignature: "SIG" }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/not verified/i);
    expect(runTask.calls).toBe(0);
    expect(consumeCall()).toBeUndefined();
  });

  it("requires a SIWS-proven wallet (401 siws_required) when none is present", async () => {
    authState.result = { user: { id: "did:test" }, token: "t", internal: false, provenWallet: undefined };
    const POST = await loadPOST();
    const res = await POST(makeReq({ mint: "M", description: "x", txSignature: "SIG" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("siws_required");
    expect(runTask.calls).toBe(0);
  });

  it("rejects a REPLAYED payment signature (402) — one payment can't farm two renders", async () => {
    convexState.consumeThrows = true;
    const POST = await loadPOST();
    const res = await POST(makeReq({ mint: "M", description: "x", txSignature: "SIG" }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/already used/i);
    expect(runTask.calls).toBe(0); // consumed-check fails BEFORE the render kicks off
  });

  it("verifies against the PAID wallet + the proven caller, then renders + records earnings", async () => {
    const POST = await loadPOST();
    const res = await POST(makeReq({ mint: "M", description: "x", txSignature: "SIG" }));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok?: boolean; taskId?: string };
    expect(j.ok).toBe(true);
    expect(j.taskId).toBe("task_1");
    // gate targeted the agent's wallet, required ≥ price, bound to the proven caller
    expect(verifyState.lastArgs).toMatchObject({
      txSignature: "SIG",
      escrowOwner: "AGENT_WALLET",
      minAmountUsdc: 1,
      expectedSender: "PAYER_WALLET",
    });
    // single-use consume happened, and the render + earnings credit followed
    expect(consumeCall()).toMatchObject({ mintAddress: "M", txSignature: "SIG", usdc: 1 });
    expect(runTask.calls).toBe(1);
    expect(recordCall()).toMatchObject({ mintAddress: "M", usdc: 1 });
  });

  it("falls back to the creatorWallet as the paid wallet when the agent has none", async () => {
    convexState.agent = { name: "A", niche: "n", creatorWallet: "CREATOR", agentWallet: undefined, monetization: { costPerVideo: 2 } };
    const POST = await loadPOST();
    const res = await POST(makeReq({ mint: "M", description: "x", txSignature: "SIG" }));
    expect(res.status).toBe(200);
    expect(verifyState.lastArgs).toMatchObject({ escrowOwner: "CREATOR", minAmountUsdc: 2 });
  });

  it("internal (cron/autonomy) callers are pre-trusted — skip the payment gate", async () => {
    authState.result = { internal: true };
    const POST = await loadPOST();
    const res = await POST(makeReq({ mint: "M", description: "x" })); // no signature
    expect(res.status).toBe(200);
    expect(runTask.calls).toBe(1);
    expect(verifyState.lastArgs).toBeNull(); // verifyUsdcDeposit not called
    expect(consumeCall()).toBeUndefined();
  });
});

describe("hire-generate — durable earnings credit (BUG-034)", () => {
  it("retries recordHireEarning past a transient failure so the credit isn't silently dropped", async () => {
    convexState.recordFailuresRemaining = 1; // first credit attempt throws, retry succeeds
    const POST = await loadPOST();
    const res = await POST(makeReq({ mint: "M", description: "x", txSignature: "SIG" }));
    // Request still succeeds (payment + render already went through) …
    expect(res.status).toBe(200);
    // … and the earnings credit was retried (1 fail + 1 success), not dropped.
    const recordAttempts = convexState.calls.mutation.filter((m) => m && m.hireKey !== undefined);
    expect(recordAttempts.length).toBe(2);
  });
});
