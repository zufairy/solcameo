// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Regression for BUG-026 (H02/H04, P0 fund-loss) ──────────────────────────────
// agents/delete used to read the agent's on-chain USDC via the LENIENT
// getUsdcBalance, which collapses ANY RPC failure (Helius 429 / timeout / socket
// drop — a documented condition for this deployment) to $0. On such a false-zero it
// SKIPPED the promised pre-delete refund and then irreversibly wiped the ONLY copy
// of agentWalletSecret (convex deleteByMint) — permanently stranding real USDC.
//
// The fix swaps to the STRICT getUsdcBalanceStrict, which returns null on an
// UNKNOWN read (vs 0 for a CONFIRMED-missing token account) and ABORTS the delete
// on null. These tests pin: read-failure → abort (no wipe), confirmed-zero →
// proceed. deleteByMint is the route's only convex.mutation, so "mutation not
// called" == "wallet secret NOT wiped".

// Internal-secret auth → skip SIWS/ownership entirely.
vi.mock("@/lib/server/requireAuth", () => ({
  requireInternalOrUserAuth: vi.fn(async () => ({ internal: true })),
  requireOwnerWithSiws: vi.fn(() => null),
}));

// Controllable on-chain read + transfer. Hoisted so the spies are shared with the
// mock factory below (same pattern as transcribe-clip/route.test.ts).
const { getUsdcBalanceStrict, transferUsdc } = vi.hoisted(() => ({
  getUsdcBalanceStrict: vi.fn(),
  transferUsdc: vi.fn(),
}));
vi.mock("@/lib/trader/usdcTransfer", () => ({ getUsdcBalanceStrict, transferUsdc }));

// Convex client: query() returns the agent doc; mutation() is deleteByMint (the
// irreversible wipe) — the route's ONLY mutation call, so we assert on it directly.
const { queryMock, mutationMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  mutationMock: vi.fn(),
}));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = queryMock;
    mutation = mutationMock;
  },
}));

// Reference the api function handles the route dispatches on (mocked client ignores them).
vi.mock("@/convex/_generated/api", () => ({
  api: { influencers: { getByMintServer: "getByMintServer", deleteByMint: "deleteByMint" }, mintFee: { accountIdentity: "accountIdentity" } },
}));

// Profile-slot free: not configured → skipped.
vi.mock("@/lib/server/uploadPost", () => ({
  isConfigured: () => false,
  resolveUsername: () => null,
  deleteProfile: vi.fn(async () => ({ ok: true })),
}));

// Decrypt is only reached on the positive-balance refund path.
vi.mock("@/lib/server/walletCrypto", () => ({
  decryptWalletSecret: vi.fn(() => "ZmFrZQ=="), // base64("fake")
}));

import { NextRequest, NextResponse } from "next/server";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { POST } from "./route";

const AGENT = {
  mintAddress: "MINT123",
  creatorWallet: "OwnerWa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  agentWallet: "AgentWa11etBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  agentWalletSecret: "encrypted-secret-blob",
};

const makeReq = (body: unknown) =>
  new NextRequest("https://vello.gg/api/agents/delete", {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": "s" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.INTERNAL_CRON_SECRET = "s";
  vi.mocked(requireInternalOrUserAuth).mockResolvedValue({ internal: true });
  vi.mocked(requireOwnerWithSiws).mockReset();
  vi.mocked(requireOwnerWithSiws).mockReturnValue(null);
  queryMock.mockReset();
  queryMock.mockResolvedValue(AGENT);
  mutationMock.mockReset();
  mutationMock.mockResolvedValue({ ok: true, deleted: 1 });
  transferUsdc.mockReset();
  transferUsdc.mockResolvedValue({ ok: true, txSignature: "sig123" });
  getUsdcBalanceStrict.mockReset();
});

describe("agents/delete — abort on RPC balance-read failure (BUG-026)", () => {
  it("ABORTS (503, retriable) when the STRICT read is UNKNOWN (null) — wallet secret is NOT wiped", async () => {
    getUsdcBalanceStrict.mockResolvedValue(null); // RPC 429/timeout → UNKNOWN, must NOT be treated as 0

    const res = await POST(makeReq({ mintAddress: "MINT123" }));

    expect(res.status).toBe(503);
    const j = (await res.json()) as { ok: boolean; retriable?: boolean };
    expect(j.ok).toBe(false);
    expect(j.retriable).toBe(true);
    // The irreversible delete (only convex.mutation) must NOT have run.
    expect(mutationMock).not.toHaveBeenCalled();
    // And no blind refund was attempted against an unknown balance.
    expect(transferUsdc).not.toHaveBeenCalled();
  });

  it("ABORTS (503) when the strict read THROWS — also UNKNOWN, never coerced to 0", async () => {
    getUsdcBalanceStrict.mockRejectedValue(new Error("socket hang up"));

    const res = await POST(makeReq({ mintAddress: "MINT123" }));

    expect(res.status).toBe(503);
    expect(mutationMock).not.toHaveBeenCalled();
    expect(transferUsdc).not.toHaveBeenCalled();
  });

  it("PROCEEDS with the delete on a CONFIRMED zero balance (no refund needed)", async () => {
    getUsdcBalanceStrict.mockResolvedValue(0); // TokenAccountNotFound → genuine 0

    const res = await POST(makeReq({ mintAddress: "MINT123" }));

    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; deleted: number; refund: { attempted: boolean } };
    expect(j.ok).toBe(true);
    expect(j.deleted).toBe(1);
    expect(j.refund.attempted).toBe(false); // confirmed-zero: nothing to refund
    expect(transferUsdc).not.toHaveBeenCalled();
    expect(mutationMock).toHaveBeenCalledTimes(1); // delete DID run
  });

  it("REFUNDS to the owner then deletes on a positive confirmed balance", async () => {
    getUsdcBalanceStrict.mockResolvedValue(3.5);

    const res = await POST(makeReq({ mintAddress: "MINT123" }));

    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; refund: { attempted: boolean; amountUsdc: number } };
    expect(j.ok).toBe(true);
    expect(transferUsdc).toHaveBeenCalledTimes(1);
    const arg = (transferUsdc.mock.calls[0] as unknown[])[0] as { amountUsdc: number; toPubkey: string };
    expect(arg.amountUsdc).toBe(3.5);
    expect(arg.toPubkey).toBe(AGENT.creatorWallet); // refund goes to the OWNER
    expect(mutationMock).toHaveBeenCalledTimes(1); // delete only AFTER successful refund
    expect(j.refund.attempted).toBe(true);
    expect(j.refund.amountUsdc).toBe(3.5);
  });
});

it("allows deletion of an older wallet's agent for the same signed-in account", async () => {
  const auth = { internal: false as const, user: { id: "owner", walletAddresses: ["current"] }, token: "token", provenWallet: "current" };
  vi.mocked(requireInternalOrUserAuth).mockResolvedValue(auth);
  queryMock.mockResolvedValueOnce(AGENT).mockResolvedValueOnce({ wallets: ["current", AGENT.creatorWallet] });
  getUsdcBalanceStrict.mockResolvedValue(0);
  expect((await POST(makeReq({ mintAddress: "MINT123" }))).status).toBe(200);
  expect(requireOwnerWithSiws).toHaveBeenCalledWith(auth, ["current"]);
  expect(mutationMock).toHaveBeenCalledTimes(1);
});

it("rejects deletion when the agent wallet is not linked to the caller", async () => {
  vi.mocked(requireInternalOrUserAuth).mockResolvedValue({ internal: false, user: { id: "other" }, token: "token", provenWallet: "other-wallet" });
  queryMock.mockResolvedValueOnce(AGENT).mockResolvedValueOnce({ wallets: ["other-wallet"] });
  vi.mocked(requireOwnerWithSiws).mockReturnValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
  expect((await POST(makeReq({ mintAddress: "MINT123" }))).status).toBe(403);
  expect(getUsdcBalanceStrict).not.toHaveBeenCalled();
  expect(mutationMock).not.toHaveBeenCalled();
});

it("preserves the agent when refund transfer fails", async () => {
  getUsdcBalanceStrict.mockResolvedValue(3.5);
  transferUsdc.mockResolvedValue({ ok: false, error: "transfer failed" });
  expect((await POST(makeReq({ mintAddress: "MINT123" }))).status).toBe(502);
  expect(mutationMock).not.toHaveBeenCalled();
});
