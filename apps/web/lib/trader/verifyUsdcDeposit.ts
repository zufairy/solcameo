import { Connection } from "@solana/web3.js";
import { getRpcConnection } from "./usdcTransfer";
import { rpcCandidates } from "@/lib/solana/rpc";
import { getNetwork } from "@/lib/solana/network";

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

type DepositCheck = Parameters<typeof verifyUsdcDeposit>[0];

/** The cluster saw the transaction and it does not pay what is owed, so waiting longer cannot change the answer. */
const isDefinitive = (e: unknown) => e instanceof Error && /failed on-chain|credited|funded by/.test(e.message);

/**
 * Wait for a just-sent payment to be confirmed and verify it. A payment the wallet confirmed seconds ago may not have reached
 * every RPC node yet, so each round asks all configured endpoints at once (first good answer wins) and a short pause
 * separates rounds, up to `maxMs`. A transaction that is on-chain but does not match is rejected immediately.
 */
export async function waitForUsdcDeposit(opts: Omit<DepositCheck, "connection">, { maxMs = 25_000, urls }: { maxMs?: number; urls?: string[] } = {}): Promise<{ creditedUsdc: number }> {
  const start = Date.now();
  const endpoints = urls ?? rpcCandidates(getNetwork());
  let pause = 350;
  let last: unknown;
  for (;;) {
    try {
      return await Promise.any(endpoints.map((url) => verifyUsdcDeposit({ ...opts, connection: new Connection(url, "confirmed") })));
    } catch (e) {
      const errors = e instanceof AggregateError ? (e.errors as unknown[]) : [e];
      const definitive = errors.find(isDefinitive);
      if (definitive) throw definitive;
      last = errors[0] ?? e;
    }
    if (Date.now() - start + pause > maxMs) throw last instanceof Error ? last : new Error("deposit tx not found / not confirmed");
    await new Promise((r) => setTimeout(r, pause));
    pause = Math.min(Math.round(pause * 1.4), 1500);
  }
}
