/**
 * On-chain payment verification for Convex actions (JOB-85).
 *
 * Uses a raw Solana JSON-RPC `getTransaction` call (via `fetch`, available in
 * the default Convex runtime — no `"use node"` required) so it can be imported
 * by action files that live alongside queries/mutations.
 *
 * Both the share-purchase ("invest") and campaign top-up flows move USDC as an
 * SPL token transfer to a destination ATA (the agent treasury / campaign escrow
 * PDA). We verify the transfer by diffing the destination owner's USDC token
 * balance (`pre`/`postTokenBalances`) rather than trusting any client-supplied
 * amount.
 */

/** Network-keyed USDC mints — kept in sync with lib/solana/network.ts.
 *  Convex cannot import from the Next.js lib, so the table is inlined here.
 *  MAINNET FLIP: set NEXT_PUBLIC_USDC_MINT = EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 *  in the Convex env alongside NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta. */
const USDC_MINT_BY_NETWORK: Record<string, string> = {
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "devnet":       "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "testnet":      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

function getNetworkUsdcMint(): string {
  const raw = (process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet").toLowerCase();
  const network =
    raw === "mainnet" || raw === "mainnet-beta"
      ? "mainnet-beta"
      : raw === "testnet"
        ? "testnet"
        : "devnet";
  return USDC_MINT_BY_NETWORK[network];
}

export function solanaRpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    "https://api.devnet.solana.com"
  );
}

/** Active USDC mint: explicit override first, then network-keyed fallback.
 *  Consistent with lib/solana/network.ts getUsdcMint() and lib/escrow.ts
 *  getEscrowUsdcMint() so all USDC-mint reads agree on the same address. */
export function usdcMint(): string {
  return process.env.NEXT_PUBLIC_USDC_MINT ?? getNetworkUsdcMint();
}

/**
 * When true, unverifiable payments are accepted (devnet/local developer flow).
 * Defaults to FALSE — production fails closed. Set
 * `VELLO_ALLOW_UNVERIFIED_PAYMENTS=true` only in non-production deployments.
 */
export function allowUnverifiedPayments(): boolean {
  return process.env.VELLO_ALLOW_UNVERIFIED_PAYMENTS === "true";
}

type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmount: number | null; amount: string; decimals: number };
};

export type VerifyResult =
  | { ok: true; creditedUsdc: number }
  | { ok: false; error: string };

/**
 * Verify that `txSignature` is a confirmed, successful transaction that
 * credited at least `minAmountUsdc` of USDC to `destinationOwner`.
 */
export async function verifyUsdcTransfer(args: {
  txSignature: string;
  destinationOwner: string;
  minAmountUsdc: number;
}): Promise<VerifyResult> {
  const { txSignature, destinationOwner, minAmountUsdc } = args;
  if (!txSignature) return { ok: false, error: "Missing txSignature" };

  let json: {
    result?: {
      meta?: {
        err: unknown;
        preTokenBalances?: TokenBalance[];
        postTokenBalances?: TokenBalance[];
      } | null;
    } | null;
    error?: { message?: string };
  };
  try {
    const res = await fetch(solanaRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          txSignature,
          { commitment: "confirmed", maxSupportedTransactionVersion: 0, encoding: "jsonParsed" },
        ],
      }),
    });
    if (!res.ok) return { ok: false, error: `RPC error ${res.status}` };
    json = await res.json();
  } catch (err) {
    return { ok: false, error: `RPC request failed: ${(err as Error).message}` };
  }

  if (json.error) return { ok: false, error: json.error.message ?? "RPC error" };
  const tx = json.result;
  if (!tx) {
    return { ok: false, error: "Transaction not found on-chain yet — try again in a few seconds." };
  }
  const meta = tx.meta;
  if (!meta) return { ok: false, error: "Transaction metadata unavailable" };
  if (meta.err) return { ok: false, error: "On-chain transaction failed" };

  const mint = usdcMint();
  const sumFor = (rows: TokenBalance[] | undefined) =>
    (rows ?? [])
      .filter((b) => b.mint === mint && b.owner === destinationOwner)
      .reduce((s, b) => s + (b.uiTokenAmount.uiAmount ?? 0), 0);

  const credited = sumFor(meta.postTokenBalances) - sumFor(meta.preTokenBalances);

  // Allow a tiny rounding tolerance (USDC has 6 decimals).
  if (credited + 1e-6 < minAmountUsdc) {
    return {
      ok: false,
      error: `On-chain credit ${credited.toFixed(6)} USDC is less than expected ${minAmountUsdc} USDC`,
    };
  }

  return { ok: true, creditedUsdc: credited };
}
