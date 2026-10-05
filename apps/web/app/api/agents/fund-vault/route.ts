import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { api } from "@/convex/_generated/api";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { loadKeypair } from "@/lib/server/escrowServer";
import { buildAgentVaultProgram, getVaultPda, depositTx } from "@/lib/agentVault";
import { getUsdcMint } from "@/lib/solana/network";

export const runtime = "nodejs";
export const maxDuration = 60;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const CHECK_ADMIN = makeFunctionReference<"action">("submissions:checkAdminToken");

/**
 * Fund an agent's on-chain vault with USDC.
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

    // Look up agent account to get the stored vaultAgentId
    const account = await convex.query(api.agentAccount.get, { mintAddress });
    if (!account?.vaultAgentId) {
      return NextResponse.json(
        { ok: false, error: "Vault not initialized for this agent" },
        { status: 404 },
      );
    }

    // Rebuild 32-byte agentId from hex
    const agentId = Buffer.from(account.vaultAgentId, "hex");

    const vaultSigner = loadKeypair(process.env.PLATFORM_VAULT_AUTHORITY_SECRET);
    const program = buildAgentVaultProgram(vaultSigner);
    const usdcMint = new PublicKey(getUsdcMint());

    // Verify the stored vault PDA matches what we'd derive (sanity check)
    const [vaultPda] = getVaultPda(vaultSigner.publicKey, agentId);
    if (account.vaultAddress && account.vaultAddress !== vaultPda.toBase58()) {
      console.warn(
        `[fund-vault] stored vaultAddress ${account.vaultAddress} !== derived ${vaultPda.toBase58()} — using derived`,
      );
    }

    // Funder ATA = platform vault authority's own USDC associated token account
    const funderUsdcAta = await getAssociatedTokenAddress(usdcMint, vaultSigner.publicKey);

    const txSignature = await depositTx({
      program,
      agentId,
      usdcMint,
      owner: vaultSigner.publicKey,
      funderUsdcAta,
      amountUsdc,
    });

    console.log(`[fund-vault] deposited ${amountUsdc} USDC → ${vaultPda.toBase58()} tx=${txSignature}`);
    return NextResponse.json({ ok: true, txSignature });
  } catch (err) {
    console.error("[fund-vault]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "fund-vault failed" },
      { status: 500 },
    );
  }
}
