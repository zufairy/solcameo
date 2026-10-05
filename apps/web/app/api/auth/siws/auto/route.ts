import { type NextRequest, NextResponse } from "next/server";
import { requireAuth, walletBelongsToUser } from "@/lib/server/requireAuth";
import { issueSiwsSession } from "@/lib/server/siwsSession";

export const runtime = "nodejs";

/**
 * POST /api/auth/siws/auto
 *
 * Popup-free wallet session. When the wallet is one of the Privy user's own linked
 * Solana wallets (Privy already verified control of it when it was linked or created),
 * a valid Privy Bearer is enough: we issue the same DID-bound SIWS session without
 * asking the wallet for a signature. Wallets that are NOT linked to the account (an
 * external adapter wallet) get 403 `wallet_not_linked`, and the client falls back to
 * the signed nonce flow (/nonce + /verify).
 *
 * Body: { wallet?: string }   Returns: { session, exp }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!auth.user) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  let body: { wallet?: unknown } = {};
  try { body = (await req.json()) as { wallet?: unknown }; } catch { /* default to the primary linked wallet */ }
  const linked = auth.user.walletAddresses ?? (auth.user.walletAddress ? [auth.user.walletAddress] : []);
  const requested = typeof body.wallet === "string" ? body.wallet.trim() : "";
  const wallet = requested || linked[0] || "";
  if (!wallet) return NextResponse.json({ error: "No wallet provided. Connect a Solana wallet first." }, { status: 400 });
  if (!walletBelongsToUser(auth.user, wallet)) {
    return NextResponse.json({ error: "Wallet is not linked to this account", code: "wallet_not_linked" }, { status: 403 });
  }
  const { token, exp } = issueSiwsSession({ wallet, did: auth.user.id });
  return NextResponse.json({ session: token, exp });
}
