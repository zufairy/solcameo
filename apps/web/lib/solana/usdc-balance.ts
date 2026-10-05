import { Connection, PublicKey } from "@solana/web3.js";
import { getPublicSolanaRpcUrl } from "@/lib/solana/public-rpc";
import { getUsdcMint } from "@/lib/solana/network";

/**
 * Optional override for the active USDC mint.
 * Falls back to `getUsdcMint()` (keyed by NEXT_PUBLIC_SOLANA_NETWORK) so the
 * mint is consistent across devnet and the eventual mainnet flip without needing
 * NEXT_PUBLIC_USDC_MINT to be explicitly set in every environment.
 */
export function getUsdcMintAddress(): string {
  return process.env.NEXT_PUBLIC_USDC_MINT?.trim() || getUsdcMint();
}

/**
 * Sum SPL USDC token accounts for a wallet on the same cluster as `getPublicSolanaRpcUrl()`.
 * Returns `0` when the wallet has no USDC ATA; `null` on RPC/network errors.
 */
export async function fetchWalletUsdcBalance(walletAddress: string): Promise<number | null> {
  const owner = walletAddress?.trim();
  if (!owner) return null;

  try {
    const connection = new Connection(getPublicSolanaRpcUrl(), "confirmed");
    const mintPk = new PublicKey(getUsdcMintAddress());
    const ownerPk = new PublicKey(owner);
    const { value } = await connection.getParsedTokenAccountsByOwner(ownerPk, {
      mint: mintPk,
    });

    let sum = 0;
    for (const { account } of value) {
      const data = account.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } };
      const ui = data?.parsed?.info?.tokenAmount?.uiAmount;
      if (typeof ui === "number" && Number.isFinite(ui)) {
        sum += ui;
      }
    }

    return Number.isFinite(sum) ? sum : null;
  } catch {
    return null;
  }
}

/** Header pill — USDC as USD-stable (two decimal places); zero and unknown both show $0.00 after load (··· only mid-fetch). */
export function formatUsdcHeader(amount: number | null, loading: boolean): string {
  if (loading && amount === null) return "···";
  const value = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${formatted}`;
}
