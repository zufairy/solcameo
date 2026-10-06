import { Connection, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { convexClient } from "@/lib/server/solstarRoute";
import { getRpcCandidates } from "@/lib/solana/network";
import { readPoolHistory, readMarketSwap } from "./marketLeaderboard";
import { migratedPool } from "./dammLifecycle";
import { rankTraders, type RpcTrade } from "@/lib/solstar/leaderboard";
import type { CalloutTrade } from "@/lib/solstar/calloutTrade";
/** Apply the leaderboard's FIFO basis to one wallet/coin, reconciling actual holdings. */
export function verifiedPosition(trades: RpcTrade[], wallet: string, mint: string, price: number, complete: boolean, actual: number) {
  const own = trades.filter(t => t.wallet === wallet && t.mint === mint);
  const unique = [...new Map(own.map(t => [t.signature, t])).values()];
  const expected = unique.reduce((n, t) => n + (t.side === "buy" ? t.units : -t.units), 0);
  if (!complete || !Number.isFinite(actual) || Math.abs(actual - expected) > 1 || !(price > 0)) return null;
  const rank = rankTraders(own, new Map([[mint, price]]), 0, complete)[0];
  const latest = unique.sort((a, b) => b.time - a.time || (b.slot ?? 0) - (a.slot ?? 0))[0];
  return rank?.pnlSol != null && latest ? { latest, pnlSol: rank.pnlSol, realizedSol: rank.realizedSol, unrealizedSol: rank.unrealizedSol } : null;
}
type Result = { coins: CalloutTrade[]; errors: string[]; network: "mainnet" | "devnet" };
const cache = new Map<string, { expires: number; promise: Promise<Result> }>();
export function loadCalloutTrades(wallet: string, mint?: string, refresh = false) {
  new PublicKey(wallet);
  const network = "mainnet" as const;
  const key = `${network}:${wallet}:${mint || "all"}`;
  const hit = cache.get(key); if (!refresh && hit && hit.expires > Date.now()) return hit.promise;
  const promise = scan(wallet, network, mint).catch(e => { cache.delete(key); throw e; });
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 15000, promise });
  return promise;
}
async function scan(wallet: string, network: "mainnet" | "devnet", selectedMint?: string): Promise<Result> {
  const clients = [convexClient()];
  const mirror = process.env.SOLCAMEO_LEADERBOARD_CONVEX_URL;
  if (mirror && mirror !== process.env.NEXT_PUBLIC_CONVEX_URL) clients.push(new ConvexHttpClient(mirror));
  const lists = await Promise.all(clients.map(async client => {
    const [targets, rows] = await Promise.all([client.query(api.solstarMarket.tokenomicsTargets, { network }), client.query(api.solstarMarket.listMarket, { network, sort: "new", liveOnly: true })]);
    return targets.map(t => ({ ...t, imageUrl: rows.find(r => String(r.characterId) === t.characterId)?.imageUrl || "/brand/solcameo-mark.png" }));
  }));
  const targets = [...new Map(lists.flat().map(t => [t.mint, t])).values()].filter(t => !selectedMint || t.mint === selectedMint);
  const coins: CalloutTrade[] = [], errors: string[] = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async () => {
    while (next < targets.length) {
      const target = targets[next++]; let succeeded = false;
      for (const endpoint of getRpcCandidates(network === "mainnet" ? "mainnet-beta" : "devnet")) {
        try {
          const connection = new Connection(endpoint, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }) });
          const address = new PublicKey(target.dbcPool), dbc = new DynamicBondingCurveClient(connection, "confirmed");
          const pool = await dbc.state.getPool(address); if (!pool || pool.poolState.baseMint.toBase58() !== target.mint) throw new Error("pool_unavailable");
          const [config, history, balances] = await Promise.all([dbc.state.getPoolConfig(pool.poolState.config), readPoolHistory(connection, address, network), connection.getParsedTokenAccountsByOwner(new PublicKey(wallet), { mint: pool.poolState.baseMint }, "confirmed")]);
          if (!config || !config.quoteMint.equals(NATIVE_MINT)) throw new Error("unsupported_quote");
          let price = (Number(pool.poolState.sqrtPrice.toString()) / 2 ** 64) ** 2 / 1e9;
          let complete = history.complete;
          const trades = history.transactions.flatMap(({ signature, tx }) => { const parsed = readMarketSwap(tx, signature, target.mint, target.dbcPool); return parsed?.trade ? [parsed.trade] : []; });
          if (pool.poolState.isMigrated) {
            const migrated = await migratedPool(connection, address); if (!migrated) throw new Error("pool_unavailable");
            const quoteIsB = migrated.state.tokenBMint.equals(NATIVE_MINT), sqrt = Number(migrated.state.sqrtPrice.toString()) / 2 ** 64;
            price = (quoteIsB ? sqrt * sqrt : 1 / (sqrt * sqrt)) / 1e9;
            const h = await readPoolHistory(connection, migrated.address, network); complete &&= h.complete;
            trades.push(...h.transactions.flatMap(({ signature, tx }) => { const parsed = readMarketSwap(tx, signature, target.mint, migrated.address.toBase58(), quoteIsB); return parsed?.trade ? [parsed.trade] : []; }));
          }
          const actual = balances.value.reduce((sum, a) => sum + Number(a.account.data.parsed.info.tokenAmount.amount), 0);
          const result = verifiedPosition(trades, wallet, target.mint, price, complete, actual);
          if (result) coins.push({ wallet, mint: target.mint, name: target.name, ticker: target.ticker, imageUrl: target.imageUrl, signature: result.latest.signature, side: result.latest.side, amountSol: result.latest.sol, time: result.latest.time, pnlSol: result.pnlSol, realizedSol: result.realizedSol, unrealizedSol: result.unrealizedSol, network });
          else if (trades.some(t => t.wallet === wallet)) errors.push(`${target.ticker}: complete trade history or cost basis unavailable`);
          succeeded = true; break;
        } catch { /* Same-cluster fallback, never assume a zero profit. */ }
      }
      if (!succeeded) errors.push(`${target.ticker}: RPC unavailable`);
    }
  }));
  return { coins: coins.sort((a, b) => b.time - a.time), errors, network };
}
