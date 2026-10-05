import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyAndFetchPrivyUser, type PrivyAuthUser } from "./privyVerify";
import { verifySiwsSession } from "./siwsSession";

/**
 * Server-side auth for Next.js API routes, backed by Privy access tokens.
 *
 * Clients attach `Authorization: Bearer <privy-access-token>`; we verify the
 * token's ES256 signature against the app JWKS and hydrate the user's linked
 * accounts (email + Solana wallet). The returned `user` shape is the same one
 * route handlers already consumed (`user.id`, wallet via getUserWallet), so no
 * downstream route changes are needed.
 */

/** Authenticated user as seen by route handlers. */
export type AuthUser = PrivyAuthUser;

export type AuthResult =
  | { user: AuthUser; token: string; internal?: false; error?: never }
  | { user?: never; token?: never; internal?: false; error: NextResponse };

export type InternalOrUserAuthResult =
  | {
      user: AuthUser;
      token: string;
      internal: false;
      /** The SIWS-proven wallet for this session, when a valid X-Siws-Session
       *  header was presented. Undefined until the user signs in with Solana.
       *  Step 2 switches ownership checks to compare against THIS (on-chain-proven)
       *  wallet via checkOwnershipAgainst — never a client-supplied header. */
      provenWallet?: string;
      error?: never;
    }
  | { user?: never; token?: never; internal: true; error?: never }
  | { user?: never; token?: never; internal?: false; error: NextResponse };

function bearer(req: NextRequest): string {
  const authHeader = req.headers.get("Authorization") ?? "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
}

// ── SECURITY-CRITICAL: dev-only E2E test-auth seam ───────────────────────────
// Lets authenticated Playwright E2E drive money/agent/wallet routes WITHOUT a real
// Privy login + SIWS signature. It activates ONLY when ALL THREE gates pass; in any
// other case it returns null and the real auth path below runs BYTE-FOR-BYTE
// unchanged. It is IMPOSSIBLE to activate in production: gate 1 is a hard NODE_ENV
// block that no env var or request header can override.
//
//   1. process.env.NODE_ENV !== "production"                     (hard prod block)
//   2. process.env.E2E_AUTH_BYPASS === "1"                       (explicit server opt-in)
//   3. X-E2E-Bypass header === process.env.E2E_AUTH_BYPASS_SECRET (secret MUST be
//      non-empty — an unset/empty secret keeps the bypass OFF regardless of headers)
//
// A passing request carries its synthetic identity in headers: X-E2E-Wallet (the
// wallet it acts as — becomes `provenWallet`) and X-E2E-Did (its DID, fallback a
// fixed test constant). Wiring the seam into requireAuth + getProvenWalletFromRequest
// means every composer (requireInternalOrUserAuth → requireOwnerWithSiws, and any
// requireAuth-direct route) resolves to the E2E wallet with no per-route change.
// NEVER set E2E_AUTH_BYPASS / E2E_AUTH_BYPASS_SECRET in prod / Railway.
const E2E_TEST_DID_FALLBACK = "did:e2e:test";
const E2E_BYPASS_TOKEN = "e2e-bypass"; // synthetic token slot — never a real Privy JWT

/**
 * The synthetic identity for an E2E-bypass request, or null when the triple-gate
 * does not fully pass (⇒ real auth runs unchanged). Exported for the security test.
 */
export function e2eBypassFromRequest(
  req: NextRequest,
): { userId: string; wallet: string } | null {
  // Gate 1 — hard production block. Checked FIRST so a leaked flag/secret in a
  // prod deploy can never activate the bypass.
  if (process.env.NODE_ENV === "production") return null;
  // Gate 2 — explicit server-side opt-in.
  if (process.env.E2E_AUTH_BYPASS !== "1") return null;
  // Gate 3 — shared-secret header. An unset/empty secret disables the bypass.
  const secret = (process.env.E2E_AUTH_BYPASS_SECRET || "").trim();
  if (!secret) return null;
  if (req.headers.get("X-E2E-Bypass") !== secret) return null;
  // A bypass request MUST name the wallet it acts as (used as the proven wallet).
  const wallet = req.headers.get("X-E2E-Wallet")?.trim();
  if (!wallet) return null;
  const userId = req.headers.get("X-E2E-Did")?.trim() || E2E_TEST_DID_FALLBACK;
  return { userId, wallet };
}

/** Build the synthetic AuthUser for an E2E-bypass request. */
function e2eAuthUser(e2e: { userId: string; wallet: string }): AuthUser {
  return { id: e2e.userId, walletAddress: e2e.wallet, walletAddresses: [e2e.wallet] };
}

export async function requireAuth(req: NextRequest): Promise<AuthResult> {
  const e2e = e2eBypassFromRequest(req);
  if (e2e) return { user: e2eAuthUser(e2e), token: E2E_BYPASS_TOKEN };
  const token = bearer(req);
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  try {
    const user = await verifyAndFetchPrivyUser(token);
    return { user, token };
  } catch {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
}

export type OptionalAuthResult =
  | { user: AuthUser; token: string; error?: never }
  | { user?: never; token?: never; error?: never }
  | { user?: never; token?: never; error: NextResponse };

/**
 * Like requireAuth, but a MISSING token is allowed (returns {} — anonymous).
 * A token that IS present but invalid still errors. Use for routes that work
 * for wallet-only callers (where the signed on-chain tx is the authorization)
 * but want to apply extra checks when a real account session is present.
 */
export async function optionalAuth(req: NextRequest): Promise<OptionalAuthResult> {
  const e2e = e2eBypassFromRequest(req);
  if (e2e) return { user: e2eAuthUser(e2e), token: E2E_BYPASS_TOKEN };
  const token = bearer(req);
  if (!token) return {}; // anonymous — caller decides what wallet-only flows may do
  try {
    const user = await verifyAndFetchPrivyUser(token);
    return { user, token };
  } catch {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
}

/** The connected Solana wallet address a client attaches (X-Wallet-Address).
 *  NOTE: this is an UNSIGNED, client-supplied hint and is NEVER an authorization
 *  signal — the bypass it once powered has been removed. Authorization comes from
 *  a SIWS-proven wallet (getProvenWalletFromRequest). Kept only for non-auth
 *  identity hinting; do not gate access on it. */
export function getWalletFromRequest(req: NextRequest): string | undefined {
  return req.headers.get("X-Wallet-Address")?.trim() || undefined;
}

/** Check the X-Internal-Secret header for server-to-server routes (cron, autonomy-loop). */
export function checkInternalSecret(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("X-Internal-Secret") === secret;
}

/**
 * The SIWS-proven wallet for a request, derived from the X-Siws-Session header.
 * Returns the wallet ONLY when the session token's HMAC + expiry validate AND the
 * session's DID matches the authenticated Privy user — otherwise undefined.
 * This is the on-chain-proven wallet identity; trust it over any client header.
 */
export function getProvenWalletFromRequest(req: NextRequest, user: AuthUser): string | undefined {
  // Dev-only E2E seam (triple-gated in e2eBypassFromRequest; inert in prod). Resolve
  // the proven wallet only for the SAME synthetic identity requireAuth produced —
  // mirrors the real `session.did === user.id` invariant — so no real SIWS signature
  // is needed for authenticated E2E.
  const e2e = e2eBypassFromRequest(req);
  if (e2e && e2e.userId === user.id) return e2e.wallet;
  const session = verifySiwsSession(req.headers.get("X-Siws-Session"));
  if (!session) return undefined;
  if (session.did !== user.id) return undefined; // session belongs to a different account
  return session.wallet;
}

/** Build a 401 that tells the client to (re)establish a SIWS session, then retry. */
export function siwsRequiredResponse(): NextResponse {
  return NextResponse.json(
    { error: "Wallet sign-in required", code: "siws_required" },
    { status: 401 },
  );
}

/**
 * Accept either a valid internal secret header (for cron/autonomy-loop callers)
 * or a valid Privy Bearer token (for user-triggered "Run Now").
 * Returns { internal: true } for cron callers, or { user, token } for user callers.
 */
export async function requireInternalOrUserAuth(req: NextRequest): Promise<InternalOrUserAuthResult> {
  // Cron / server-to-server callers present the shared secret and skip user auth.
  if (checkInternalSecret(req)) return { internal: true };
  // Everyone else MUST present a valid Privy Bearer. The old unsigned
  // X-Wallet-Address blanket bypass and the NODE_ENV!=="production" token-less
  // fallback are deliberately GONE — they let any caller act as the trusted
  // internal identity on money routes. Ownership is now proven via SIWS
  // (requireOwnerWithSiws) against the Ed25519-signed wallet, never a header.
  const userAuth = await requireAuth(req);
  if (userAuth.error) return userAuth as InternalOrUserAuthResult;
  // Expose the SIWS-proven wallet (if the caller presented a valid session bound
  // to this DID). Money/agent routes REQUIRE this via requireOwnerWithSiws.
  const provenWallet = getProvenWalletFromRequest(req, userAuth.user);
  return { user: userAuth.user, token: userAuth.token, internal: false, provenWallet };
}

/**
 * The single ownership gate for user (non-internal) callers on money/agent routes.
 *
 * Combines TWO checks, all in constant order, returning the first failure:
 *  1) A SIWS session must be present (X-Siws-Session validated to this DID) — else
 *     401 code:"siws_required" so the client transparently signs in and retries.
 *     The Ed25519 SIWS signature already proves control of `provenWallet`, so the
 *     wallet need NOT be one of the user's Privy-linked wallets (external
 *     wallet-adapter users are supported).
 *  2) The proven wallet must own the resource (=== ownerWallet). A null/empty
 *     ownerWallet (legacy agent or owner-less scope) skips the ownership compare
 *     but still requires check 1.
 *
 * Call ONLY after `requireInternalOrUserAuth` returns a user (`!auth.internal`).
 * Internal cron callers are pre-trusted and must skip this entirely.
 *
 * @returns a NextResponse to return immediately on failure, or null when the
 *   caller is the proven owner and may proceed.
 */
export function requireOwnerWithSiws(
  auth: { user: AuthUser; provenWallet?: string },
  resource: { creatorWallet?: string; coCreatorWallets?: string[] } | string | string[] | undefined | null,
): NextResponse | null {
  const provenWallet = auth.provenWallet;
  if (!provenWallet) return siwsRequiredResponse();
  return checkOwnershipAgainst(provenWallet, resource);
}

/**
 * SIWS-session-only gate for routes with NO ownable resource to scope (ad-hoc
 * renders, draft clip runs, download polling). Requires a valid, account-bound
 * SIWS session but performs no ownership compare. Call only when `!auth.internal`.
 */
export function requireSiwsSession(
  auth: { user: AuthUser; provenWallet?: string },
): NextResponse | null {
  const provenWallet = auth.provenWallet;
  if (provenWallet) return null;
  // Wallet-less accounts (email/password or fresh Google signups whose Privy
  // account has no Solana wallet linked yet) CANNOT produce a SIWS proof — and
  // demanding one walled every new non-crypto user out of the advertised free
  // tier (every clip route 401'd right after signup). Their verified auth
  // token already establishes identity, and these routes have no ownable
  // resource to protect; accounts that DO hold a wallet must still prove it.
  const hasWallet = Boolean(auth.user?.walletAddress) || (auth.user?.walletAddresses?.length ?? 0) > 0;
  if (!hasWallet) return null;
  return siwsRequiredResponse();
}

/** Returns the caller's Solana wallet (first linked wallet on their Privy account). */
export function getUserWallet(user: AuthUser): string | undefined {
  return user.walletAddress;
}

/**
 * Verify the authenticated user owns the agent identified by creatorWallet.
 * Returns a 403 response if ownership fails, or null if ownership is confirmed.
 * Skips the check when creatorWallet is unset (legacy agents without an owner record).
 */
export function checkOwnership(
  user: AuthUser,
  resource: { creatorWallet?: string; coCreatorWallets?: string[] } | string | string[] | undefined | null,
): NextResponse | null {
  if (!resource) return null;
  const userWallet = getUserWallet(user);
  if (!userWallet) {
    return NextResponse.json({ error: "Forbidden — wallet not linked to your account" }, { status: 403 });
  }
  let allowedWallets: string[] = [];
  if (typeof resource === "string") {
    allowedWallets = [resource];
  } else if (Array.isArray(resource)) {
    allowedWallets = resource;
  } else {
    if (resource.creatorWallet) allowedWallets.push(resource.creatorWallet);
    if (resource.coCreatorWallets) allowedWallets.push(...resource.coCreatorWallets);
  }
  
  if (allowedWallets.length === 0) return null; // no owner recorded — skip check
  if (!allowedWallets.includes(userWallet)) {
    return NextResponse.json({ error: "Forbidden — you do not own this resource" }, { status: 403 });
  }
  return null;
}

/** True when `wallet` is one of the user's Privy-linked Solana wallets. */
export function walletBelongsToUser(user: AuthUser, wallet: string | undefined): boolean {
  if (!wallet) return false;
  const linked = user.walletAddresses ?? (user.walletAddress ? [user.walletAddress] : []);
  return linked.includes(wallet);
}

/**
 * Ownership check against the SIWS-PROVEN wallet (not a client-supplied header).
 * Use this for user (non-internal) callers under the SIWS model: the wallet has
 * been proven via an Ed25519 signature, so comparing it to creatorWallet can't be
 * spoofed. Returns a 403 on mismatch, or null when ownership holds.
 *
 * - creatorWallet unset (legacy agent) → skip (null), matching checkOwnership.
 * - provenWallet missing → 403 with code "siws_required" (caller must sign in).
 */
export function checkOwnershipAgainst(
  provenWallet: string | undefined,
  resource: { creatorWallet?: string; coCreatorWallets?: string[] } | string | string[] | undefined | null,
): NextResponse | null {
  if (!resource) return null;
  
  let allowedWallets: string[] = [];
  if (typeof resource === "string") {
    allowedWallets = [resource];
  } else if (Array.isArray(resource)) {
    allowedWallets = resource;
  } else {
    if (resource.creatorWallet) allowedWallets.push(resource.creatorWallet);
    if (resource.coCreatorWallets) allowedWallets.push(...resource.coCreatorWallets);
  }
  
  if (allowedWallets.length === 0) return null; // no owner recorded — skip check
  if (!provenWallet) {
    return NextResponse.json(
      { error: "Wallet sign-in required", code: "siws_required" },
      { status: 401 },
    );
  }
  if (!allowedWallets.includes(provenWallet)) {
    return NextResponse.json({ error: "Forbidden — you do not own this resource" }, { status: 403 });
  }
  return null;
}
