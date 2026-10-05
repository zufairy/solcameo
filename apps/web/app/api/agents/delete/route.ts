import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { deleteProfile, resolveUsername, isConfigured } from "@/lib/server/uploadPost";
import { getUsdcBalanceStrict, transferUsdc } from "@/lib/trader/usdcTransfer";
import { decryptWalletSecret } from "@/lib/server/walletCrypto";

export const runtime = "nodejs";

/**
 * Clean single-agent delete: removes the agent from the marketplace AND frees its
 * upload-post profile slot in one call (the slot was the thing that previously
 * leaked — deleting an agent in the Convex DB alone left the profile orphaned,
 * silently eating a slot). Owner-gated (SIWS) for user callers; internal callers
 * (X-Internal-Secret) skip ownership for admin/cleanup.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const { mintAddress } = (await req.json().catch(() => ({}))) as { mintAddress?: string };
  if (!mintAddress) return NextResponse.json({ ok: false, error: "mintAddress required" }, { status: 400 });

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";

  // Ownership: only the SIWS-proven owner (or an internal caller) may delete.
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  if (!agent) return NextResponse.json({ ok: false, error: "Agent not found" }, { status: 404 });
  if (!auth.internal) {
    let resource: typeof agent | string[] = agent;
    if (auth.provenWallet && auth.provenWallet !== agent.creatorWallet) {
      const identity = await convex.query(api.mintFee.accountIdentity, {
        authSecret: secret, userId: auth.user.id,
        wallets: [...new Set([...(auth.user.walletAddresses ?? []), auth.user.walletAddress, auth.provenWallet].filter((w): w is string => !!w))],
      });
      if (identity.wallets.includes(agent.creatorWallet)) resource = [auth.provenWallet];
    }
    const err = requireOwnerWithSiws(auth, resource);
    if (err) return err;
  }

  // 0) REFUND the agent's on-chain USDC to the OWNER's wallet BEFORE deleting. The
  //    agent keypair is wiped from Convex on delete, so any USDC left in it would be
  //    unrecoverable. If a NON-ZERO balance fails to transfer, ABORT the delete so
  //    funds are never orphaned. Sponsored gas (PLATFORM_FEE_PAYER_SECRET) covers the
  //    SOL fee, so the agent wallet needs zero SOL.
  const refund: { attempted: boolean; amountUsdc: number; txSignature?: string; error?: string } = { attempted: false, amountUsdc: 0 };
  const ownerWallet = agent?.creatorWallet;
  const agentWallet = agent?.agentWallet;
  const agentSecretStored = agent?.agentWalletSecret;
  if (agentWallet && agentSecretStored && ownerWallet) {
    // STRICT read: distinguishes a CONFIRMED on-chain 0 (TokenAccountNotFound → 0)
    // from an UNKNOWN read (RPC 429/timeout/drop → null). deleteByMint below
    // irreversibly wipes the ONLY copy of agentWalletSecret, so an UNKNOWN read MUST
    // abort — treating it as 0 (the old lenient getUsdcBalance) would silently skip
    // the refund and permanently strand any real USDC. Helius 429 storms are a
    // documented condition for this deployment. Mirrors the sibling withdraw route's
    // null→503 abort. Only a confirmed 0 (or a successful refund) may proceed to delete.
    let bal: number | null;
    try { bal = await getUsdcBalanceStrict(agentWallet); } catch { bal = null; }
    if (bal === null) {
      return NextResponse.json(
        { ok: false, error: "on-chain balance temporarily unavailable — please retry", retriable: true },
        { status: 503 },
      );
    }
    if (bal > 0) {
      refund.attempted = true;
      refund.amountUsdc = bal;
      let secretB64 = "";
      try { secretB64 = decryptWalletSecret(agentSecretStored); } catch { secretB64 = ""; }
      const r = await transferUsdc({
        fromSecretBase64: secretB64,
        fromPubkey: agentWallet,
        toPubkey: ownerWallet,
        amountUsdc: bal,
        feePayerSecretBase64: process.env.PLATFORM_FEE_PAYER_SECRET || undefined,
      });
      refund.txSignature = r.txSignature;
      refund.error = r.error;
      if (!r.ok) {
        return NextResponse.json(
          { ok: false, error: `Refund of $${bal.toFixed(2)} USDC to your wallet failed — agent NOT deleted (funds preserved). ${r.error ?? ""}`.trim(), refund },
          { status: 502 },
        );
      }
    }
  }

  // 1) Free the upload-post profile slot (best-effort, idempotent — 404 = already gone).
  let profileFreed = false;
  if (isConfigured()) {
    const username = resolveUsername(mintAddress);
    if (username) {
      const r = await deleteProfile(username);
      profileFreed = r.ok;
    }
  }

  // 2) Delete the agent (influencers + agentAccount).
  const del = await convex.mutation(api.influencers.deleteByMint, { mintAddress, authSecret: secret });

  return NextResponse.json({ ok: true, mintAddress, deleted: del.deleted, profileFreed, refund });
}
