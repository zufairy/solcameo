// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import {
  e2eBypassFromRequest,
  getProvenWalletFromRequest,
  requireAuth,
  requireInternalOrUserAuth,
  requireOwnerWithSiws,
  type AuthUser,
} from "./requireAuth";

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY PROOF for the dev-only E2E_AUTH_BYPASS test-auth seam.
//
// The seam lets Playwright authenticate money/agent/wallet routes without a real
// Privy login — but it MUST be impossible to activate in production. These tests
// assert the four security properties from the brief:
//   1. dev + flag + correct secret header ⇒ requireOwnerWithSiws PASSES (provenWallet===W)
//   2. NODE_ENV="production" + identical headers ⇒ REJECTED (fail-closed) — CRITICAL
//   3. wrong / missing secret (dev) ⇒ REJECTED
//   4. flag unset ⇒ REJECTED (real path unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const SECRET = "e2e-secret-abcdefghijklmnopqrstuvwxyz-0123456789";
const WALLET = "E2eWa11etAddre55PubKeyBase58xxxxxxxxxxxxxxx";
const DID = "did:privy:e2e-user-123";

/** A NextRequest stand-in that only needs `.headers.get(...)` (all the seam reads). */
function makeReq(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

/** The full set of headers a passing E2E-bypass request carries. */
function bypassHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "X-E2E-Bypass": SECRET,
    "X-E2E-Wallet": WALLET,
    "X-E2E-Did": DID,
    ...overrides,
  };
}

describe("requireAuth — E2E_AUTH_BYPASS seam (security proof)", () => {
  const env = process.env as Record<string, string | undefined>;
  const prev = {
    NODE_ENV: env.NODE_ENV,
    E2E_AUTH_BYPASS: env.E2E_AUTH_BYPASS,
    E2E_AUTH_BYPASS_SECRET: env.E2E_AUTH_BYPASS_SECRET,
    INTERNAL_CRON_SECRET: env.INTERNAL_CRON_SECRET,
  };

  beforeEach(() => {
    // Default: dev + flag on + non-empty secret (the "bypass armed" baseline).
    env.NODE_ENV = "development";
    env.E2E_AUTH_BYPASS = "1";
    env.E2E_AUTH_BYPASS_SECRET = SECRET;
    delete env.INTERNAL_CRON_SECRET; // ensure no accidental internal-secret path
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  });

  // ── 1. Bypass works in dev with the correct secret → provenWallet resolves ──
  it("dev + flag + correct secret ⇒ requireOwnerWithSiws PASSES for the injected wallet", async () => {
    const req = makeReq(bypassHeaders());

    const auth = await requireInternalOrUserAuth(req);
    expect("error" in auth && auth.error).toBeFalsy();
    if (auth.error || auth.internal) throw new Error("expected a user auth result");

    // The synthetic identity is exactly what the headers named.
    expect(auth.user.id).toBe(DID);
    expect(auth.provenWallet).toBe(WALLET); // ← SIWS/provenWallet chain satisfied

    // The ownership gate a money route runs must PASS for that wallet.
    expect(requireOwnerWithSiws(auth, WALLET)).toBeNull();
    // …and still REJECT a different owner (bypass ≠ own-everything).
    expect(requireOwnerWithSiws(auth, "SomeOtherOwnerWallet")).not.toBeNull();
  });

  it("falls back to a fixed test DID when X-E2E-Did is omitted", () => {
    const e2e = e2eBypassFromRequest(makeReq(bypassHeaders({ "X-E2E-Did": "" })));
    expect(e2e).toEqual({ userId: "did:e2e:test", wallet: WALLET });
  });

  // ── 2. CRITICAL: identical request under production is REJECTED (fail-closed) ──
  it("NODE_ENV=production + identical headers ⇒ REJECTED (fail-closed)", async () => {
    env.NODE_ENV = "production";
    const req = makeReq(bypassHeaders());

    // The gate itself must yield nothing in prod…
    expect(e2eBypassFromRequest(req)).toBeNull();

    // …requireAuth must NOT synthesize a user (no Bearer ⇒ 401)…
    const bare = await requireAuth(req);
    expect(bare.error?.status).toBe(401);
    expect(bare.user).toBeUndefined();

    // …and the money-route entry point rejects with no user / no provenWallet.
    const auth = await requireInternalOrUserAuth(req);
    expect(auth.error?.status).toBe(401);
    expect(auth.user).toBeUndefined();
    // provenWallet only exists on the authed-user variant; assert it never leaks.
    expect((auth as { provenWallet?: string }).provenWallet).toBeUndefined();
  });

  // ── 3. Wrong / missing secret (dev) ⇒ REJECTED ──
  it("dev + WRONG secret header ⇒ REJECTED", async () => {
    const req = makeReq(bypassHeaders({ "X-E2E-Bypass": "not-the-secret" }));
    expect(e2eBypassFromRequest(req)).toBeNull();
    const auth = await requireInternalOrUserAuth(req);
    expect(auth.error?.status).toBe(401);
    expect(auth.user).toBeUndefined();
  });

  it("dev + MISSING secret header ⇒ REJECTED", async () => {
    const headers = bypassHeaders();
    delete headers["X-E2E-Bypass"];
    const req = makeReq(headers);
    expect(e2eBypassFromRequest(req)).toBeNull();
    expect((await requireInternalOrUserAuth(req)).error?.status).toBe(401);
  });

  it("dev + flag on but EMPTY server secret ⇒ REJECTED (empty secret disables bypass)", async () => {
    env.E2E_AUTH_BYPASS_SECRET = "";
    // Even a request whose header is also empty-string must not slip through.
    const req = makeReq(bypassHeaders({ "X-E2E-Bypass": "" }));
    expect(e2eBypassFromRequest(req)).toBeNull();
    expect((await requireInternalOrUserAuth(req)).error?.status).toBe(401);
  });

  it("dev + correct secret but NO X-E2E-Wallet ⇒ REJECTED (cannot prove ownership)", () => {
    const headers = bypassHeaders();
    delete headers["X-E2E-Wallet"];
    expect(e2eBypassFromRequest(makeReq(headers))).toBeNull();
  });

  // ── 4. Flag unset ⇒ REJECTED (real path unchanged) ──
  it("flag unset ⇒ REJECTED even with the correct secret header", async () => {
    delete env.E2E_AUTH_BYPASS;
    const req = makeReq(bypassHeaders());
    expect(e2eBypassFromRequest(req)).toBeNull();
    expect((await requireInternalOrUserAuth(req)).error?.status).toBe(401);
  });

  it("flag off leaves the real path byte-identical (internal-secret path still works)", async () => {
    delete env.E2E_AUTH_BYPASS;
    env.INTERNAL_CRON_SECRET = "cron-secret-value";
    // A genuine cron caller (internal secret, no E2E headers) is unaffected.
    const auth = await requireInternalOrUserAuth(
      makeReq({ "X-Internal-Secret": "cron-secret-value" }),
    );
    expect(auth.internal).toBe(true);
  });

  // ── getProvenWalletFromRequest honors the seam only for the matching identity ──
  it("getProvenWalletFromRequest returns the wallet only for the matching DID", () => {
    const req = makeReq(bypassHeaders());
    const matching: AuthUser = { id: DID };
    const other: AuthUser = { id: "did:privy:someone-else" };
    expect(getProvenWalletFromRequest(req, matching)).toBe(WALLET);
    expect(getProvenWalletFromRequest(req, other)).toBeUndefined();
  });

  it("getProvenWalletFromRequest ignores the seam in production (fail-closed)", () => {
    env.NODE_ENV = "production";
    const req = makeReq(bypassHeaders());
    expect(getProvenWalletFromRequest(req, { id: DID })).toBeUndefined();
  });
});
