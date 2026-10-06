import { Connection, VersionedTransaction } from "@solana/web3.js";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getUsdcBalanceStrict, getSolBalanceStrict, loadKeypair } from "@/lib/trader/usdcTransfer";
import { readAgentSecret } from "@/lib/economy/walletSecretAccess";
import { getRpcCandidates, getUsdcMint } from "@/lib/solana/network";

/**
 * Pay-with-SOL for agents that hold SOL but not enough USDC.
 *
 * Protocol: Jupiter Swap V2 (api.jup.ag/swap/v2). Its /order endpoint is a meta-aggregator: Metis (every Solana DEX
 * incl. Orca, Raydium, Meteora), JupiterZ market makers, DFlow and OKX all quote the same swap and the best one wins,
 * so we never pick a venue ourselves. Jupiter adds no platform fee of its own on a plain swap; the cost is the
 * winning pool's fee plus the network fee. Without JUPITER_API_KEY we fall back to the same Metis router through the
 * free lite endpoint (swap/v1), which needs no key.
 *
 * The swap is signed server-side by the agent's own wallet and only ever sells SOL for USDC, never the reverse.
 */
const WSOL = "So11111111111111111111111111111111111111112";
/** SOL the wallet must keep after swapping: the swap's own network fee, a possible USDC account rent, and headroom. */
export const SOL_RESERVE_LAMPORTS = 12_000_000;
export const SWAP_SLIPPAGE_BPS = 50;
/** Extra USDC asked for so slippage and pool fees never leave the charge a few cents short. */
const SHORTFALL_BUFFER = 0.012;
const maxSwapUsd = () => Number(process.env.AGENT_SWAP_MAX_USD ?? 50);

export type TopUpPlan =
  | { enough: true }
  | { enough: false; canSwap: true; lamports: number; usdcTarget: number; solAfter: number }
  | { enough: false; canSwap: false; reason: "no_sol" | "not_enough_sol" | "over_limit" | "no_price"; solNeeded?: number };

/**
 * The checker: is the agent's USDC enough for this charge, and if not, is its SOL enough to cover the gap after a
 * live swap while still leaving the reserve? Pure, so it is exact and testable. `usdcPerSol` is a live quote.
 */
export function planTopUp(a: { requiredUsd: number; usdcBalance: number; solLamports: number; usdcPerSol: number | null; maxSwapUsd?: number }): TopUpPlan {
  const short = a.requiredUsd - a.usdcBalance;
  if (short <= 1e-9) return { enough: true };
  const spendable = a.solLamports - SOL_RESERVE_LAMPORTS;
  if (spendable <= 0) return { enough: false, canSwap: false, reason: "no_sol" };
  if (!a.usdcPerSol || !(a.usdcPerSol > 0)) return { enough: false, canSwap: false, reason: "no_price" };
  const usdcTarget = +(short * (1 + SHORTFALL_BUFFER)).toFixed(6);
  if (usdcTarget > (a.maxSwapUsd ?? maxSwapUsd())) return { enough: false, canSwap: false, reason: "over_limit" };
  const lamports = Math.ceil((usdcTarget / a.usdcPerSol) * 1e9 * (1 + SWAP_SLIPPAGE_BPS / 10_000));
  if (lamports > spendable) return { enough: false, canSwap: false, reason: "not_enough_sol", solNeeded: (lamports + SOL_RESERVE_LAMPORTS) / 1e9 };
  return { enough: false, canSwap: true, lamports, usdcTarget, solAfter: (a.solLamports - lamports) / 1e9 };
}

const key = () => process.env.JUPITER_API_KEY?.trim();
const headers = (): Record<string, string> => (key() ? { "x-api-key": key()! } : {});
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers() }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), cache: "no-store" });

/** Live USDC per 1 SOL: a quote for 0.1 SOL scaled up, from the router that will do the swap. */
export async function usdcPerSol(): Promise<number | null> {
  try {
    const q = new URLSearchParams({ inputMint: WSOL, outputMint: getUsdcMint("mainnet-beta"), amount: "100000000", slippageBps: String(SWAP_SLIPPAGE_BPS), restrictIntermediateTokens: "true" });
    const base = key() ? "https://api.jup.ag/swap/v1" : "https://lite-api.jup.ag/swap/v1";
    const res = await fetch(`${base}/quote?${q}`, { headers: headers(), signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!res.ok) return null;
    const out = Number(((await res.json()) as { outAmount?: string }).outAmount);
    return Number.isFinite(out) && out > 0 ? (out / 1e6) * 10 : null;
  } catch { return null; }
}

export type SwapResult = { ok: true; signature: string; router: string } | { ok: false; reason: string };

/**
 * Build, sign (with the agent wallet) and land one swap. With a Jupiter key this is Swap V2, where every router
 * competes. `ultra` leaves out the optional slippage setting, which keeps the order in Jupiter's Ultra mode: the only
 * mode that can pay the network fee for a wallet holding no SOL (JupiterZ market makers cover it free, otherwise
 * Jupiter takes it out of the swap amount, up to 10%, and only for trades of roughly $10 or more).
 */
async function swapTokens(agent: { wallet: string; secret: string }, swap: { inputMint: string; outputMint: string; amount: number; ultra?: boolean }, connection: Connection): Promise<SwapResult> {
  const signer = loadKeypair(readAgentSecret(agent.secret));
  if (signer.publicKey.toBase58() !== agent.wallet) return { ok: false, reason: "wallet_key_mismatch" };
  if (key()) {
    const q = new URLSearchParams({ inputMint: swap.inputMint, outputMint: swap.outputMint, amount: String(swap.amount), taker: agent.wallet, ...(swap.ultra ? {} : { slippageBps: String(SWAP_SLIPPAGE_BPS) }) });
    const orderRes = await fetch(`https://api.jup.ag/swap/v2/order?${q}`, { headers: headers(), signal: AbortSignal.timeout(15_000), cache: "no-store" });
    const order = (await orderRes.json().catch(() => ({}))) as { transaction?: string; requestId?: string; router?: string; errorMessage?: string };
    if (!orderRes.ok || !order.transaction || !order.requestId) return { ok: false, reason: order.errorMessage ?? "order_failed" };
    const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
    tx.sign([signer]);
    const exec = await post("https://api.jup.ag/swap/v2/execute", { signedTransaction: Buffer.from(tx.serialize()).toString("base64"), requestId: order.requestId });
    const done = (await exec.json().catch(() => ({}))) as { status?: string; signature?: string; error?: string };
    return exec.ok && done.status === "Success" && done.signature ? { ok: true, signature: done.signature, router: order.router ?? "jupiter" } : { ok: false, reason: done.error ?? "execute_failed" };
  }
  // Keyless: the Metis router through the free endpoint; we land the transaction on our own RPC, so the wallet pays its own fee.
  const quoteRes = await fetch(`https://lite-api.jup.ag/swap/v1/quote?${new URLSearchParams({ inputMint: swap.inputMint, outputMint: swap.outputMint, amount: String(swap.amount), slippageBps: String(SWAP_SLIPPAGE_BPS), restrictIntermediateTokens: "true" })}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!quoteRes.ok) return { ok: false, reason: "quote_failed" };
  const swapRes = await post("https://lite-api.jup.ag/swap/v1/swap", { quoteResponse: await quoteRes.json(), userPublicKey: agent.wallet, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true });
  const built = (await swapRes.json().catch(() => ({}))) as { swapTransaction?: string; lastValidBlockHeight?: number };
  if (!swapRes.ok || !built.swapTransaction) return { ok: false, reason: "swap_build_failed" };
  const tx = VersionedTransaction.deserialize(Buffer.from(built.swapTransaction, "base64"));
  tx.sign([signer]);
  const signature = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const confirmation = await connection.confirmTransaction({ signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: built.lastValidBlockHeight ?? (await connection.getBlockHeight("confirmed")) + 150 }, "confirmed");
  return confirmation.value.err ? { ok: false, reason: "swap_reverted" } : { ok: true, signature, router: "metis" };
}

const locks = new Map<string, Promise<unknown>>();
export type TopUpOutcome =
  | { ok: true; swapped: boolean; signature?: string; router?: string; usdcAdded?: number }
  | { ok: false; reason: string; solNeeded?: number };

/**
 * If the agent cannot cover `requiredUsd` in USDC but its SOL can, swap exactly the shortfall (plus a small buffer)
 * from SOL to USDC at the live best price, wait for it to land, and report. Never swaps more than the shortfall,
 * never dips below the SOL reserve, and never sells USDC. One swap at a time per agent.
 */
export async function topUpAgentFromSol(mintAddress: string, requiredUsd: number): Promise<TopUpOutcome> {
  const previous = locks.get(mintAddress) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => doTopUp(mintAddress, requiredUsd));
  locks.set(mintAddress, run);
  try { return await run; } finally { if (locks.get(mintAddress) === run) locks.delete(mintAddress); }
}

async function doTopUp(mintAddress: string, requiredUsd: number): Promise<TopUpOutcome> {
  try {
    if (process.env.NEXT_PUBLIC_SOLANA_NETWORK && process.env.NEXT_PUBLIC_SOLANA_NETWORK !== "mainnet-beta") return { ok: false, reason: "swaps_need_mainnet" };
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
    if (!agent?.agentWallet || !agent.agentWalletSecret) return { ok: false, reason: "no_agent_wallet" };
    const [usdc, sol] = await Promise.all([getUsdcBalanceStrict(agent.agentWallet), getSolBalanceStrict(agent.agentWallet)]);
    if (usdc === null || sol === null) return { ok: false, reason: "balance_unavailable" };
    const plan = planTopUp({ requiredUsd, usdcBalance: usdc, solLamports: Math.floor(sol * 1e9), usdcPerSol: await usdcPerSol() });
    if (plan.enough) return { ok: true, swapped: false };
    if (!plan.canSwap) return { ok: false, reason: plan.reason, ...(plan.solNeeded ? { solNeeded: plan.solNeeded } : {}) };

    const swap = await swapTokens({ wallet: agent.agentWallet, secret: agent.agentWalletSecret }, { inputMint: WSOL, outputMint: getUsdcMint("mainnet-beta"), amount: plan.lamports }, new Connection(getRpcCandidates("mainnet-beta")[0], "confirmed"));
    if (!swap.ok) return { ok: false, reason: swap.reason };
    // The swap landed; confirm the USDC really arrived before anything is charged against it.
    let after: number | null = usdc;
    for (let i = 0; i < 6 && (after === null || after < requiredUsd - 1e-6); i++) {
      await new Promise((r) => setTimeout(r, 1200));
      after = await getUsdcBalanceStrict(agent.agentWallet);
    }
    if (after === null || after < requiredUsd - 1e-6) return { ok: false, reason: "swap_landed_but_usdc_short" };
    console.info("[sol-swap] swapped SOL for USDC", { mintAddress, lamports: plan.lamports, signature: swap.signature, router: swap.router });
    return { ok: true, swapped: true, signature: swap.signature, router: swap.router, usdcAdded: +(after - usdc).toFixed(6) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 120) : "swap_error" };
  }
}

/** Read-only version for the UI: how the agent could pay for `requiredUsd`, without moving anything. */
export async function checkAgentFunding(mintAddress: string, requiredUsd: number) {
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
  if (!agent?.agentWallet) return { ok: false as const, reason: "no_agent_wallet" };
  const [usdc, sol] = await Promise.all([getUsdcBalanceStrict(agent.agentWallet), getSolBalanceStrict(agent.agentWallet)]);
  if (usdc === null || sol === null) return { ok: false as const, reason: "balance_unavailable" };
  const price = await usdcPerSol();
  const plan = planTopUp({ requiredUsd, usdcBalance: usdc, solLamports: Math.floor(sol * 1e9), usdcPerSol: price });
  return { ok: true as const, usdc, sol, solPriceUsd: price, plan, canPay: plan.enough || plan.canSwap };
}

// ── Network fees paid from USDC ──────────────────────────────────────────────
/** SOL an agent wallet should hold when it has to pay its own network fees (about 800 transfers' worth). */
export const GAS_FLOOR_LAMPORTS = 4_000_000;
/** Below this the wallet cannot pay for even the swap that would refill it, so only a gasless order can work. */
export const GAS_SELF_PAID_MIN_LAMPORTS = 1_500_000;
const GAS_TARGET_LAMPORTS = 10_000_000;
/** Jupiter's gasless Ultra swaps only apply to trades of about $10 or more. */
export const GAS_GASLESS_MIN_USD = 10.5;

export type GasPlan =
  | { ok: true; swap: false }
  | { ok: true; swap: true; usd: number; gasless: boolean }
  | { ok: false; reason: "no_price" | "usdc_too_low" | "needs_key_for_gasless" };

/**
 * The gas checker: does the wallet hold enough SOL to pay its own network fees, and if not, how much USDC should
 * become SOL? A wallet with a little SOL swaps about $1 and pays for that swap itself. A wallet with none needs a
 * gasless Ultra order (about $10, needs a Jupiter key). The USDC already earmarked for the job (`keepUsdc`) is never touched.
 */
export function planGasTopUp(a: { solLamports: number; usdcBalance: number; keepUsdc: number; solUsd: number | null; hasKey: boolean }): GasPlan {
  if (a.solLamports >= GAS_FLOOR_LAMPORTS) return { ok: true, swap: false };
  if (!a.solUsd || !(a.solUsd > 0)) return { ok: false, reason: "no_price" };
  const wantUsd = Math.max(1, Math.ceil(((GAS_TARGET_LAMPORTS - a.solLamports) / 1e9) * a.solUsd * 1.03 * 100) / 100);
  const gasless = a.solLamports < GAS_SELF_PAID_MIN_LAMPORTS;
  if (gasless && !a.hasKey) return { ok: false, reason: "needs_key_for_gasless" };
  const usd = gasless ? Math.max(wantUsd, GAS_GASLESS_MIN_USD) : wantUsd;
  if (a.usdcBalance - usd < a.keepUsdc - 1e-9) return { ok: false, reason: "usdc_too_low" };
  return { ok: true, swap: true, usd, gasless };
}

/** Is the shared fee-payer wallet able to pay network fees right now? If so agents need no SOL at all. */
export async function feePayerReady(): Promise<boolean> {
  try {
    const secret = process.env.PLATFORM_FEE_PAYER_SECRET?.trim();
    if (!secret) return false;
    const sol = await getSolBalanceStrict(loadKeypair(secret).publicKey.toBase58());
    return sol !== null && sol >= 0.002;
  } catch { return false; }
}

export type GasOutcome = { ok: true; swapped: boolean; signature?: string } | { ok: false; reason: string };

/**
 * Make sure the agent can pay its own network fee: if it holds USDC but too little SOL, swap a small slice of that
 * USDC to SOL at the live best price (gasless when it has no SOL at all). One swap at a time per agent.
 */
export async function ensureAgentGas(mintAddress: string, keepUsdc: number): Promise<GasOutcome> {
  const previous = locks.get(mintAddress) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => doEnsureGas(mintAddress, keepUsdc));
  locks.set(mintAddress, run);
  try { return await run; } finally { if (locks.get(mintAddress) === run) locks.delete(mintAddress); }
}

async function doEnsureGas(mintAddress: string, keepUsdc: number): Promise<GasOutcome> {
  try {
    if (process.env.NEXT_PUBLIC_SOLANA_NETWORK && process.env.NEXT_PUBLIC_SOLANA_NETWORK !== "mainnet-beta") return { ok: false, reason: "swaps_need_mainnet" };
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
    if (!agent?.agentWallet || !agent.agentWalletSecret) return { ok: false, reason: "no_agent_wallet" };
    const [usdc, sol] = await Promise.all([getUsdcBalanceStrict(agent.agentWallet), getSolBalanceStrict(agent.agentWallet)]);
    if (usdc === null || sol === null) return { ok: false, reason: "balance_unavailable" };
    const solLamports = Math.floor(sol * 1e9);
    const plan = planGasTopUp({ solLamports, usdcBalance: usdc, keepUsdc, solUsd: await usdcPerSol(), hasKey: !!key() });
    if (!plan.ok) return { ok: false, reason: plan.reason };
    if (!plan.swap) return { ok: true, swapped: false };
    const swap = await swapTokens({ wallet: agent.agentWallet, secret: agent.agentWalletSecret }, { inputMint: getUsdcMint("mainnet-beta"), outputMint: WSOL, amount: Math.round(plan.usd * 1e6), ultra: plan.gasless }, new Connection(getRpcCandidates("mainnet-beta")[0], "confirmed"));
    if (!swap.ok) return { ok: false, reason: swap.reason };
    let after: number | null = sol;
    for (let i = 0; i < 6 && (after === null || after * 1e9 < GAS_FLOOR_LAMPORTS); i++) {
      await new Promise((r) => setTimeout(r, 1200));
      after = await getSolBalanceStrict(agent.agentWallet);
    }
    if (after === null || after * 1e9 < GAS_FLOOR_LAMPORTS) return { ok: false, reason: "swap_landed_but_sol_short" };
    console.info("[sol-swap] swapped USDC for network-fee SOL", { mintAddress, usd: plan.usd, gasless: plan.gasless, signature: swap.signature, router: swap.router });
    return { ok: true, swapped: true, signature: swap.signature };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 120) : "gas_swap_error" };
  }
}
