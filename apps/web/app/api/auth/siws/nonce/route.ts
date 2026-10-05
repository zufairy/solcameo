import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/requireAuth";
import { issueNonce } from "@/lib/server/siwsSession";
import { buildSiwsMessage } from "@/lib/server/siwsMessage";

// Native Ed25519 + node:crypto live on the nodejs runtime. The /verify twin and
// every money route share this — keep them all on nodejs.
export const runtime = "nodejs";

/**
 * POST /api/auth/siws/nonce
 *
 * Step 1 of Sign-In-With-Solana. Requires a valid Privy Bearer (the user is
 * already logged in). Mints a single-use, 5-min nonce bound to BOTH the wallet
 * and the Privy DID, and returns the EXACT branded message the client must sign
 * verbatim. The wallet need not be Privy-linked (external wallet-adapter users
 * are supported); ownership is enforced downstream via checkOwnershipAgainst.
 *
 * Body: { wallet?: string }  — optional; defaults to the user's primary linked
 *   wallet. When provided (external-adapter case) it is used as-is — the nonce
 *   is DID-bound, so an unlinked wallet is allowed.
 *
 * Returns: { nonce, message, expiresAt }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: { wallet?: unknown } = {};
  try {
    body = (await req.json()) as { wallet?: unknown };
  } catch {
    // empty/invalid body is fine — fall back to the primary linked wallet
  }

  const linked = auth.user.walletAddresses ?? (auth.user.walletAddress ? [auth.user.walletAddress] : []);
  const requested = typeof body.wallet === "string" ? body.wallet.trim() : "";
  const wallet = requested || linked[0] || "";

  if (!wallet) {
    return NextResponse.json(
      { error: "No wallet provided. Connect a Solana wallet first." },
      { status: 400 },
    );
  }
  // External wallet-adapter users need not have the wallet Privy-linked: the
  // nonce is DID-bound and the downstream SIWS signature + ownership check
  // (checkOwnershipAgainst) is the real gate, so we don't reject unlinked
  // wallets here. `linked[0]` is still used above as the default wallet.

  const nonce = issueNonce({ wallet, did: auth.user.id });
  const message = buildSiwsMessage({
    wallet,
    nonce: nonce.token,
    issuedAt: nonce.issuedAt,
    expiresAt: nonce.expiresAt,
  });

  return NextResponse.json({ nonce: nonce.token, message, expiresAt: nonce.expiresAt });
}
