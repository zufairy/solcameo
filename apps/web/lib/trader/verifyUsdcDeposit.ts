import type { Connection } from "@solana/web3.js";
import { getRpcConnection } from "./usdcTransfer";

/** Verify (on devnet/mainnet) that `txSignature` is a confirmed tx that increased
 *  the USDC token balance OWNED BY `escrowOwner` by at least `minAmountUsdc`.
 *  Returns the credited amount, or throws if not verifiable. */
export async function verifyUsdcDeposit(opts: {
  txSignature: string;
  escrowOwner: string;
  usdcMint: string;
  minAmountUsdc: number;
  /** When set, also verify this wallet actually FUNDED the deposit (its USDC
   *  balance dropped by ≥ minAmountUsdc). This authorizes wallet-only purchases:
   *  only the wallet that sent the USDC can claim the resulting shares. */
  expectedSender?: string;
  /** RPC connection for the lookup. Defaults to the signing rpc (getRpcConnection).
   *  Callers on a propagation-lag-sensitive path (a just-confirmed tx may not have
   *  reached this node yet — BUG-025b) should pass a getReadRpcUrl() connection and
   *  retry: reads never touch the wallet, so the flake-tolerant READ rpc is correct. */
  connection?: Connection;
}): Promise<{ creditedUsdc: number }> {
  const { txSignature, escrowOwner, usdcMint, minAmountUsdc, expectedSender } = opts;
  const conn = opts.connection ?? getRpcConnection();
  const tx = await conn.getParsedTransaction(txSignature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) throw new Error("deposit tx not found / not confirmed");
  if (tx.meta?.err) throw new Error("deposit tx failed on-chain");

  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const ownedUsdc = (
    balances: typeof pre,
    owner: string,
  ) =>
    balances
      .filter((b) => b.owner === owner && b.mint === usdcMint)
      .reduce((s, b) => s + (b.uiTokenAmount.uiAmount ?? 0), 0);

  const credited = ownedUsdc(post, escrowOwner) - ownedUsdc(pre, escrowOwner);
  if (credited < minAmountUsdc - 1e-6) {
    throw new Error(`escrow credited ${credited} USDC, expected ≥ ${minAmountUsdc}`);
  }

  // Bind the deposit to the wallet that funded it. Without this, a caller could
  // present someone else's deposit tx and claim the shares against their own
  // wallet — the signed transfer is the proof of ownership for wallet-only buys.
  if (expectedSender && expectedSender !== escrowOwner) {
    const sent = ownedUsdc(pre, expectedSender) - ownedUsdc(post, expectedSender);
    if (sent < minAmountUsdc - 1e-6) {
      throw new Error(
        `deposit was not funded by the connected wallet ${expectedSender.slice(0, 4)}…${expectedSender.slice(-4)}`,
      );
    }
  }

  return { creditedUsdc: credited };
}
