import { Connection, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { BorshCoder, EventParser, type Idl } from "@coral-xyz/anchor";
import { DynamicBondingCurveIdl, DYNAMIC_BONDING_CURVE_PROGRAM_ID, DAMM_V2_PROGRAM_ID } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmmIdl } from "@meteora-ag/cp-amm-sdk";
import bs58 from "bs58";
import type { RpcTrade } from "@/lib/solstar/leaderboard";
const coders = [new BorshCoder(DynamicBondingCurveIdl as unknown as Idl), new BorshCoder(CpAmmIdl as unknown as Idl)];
const programs = [DYNAMIC_BONDING_CURVE_PROGRAM_ID, DAMM_V2_PROGRAM_ID];
type SwapEvent = { version: number; pool: string; direction: number; input: number; output: number; fee: number };
function swapEvent(name: string, value: unknown): SwapEvent | null {
  if (!name.toLowerCase().includes("swap")) return null;
  const d = value as Record<string, unknown>, r = (d.swap_result ?? d.swapResult) as Record<string, unknown> | undefined;
  if (!r || !d.pool) return null;
  const input = Number(String(r.included_fee_input_amount ?? r.includedFeeInputAmount ?? d.amount_in ?? d.amountIn ?? r.actual_input_amount ?? r.actualInputAmount));
  const output = Number(String(r.output_amount ?? r.outputAmount));
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return { version: name.includes("2") ? 2 : 1, pool: String(d.pool), direction: Number(d.trade_direction ?? d.tradeDirection), input, output, fee: Number(String(r.trading_fee ?? r.tradingFee ?? 0)) };
}
/** Decode Meteora's own events, including Anchor event-CPI inner instructions.
 * Native wallet balance deltas are deliberately avoided: they include ATA rent. */
export function readMarketSwap(tx: ParsedTransactionWithMeta, signature: string, mint: string, pool: string, quoteIsB = true): { trade: RpcTrade | null; fee: number } | null {
  if (!tx.meta || tx.meta.err || !tx.blockTime) return null;
  const events: SwapEvent[] = [];
  for (let i = 0; i < coders.length; i++) {
    const fromLogs: SwapEvent[] = [];
    try { for (const e of new EventParser(programs[i], coders[i]).parseLogs(tx.meta.logMessages ?? [])) { const parsed = swapEvent(e.name, e.data); if (parsed?.pool === pool) fromLogs.push(parsed); } } catch { /* CPI below also carries events */ }
    if (fromLogs.length) { events.push(...fromLogs); continue; }
    for (const group of tx.meta.innerInstructions ?? []) for (const instruction of group.instructions) {
      if (!("data" in instruction) || !instruction.programId.equals(programs[i])) continue;
      try {
        const raw = bs58.decode(instruction.data);
        const decoded = coders[i].events.decode(Buffer.from(raw.slice(8)).toString("base64"));
        if (!decoded) continue;
        const parsed = swapEvent(decoded.name, decoded.data);
        if (parsed?.pool === pool) events.push(parsed);
      } catch { /* unrelated instruction */ }
    }
  }
  if (!events.length) return null;
  // DBC emits legacy EvtSwap and EvtSwap2 for the same swap. Prefer v2
  // without dropping repeated swaps that happen to have the same amounts.
  const swaps = events.filter(e => e.version === 2 || !events.some(v => v.version === 2 && v.pool === e.pool && v.direction === e.direction && v.input === e.input && v.output === e.output && v.fee === e.fee));
  // Wallet-owned mint balance identifies the actual trader, even with an aggregator payer.
  const balances = [...(tx.meta.preTokenBalances ?? []), ...(tx.meta.postTokenBalances ?? [])];
  const keys = tx.transaction.message.accountKeys;
  const owners = [...new Set(balances.filter(b => b.mint === mint && b.owner).map(b => b.owner!))];
  const wallet = owners.find(owner => keys.some(k => k.signer && k.pubkey.toBase58() === owner));
  const fee = swaps.reduce((n, e) => n + e.fee, 0);
  if (!wallet) return { trade: null, fee };
  const balance = (list: typeof balances) => list.filter(b => b.mint === mint && b.owner === wallet).reduce((n, b) => n + Number(b.uiTokenAmount.amount), 0);
  const delta = balance(tx.meta.postTokenBalances ?? []) - balance(tx.meta.preTokenBalances ?? []);
  const buy = delta > 0;
  // DBC uses BaseToQuote=0, QuoteToBase=1. DAMM token A/B can be reversed.
  const wantedDirection = buy ? (quoteIsB ? 1 : 0) : (quoteIsB ? 0 : 1);
  if (!delta || swaps.some(e => e.direction !== wantedDirection)) return { trade: null, fee };
  const sol = swaps.reduce((n, e) => n + (buy ? e.input : e.output), 0) / 1e9;
  const feePayer = keys[0].pubkey.toBase58();
  return { trade: { signature, wallet, mint, side: buy ? "buy" : "sell", units: Math.abs(delta), sol, networkFeeSol: wallet === feePayer ? tx.meta.fee / 1e9 : 0, time: tx.blockTime * 1000, slot: tx.slot }, fee };
}
const txCache = new Map<string, ParsedTransactionWithMeta>();
/** Paginate beyond the terminal's 12 recent trades. Missing/pruned transactions
 * make the result incomplete, so no fabricated zero-cost P&L is displayed. */
type History = { transactions: { signature: string; tx: ParsedTransactionWithMeta }[]; complete: boolean; newest?: string };
const historyCache = new Map<string, History>();
const pendingHistory = new Map<string, Promise<History>>();
export async function readPoolHistory(connection: Connection, pool: PublicKey, network: string) {
  const key = `${network}:${pool.toBase58()}`;
  const pending = pendingHistory.get(key);
  if (pending) return pending;
  const work = scanPoolHistory(connection, pool, network, historyCache.get(key)).then(result => {
    if (result.complete) {
      if (historyCache.size >= 200) historyCache.delete(historyCache.keys().next().value!);
      historyCache.set(key, result);
    }
    return result;
  }).finally(() => pendingHistory.delete(key));
  pendingHistory.set(key, work);
  return work;
}
async function scanPoolHistory(connection: Connection, pool: PublicKey, network: string, previous?: History): Promise<History> {
  let before: string | undefined;
  let complete = false;
  let newest: string | undefined;
  const transactions: { signature: string; tx: ParsedTransactionWithMeta }[] = [];
  for (let page = 0; page < 10; page++) {
    const signatures = await connection.getSignaturesForAddress(pool, { limit: 100, before, ...(previous?.newest ? { until: previous.newest } : {}) }, "confirmed");
    if (page === 0) newest = signatures[0]?.signature ?? previous?.newest;
    for (let offset = 0; offset < signatures.length; offset += 4) {
      const chunk = await Promise.all(signatures.slice(offset, offset + 4).map(async s => {
        if (s.err) return null;
        const key = `${network}:${s.signature}`;
        const tx = txCache.get(key) ?? await connection.getParsedTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (!tx) throw new Error("RPC trade history is not fully available yet");
        if (txCache.size >= 2000) txCache.delete(txCache.keys().next().value!);
        txCache.set(key, tx);
        return { signature: s.signature, tx };
      }));
      transactions.push(...chunk.filter(t => t !== null));
    }
    if (signatures.length < 100) { complete = true; break; }
    before = signatures.at(-1)?.signature;
  }
  return { transactions: [...transactions, ...(previous?.transactions ?? [])], complete, newest };
}
