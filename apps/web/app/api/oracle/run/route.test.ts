// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getFunctionName } from "convex/server";

/**
 * Orchestration test for the /api/oracle/run worker tick.
 *
 * The route is thin IO glue around the PURE scorer (`scoreSubmission`, exercised
 * directly in oracleFraud's own tests). Here we mock only the boundaries —
 * Convex (`ConvexHttpClient`) and upload-post (`getPostAnalytics`) — and assert
 * the decision→action wiring: approved → settleFromOracle, manual_review →
 * markForReview, defer/error → neither. The real `api` proxy is imported so we
 * can dispatch the captured `.query`/`.mutation` calls by function reference.
 */

const SECRET = "cron-secret-xyz";
const CONVEX_URL = "https://example.convex.cloud";

// ── Convex client mock ───────────────────────────────────────────────────────
// One shared spy set the route's `new ConvexHttpClient()` resolves to, so the
// test can program query results and capture mutation calls.
const queryMock = vi.fn();
const mutationMock = vi.fn();
vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn().mockImplementation(() => ({
    query: queryMock,
    mutation: mutationMock,
  })),
}));

// ── upload-post analytics mock (keep resolveUsername real) ───────────────────
const getPostAnalyticsMock = vi.fn();
vi.mock("@/lib/server/uploadPost", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/uploadPost")>();
  return { ...actual, getPostAnalytics: getPostAnalyticsMock };
});

// Dispatch captured Convex calls by their stable function NAME (e.g.
// "submissions:dueForVerification"). `vi.resetModules()` gives the route a fresh
// `api` proxy each test, so reference identity is unreliable — but getFunctionName
// is stable across instances. (Generated `api` is a runtime proxy; never run codegen.)
const DUE = "submissions:dueForVerification";
const PEERS = "submissions:peersForVerification";
const REATTEST = "submissions:dueForReattest";
const SETTLE = "oracle:settleFromOracle";
const REVIEW = "oracle:markForReview";

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://app.local/api/oracle/run", { method: "POST", headers });
}

/** Program `queryMock` to answer the route queries by function name. */
function programQueries(opts: { due: unknown[]; peers?: unknown[]; reattest?: unknown[] }) {
  queryMock.mockImplementation(async (fnRef: unknown) => {
    const name = getFunctionName(fnRef as Parameters<typeof getFunctionName>[0]);
    if (name === DUE) return opts.due;
    if (name === PEERS) return opts.peers ?? [];
    if (name === REATTEST) return opts.reattest ?? [];
    throw new Error(`unexpected query: ${name}`);
  });
}

/** Find the captured mutation call for a given function name. */
function mutationCallFor(name: string): Record<string, unknown> | undefined {
  const call = mutationMock.mock.calls.find(
    (c) => getFunctionName(c[0] as Parameters<typeof getFunctionName>[0]) === name,
  );
  return call?.[1] as Record<string, unknown> | undefined;
}

async function importRoute() {
  return await import("./route");
}

describe("/api/oracle/run orchestration", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
    mutationMock.mockReset();
    mutationMock.mockResolvedValue({ ok: true });
    getPostAnalyticsMock.mockReset();
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", CONVEX_URL);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("(a) 401 when the internal secret header is missing or wrong", async () => {
    const { POST } = await importRoute();

    const noHeader = await POST(makeReq());
    expect(noHeader.status).toBe(401);

    const wrongHeader = await POST(makeReq({ "X-Internal-Secret": "nope" }));
    expect(wrongHeader.status).toBe(401);

    // Never reached Convex.
    expect(queryMock).not.toHaveBeenCalled();
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it("(b) an approved analytics result → settleFromOracle with the right id/decision/viewCount", async () => {
    programQueries({
      due: [
        {
          _id: "sub_approved",
          creationTimeMs: 0,
          campaignId: "camp_1",
          influencerMint: "MintA",
          submitterWallet: "WalletA",
          platform: "tiktok",
          postUrl: "https://tiktok.com/@a/video/1",
          uploadPostRequestId: null,
          platformPostId: "tt_1",
          postedAt: 0, // matured long ago
          // v1 / legacy: never enters the on-chain branch (no VELLO_ORACLE_SECRET set
          // in the test env either), so settleFromOracle is called exactly as before.
          onchainVersion: null,
          creatorWallet: null,
          agentWallet: null,
        },
      ],
      peers: [],
    });
    // Real views + healthy engagement on a non-proxy platform → scorer approves.
    getPostAnalyticsMock.mockResolvedValue({
      ok: true,
      metrics: { views: 40_000, likes: 800 },
      platformPostId: "tt_1",
    });

    const { POST } = await importRoute();
    const res = await POST(makeReq({ "X-Internal-Secret": SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, settled: 1, manualReview: 0, deferred: 0 });

    const settle = mutationCallFor(SETTLE);
    expect(settle).toBeDefined();
    expect(settle).toMatchObject({
      authSecret: SECRET,
      submissionId: "sub_approved",
      decision: "approved",
      viewCount: 40_000,
    });
    // No review path was taken.
    expect(mutationCallFor(REVIEW)).toBeUndefined();
  });

  it("(b2) a v2 row WITHOUT the oracle key is SKIPPED — never settled (would strand via neither rail)", async () => {
    // VELLO_ORACLE_SECRET is NOT stubbed in this suite, so the on-chain rail is
    // unusable. A v2 row must NOT fall through to settleFromOracle (that mirror-
    // settle skips distributions.dispatch AND, with no attestationTx, never enters
    // dueForClaim → pays via NEITHER rail). It must be skipped so it retries.
    programQueries({
      due: [
        {
          _id: "sub_v2_nokey",
          creationTimeMs: 0,
          campaignId: "camp_v2",
          influencerMint: "MintV2",
          submitterWallet: "WalletV2",
          platform: "tiktok",
          postUrl: "https://tiktok.com/@a/video/1",
          uploadPostRequestId: null,
          platformPostId: "tt_v2",
          postedAt: 0, // matured
          onchainVersion: 2, // v2 campaign
          creatorWallet: "CreatorV2",
          agentWallet: "AgentV2",
        },
      ],
      peers: [],
    });
    getPostAnalyticsMock.mockResolvedValue({
      ok: true,
      metrics: { views: 40_000, likes: 800 },
      platformPostId: "tt_v2",
    });

    const { POST } = await importRoute();
    const res = await POST(makeReq({ "X-Internal-Secret": SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Counted as a skip, NOT settled.
    expect(body).toMatchObject({ ok: true, settled: 0, skippedV2: 1 });

    // The crucial assertion: NO settleFromOracle mutation for the v2-no-key row.
    expect(mutationCallFor(SETTLE)).toBeUndefined();
    // And no review either — it stays in dueForVerification to retry next tick.
    expect(mutationCallFor(REVIEW)).toBeUndefined();
  });

  it("(c) a manual_review result (facebook reach-only) → markForReview, NOT settleFromOracle", async () => {
    programQueries({
      due: [
        {
          _id: "sub_review",
          creationTimeMs: 0,
          campaignId: "camp_1",
          influencerMint: "MintB",
          submitterWallet: "WalletB",
          platform: "facebook",
          postUrl: "https://facebook.com/x/posts/1",
          uploadPostRequestId: null,
          platformPostId: "fb_1",
          postedAt: 0, // matured
          onchainVersion: null,
          creatorWallet: null,
          agentWallet: null,
        },
      ],
      peers: [],
    });
    // Facebook resolves a PROXY metric (reach) → scorer returns manual_review.
    getPostAnalyticsMock.mockResolvedValue({
      ok: true,
      metrics: { reach: 50_000 },
      platformPostId: "fb_1",
    });

    const { POST } = await importRoute();
    const res = await POST(makeReq({ "X-Internal-Secret": SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, settled: 0, manualReview: 1 });

    const review = mutationCallFor(REVIEW);
    expect(review).toBeDefined();
    expect(review).toMatchObject({ authSecret: SECRET, submissionId: "sub_review" });
    // Crucially: NEVER settled (no auto-payout for a proxy metric).
    expect(mutationCallFor(SETTLE)).toBeUndefined();
  });

  it("(d) an error/not_ready analytics result → neither settle nor review (deferred)", async () => {
    const now = Date.now();
    programQueries({
      due: [
        {
          _id: "sub_defer",
          creationTimeMs: now - 3_600_000,
          campaignId: "camp_1",
          influencerMint: "MintC",
          submitterWallet: "WalletC",
          platform: "tiktok",
          postUrl: null,
          uploadPostRequestId: "req_c",
          platformPostId: null,
          postedAt: now - 3_600_000, // 1h ago: within the settle deadline → defer, not stale
          onchainVersion: null,
          creatorWallet: null,
          agentWallet: null,
        },
      ],
      peers: [],
    });
    // Analytics not yet available and the post is fresh → scorer defers.
    getPostAnalyticsMock.mockResolvedValue({ ok: false, reason: "error" });

    const { POST } = await importRoute();
    const res = await POST(makeReq({ "X-Internal-Secret": SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, settled: 0, manualReview: 0, deferred: 1 });

    // No write-back of any kind on a deferral.
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it("memoizes peers by campaignId — fetched once across due rows of the same campaign", async () => {
    const mkDue = (id: string, postId: string) => ({
      _id: id,
      creationTimeMs: 0,
      campaignId: "camp_shared",
      influencerMint: "MintX",
      submitterWallet: "WalletX",
      platform: "tiktok",
      postUrl: null,
      uploadPostRequestId: null,
      platformPostId: postId,
      postedAt: 0,
      onchainVersion: null,
      creatorWallet: null,
      agentWallet: null,
    });
    programQueries({ due: [mkDue("s1", "tt_a"), mkDue("s2", "tt_b")], peers: [] });
    getPostAnalyticsMock.mockResolvedValue({ ok: true, metrics: { views: 40_000, likes: 800 }, platformPostId: "tt_a" });

    const { POST } = await importRoute();
    const res = await POST(makeReq({ "X-Internal-Secret": SECRET }));
    expect(res.status).toBe(200);

    const peerCalls = queryMock.mock.calls.filter(
      (c) => getFunctionName(c[0] as Parameters<typeof getFunctionName>[0]) === PEERS,
    );
    expect(peerCalls).toHaveLength(1); // two due rows, ONE peer fetch (cached)
  });
});
