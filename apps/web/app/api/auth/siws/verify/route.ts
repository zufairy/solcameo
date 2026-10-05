import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/requireAuth";
import {
  consumeNonce,
  issueSiwsSession,
  verifyNonce,
  verifyWalletSignature,
} from "@/lib/server/siwsSession";
import { buildSiwsMessage } from "@/lib/server/siwsMessage";

// Native Ed25519 message-signature verification requires the nodejs runtime.
export const runtime = "nodejs";

/**
 * POST /api/auth/siws/verify
 *
 * Step 2 of Sign-In-With-Solana. Requires a valid Privy Bearer. Verifies that the
 * provided signature was produced by `wallet` over the message reconstructed from
 * the (trusted, HMAC-signed) nonce — then issues a 24h SIWS session token.
 *
 * Body: { wallet: string, signature: string (base64), nonce: string }
 * Returns: { session, exp }
 *
 * Security:
 *  - nonce is HMAC-verified, single-use (consumed jti) and self-expiring (5 min).
 *  - the signed message is rebuilt SERVER-SIDE from the nonce; the client's own
 *    message text is never trusted.
 *  - nonce.wallet must equal body.wallet AND nonce.did must equal the Privy DID,
 *    so a captured signature can't be lifted to another wallet/user/nonce.
 *  - the proven wallet need NOT be Privy-linked (external wallet-adapter users are
 *    supported); ownership is enforced downstream via checkOwnershipAgainst.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: { wallet?: unknown; signature?: unknown; nonce?: unknown };
  try {
    body = (await req.json()) as { wallet?: unknown; signature?: unknown; nonce?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  const nonceToken = typeof body.nonce === "string" ? body.nonce : "";
  if (!wallet || !signature || !nonceToken) {
    return NextResponse.json({ error: "wallet, signature and nonce are required" }, { status: 400 });
  }

  // 1) Verify the nonce: HMAC + discriminator + not-expired.
  const nonce = verifyNonce(nonceToken);
  if (!nonce) {
    return NextResponse.json({ error: "Invalid or expired nonce" }, { status: 401 });
  }

  // 2) Bind the nonce to this exact wallet + Privy DID.
  if (nonce.wallet !== wallet || nonce.did !== auth.user.id) {
    return NextResponse.json({ error: "Nonce does not match this wallet or account" }, { status: 401 });
  }

  // 3) Single-use: consume the jti. A replay (already-consumed nonce) is rejected.
  if (!consumeNonce(nonce.jti, nonce.expiresAt)) {
    return NextResponse.json({ error: "Nonce already used" }, { status: 401 });
  }

  // 4) Rebuild the EXACT message from the trusted nonce — never the client's text.
  const message = buildSiwsMessage({
    wallet: nonce.wallet,
    nonce: nonceToken,
    issuedAt: nonce.issuedAt,
    expiresAt: nonce.expiresAt,
  });

  // 5) Ed25519-verify the signature against the wallet's public key.
  const ok = await verifyWalletSignature({ wallet, message, signatureBase64: signature });
  if (!ok) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  // 6) Issue the session. The Ed25519 signature already proves wallet control,
  //    and ownership is enforced downstream via checkOwnershipAgainst
  //    (provenWallet === creatorWallet) — so an external (non-Privy-linked)
  //    wallet is allowed here. The nonce stays HMAC-signed + single-use +
  //    DID-bound and the message is rebuilt server-side, so the session is safe.
  const { token, exp } = issueSiwsSession({ wallet, did: auth.user.id });
  return NextResponse.json({ session: token, exp });
}
