import { splitFundingAmount } from "@/lib/solana/fundingFee";

/** The slice of a `getParsedTransaction` result this check reads. */
export interface ParsedFundingTx {
  meta: { err: unknown } | null;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: { toBase58(): string } | string; signer?: boolean }>;
      instructions: Array<{ program?: string; parsed?: { type?: string; info?: { source?: string; destination?: string; lamports?: number | string } } }>;
    };
  };
}

export type FundingVerdict =
  | { ok: true; netLamports: bigint; feeLamports: bigint }
  | { ok: false; reason: "tx_failed" | "wrong_signer" | "no_treasury_transfer" | "fee_missing" };

const key = (k: { pubkey: { toBase58(): string } | string }) => (typeof k.pubkey === "string" ? k.pubkey : k.pubkey.toBase58());

/**
 * A top-up counts only when the payer signed a successful transaction that sent SOL to the agent treasury AND at
 * least 3% of the total to the platform wallet. The credited amount is what the treasury actually received.
 */
export function verifyFundingTx(tx: ParsedFundingTx, o: { payer: string; treasury: string; feeWallet: string }): FundingVerdict {
  if (!tx.meta || tx.meta.err) return { ok: false, reason: "tx_failed" };
  const keys = tx.transaction.message.accountKeys;
  if (!keys.length || key(keys[0]) !== o.payer || !keys[0].signer) return { ok: false, reason: "wrong_signer" };
  let net = 0n, fee = 0n;
  for (const ix of tx.transaction.message.instructions) {
    if (ix.program !== "system" || ix.parsed?.type !== "transfer") continue;
    const { source, destination, lamports } = ix.parsed.info ?? {};
    if (source !== o.payer || lamports == null) continue;
    if (destination === o.treasury) net += BigInt(lamports);
    else if (destination === o.feeWallet) fee += BigInt(lamports);
  }
  if (net <= 0n) return { ok: false, reason: "no_treasury_transfer" };
  if (fee < splitFundingAmount(net + fee).fee || fee <= 0n) return { ok: false, reason: "fee_missing" };
  return { ok: true, netLamports: net, feeLamports: fee };
}
