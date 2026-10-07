import {
  AddressLookupTableAccount, Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getUsdcMint } from "@/lib/solana/network";

/**
 * Fund an agent from a wallet that only holds SOL: one Jupiter swap that sells just enough SOL to deliver an exact USDC
 * amount straight into the agent wallet's USDC account (ExactOut), with the tightest slippage that still lands.
 * The user's wallet signs it; nothing here holds a key. Mainnet only.
 */
const WSOL = "So11111111111111111111111111111111111111112";
/** Tight on purpose: ExactOut means the agent always receives the exact USDC; slippage only caps the SOL the payer may spend. */
export const FUND_SWAP_SLIPPAGE_BPS = 30;
export const FUND_SWAP_MIN_USD = 0.5;
export const FUND_SWAP_MAX_USD = 500;

export type FundSwapQuote = { usdc: number; inSol: number; maxSol: number; solUsd: number; priceImpactPct: number; slippageBps: number };

const key = () => process.env.JUPITER_API_KEY?.trim();
const base = () => (key() ? "https://api.jup.ag/swap/v1" : "https://lite-api.jup.ag/swap/v1");
const headers = (): Record<string, string> => (key() ? { "x-api-key": key()! } : {});

type JupQuote = { inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct?: string; [k: string]: unknown };
type JupIx = { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };

const toIx = (ix: JupIx) => new TransactionInstruction({
  programId: new PublicKey(ix.programId),
  keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
  data: Buffer.from(ix.data, "base64"),
});

/** ExactOut quote: how much SOL it costs to receive exactly `usdc` USDC. */
export async function quoteFundSwap(usdc: number, fetcher: typeof fetch = fetch): Promise<{ quote: JupQuote; summary: FundSwapQuote }> {
  if (!(usdc >= FUND_SWAP_MIN_USD && usdc <= FUND_SWAP_MAX_USD)) throw new Error(`Choose between $${FUND_SWAP_MIN_USD} and $${FUND_SWAP_MAX_USD}.`);
  const out = Math.ceil(usdc * 1e6);
  const q = new URLSearchParams({ inputMint: WSOL, outputMint: getUsdcMint("mainnet-beta"), amount: String(out), swapMode: "ExactOut", slippageBps: String(FUND_SWAP_SLIPPAGE_BPS), restrictIntermediateTokens: "true" });
  const res = await fetcher(`${base()}/quote?${q}`, { headers: headers(), signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error("Jupiter could not quote this swap right now. Try again in a moment.");
  const quote = (await res.json()) as JupQuote;
  const inLamports = Number(quote.inAmount), maxLamports = Number(quote.otherAmountThreshold);
  if (!Number.isFinite(inLamports) || inLamports <= 0 || Number(quote.outAmount) < out) throw new Error("Jupiter returned no route for this amount.");
  const inSol = inLamports / 1e9;
  return { quote, summary: { usdc: out / 1e6, inSol, maxSol: (Number.isFinite(maxLamports) && maxLamports > 0 ? maxLamports : inLamports) / 1e9, solUsd: out / 1e6 / inSol, priceImpactPct: Number(quote.priceImpactPct ?? 0) * 100, slippageBps: FUND_SWAP_SLIPPAGE_BPS } };
}

/** An unsigned v0 transaction for the payer: create the agent's USDC account if needed, then swap SOL straight into it. */
export async function buildFundSwapTransaction(args: { payer: PublicKey; agentWallet: PublicKey; usdc: number; connection: Connection; fetcher?: typeof fetch }) {
  const fetcher = args.fetcher ?? fetch;
  const { quote, summary } = await quoteFundSwap(args.usdc, fetcher);
  const usdcMint = new PublicKey(getUsdcMint("mainnet-beta"));
  const agentAta = getAssociatedTokenAddressSync(usdcMint, args.agentWallet, true);
  const res = await fetcher(`${base()}/swap-instructions`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers() }, signal: AbortSignal.timeout(12_000), cache: "no-store",
    body: JSON.stringify({
      quoteResponse: quote, userPublicKey: args.payer.toBase58(), destinationTokenAccount: agentAta.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 300_000, priorityLevel: "high" } },
    }),
  });
  const built = (await res.json().catch(() => ({}))) as {
    computeBudgetInstructions?: JupIx[]; setupInstructions?: JupIx[]; swapInstruction?: JupIx; cleanupInstruction?: JupIx | null; addressLookupTableAddresses?: string[]; error?: string;
  };
  if (!res.ok || !built.swapInstruction) throw new Error(built.error ?? "Jupiter could not build this swap. Try again in a moment.");
  const instructions = [
    ...(built.computeBudgetInstructions ?? []).map(toIx),
    // The destination USDC account must exist before the swap pays into it; idempotent, so it is safe when it already does.
    createAssociatedTokenAccountIdempotentInstruction(args.payer, agentAta, args.agentWallet, usdcMint),
    ...(built.setupInstructions ?? []).map(toIx),
    toIx(built.swapInstruction),
    ...(built.cleanupInstruction ? [toIx(built.cleanupInstruction)] : []),
  ];
  const tables: AddressLookupTableAccount[] = [];
  for (const address of built.addressLookupTableAddresses ?? []) {
    const table = (await args.connection.getAddressLookupTable(new PublicKey(address))).value;
    if (table) tables.push(table);
  }
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({ payerKey: args.payer, recentBlockhash: blockhash, instructions }).compileToV0Message(tables);
  const tx = new VersionedTransaction(message);
  return { transaction: Buffer.from(tx.serialize()).toString("base64"), lastValidBlockHeight, summary };
}
