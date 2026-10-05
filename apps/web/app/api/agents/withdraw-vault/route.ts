import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { api } from "@/convex/_generated/api";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { loadKeypair } from "@/lib/server/escrowServer";
import { buildAgentVaultProgram, withdrawTx } from "@/lib/agentVault";
import { getUsdcMint } from "@/lib/solana/network";

export const runtime = "nodejs";
export const maxDuration = 60;

// SIWS user-self-custody withdraw (user agents cashing out to their own wallet) is DEFERRED (mainnet; needs the vault owned by the user, not the platform).

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const CHECK_ADMIN = makeFunctionReference<"action">("submissions:checkAdminToken");

/**
 * Withdraw USDC from an agent's program-owned vault back to the platform authority.
 *
 * Under platform ownership the vault `owner` = the platform vault-authority key, and
 * the agent-vault program requires the withdraw destination ATA to be owned by that
 * same `owner` (program constraint `owner_usdc_ata.owner == owner.key()`), so this
 * route withdraws vault → the platform authority's own USDC ATA.
 *
 * Body: { mintAddress: string; amountUsdc: number; accessToken?: string }
 * Auth: X-Internal-Secret header OR admin Supabase token in body.accessToken.
 * Returns: { ok: true; txSignature: string }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    mintAddress?: string;
    amountUsdc?: number;
    accessToken?: string;
  };

  const { mintAddress, amountUsdc } = body;
  if (!mintAddress || typeof amountUsdc !== "number" || amountUsdc <= 0) {
    return NextResponse.json(
      { ok: false, error: "mintAddress and positive amountUsdc required" },
      { status: 400 },
    );
  }

  // Authorize: internal secret OR an admin Supabase token (verified via Convex).
  if (!checkInternalSecret(req)) {
    const convex = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null;
    if (!body.accessToken || !convex) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const chk = (await convex
      .action(CHECK_ADMIN, { accessToken: body.accessToken })
      .catch(() => null)) as { admin: boolean } | null;
    if (!chk?.admin) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    if (!process.env.PLATFORM_VAULT_AUTHORITY_SECRET) {
      return NextResponse.json({ ok: false, error: "Vault not configured" }, { status: 503 });
    }

    const convex = new ConvexHttpClient(CONVEX_URL);

    // Look up agent account to get the stored vaultAgentId.
    const account = await convex.query(api.agentAccount.get, { mintAddress });
    if (!account?.vaultAgentId) {
      return NextResponse.json(
        { ok: false, error: "Vault not initialized for this agent" },
        { status: 404 },
      );
    }

    // Rebuild 32-byte agentId from hex (stored at mint as sha256(sessionId)).
    const agentId = Buffer.from(account.vaultAgentId, "hex");

    const signer = loadKeypair(process.env.PLATFORM_VAULT_AUTHORITY_SECRET);
    const program = buildAgentVaultProgram(signer);
    const usdcMint = new PublicKey(getUsdcMint());

    // Under platform ownership: owner = platform authority.
    // The program constraint `owner_usdc_ata.owner == owner.key()` means the
    // withdraw destination MUST be the owner's own USDC ATA.
    const owner = signer.publicKey;
    const ownerUsdcAta = await getAssociatedTokenAddress(usdcMint, signer.publicKey);

    const txSignature = await withdrawTx({
      program,
      agentId,
      usdcMint,
      owner,
      ownerUsdcAta,
      amountUsdc,
    });

    console.log(
      `[withdraw-vault] withdrew ${amountUsdc} USDC from agent ${mintAddress} tx=${txSignature}`,
    );
    return NextResponse.json({ ok: true, txSignature });
  } catch (err) {
    console.error("[withdraw-vault]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "withdraw-vault failed" },
      { status: 500 },
    );
  }
}
