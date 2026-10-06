import { Connection, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { api } from "@/convex/_generated/api";
import { convexClient } from "@/lib/server/solstarRoute";
import { getNetwork, getRpcCandidates } from "@/lib/solana/network";
import { readPoolHistory, readMarketSwap } from "./marketLeaderboard";
import { migratedPool } from "./dammLifecycle";
import { positionFromTrades, type Position } from "@/lib/solstar/position";
import type { RpcTrade } from "@/lib/solstar/leaderboard";

export interface MarketPosition extends Position {
  wallet: string; mint: string; network: "mainnet" | "devnet";
  /** Whole tokens the wallet actually holds right now (chain truth). */
  heldTokens: number;
  /** True when history and holdings agree, so the entry price and P&L can be trusted. */
  verified: boolean;
  checkedAt: number;
}

const cache = new Map<string, { expires: number; promise: Promise<MarketPosition | null> }>();

/** Position of one wallet in one coin: holdings from chain, entry and P&L from the pool's swap history (curve plus DAMM v2 after graduation). */
export function loadMarketPosition(wallet: string, mint: string, refresh = false): Promise<MarketPosition | null> {
  new PublicKey(wallet); new PublicKey(mint);
  const network = getNetwork() === "mainnet-beta" ? "mainnet" : "devnet";
  const key = `${network}:${wallet}:${mint}`;
  const hit = cache.get(key);
  if (!refresh && hit && hit.expires > Date.now()) return hit.promise;
  const promise = compute(wallet, mint, network).catch((e) => { cache.delete(key); throw e; });
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 8000, promise });
  return promise;
}

async function compute(wallet: string, mint: string, network: "mainnet" | "devnet"): Promise<MarketPosition | null> {
  const targets = await convexClient().query(api.solstarMarket.tokenomicsTargets, { network });
  const target = targets.find((t) => t.mint === mint);
  if (!target) return null;
  let lastError: unknown;
  for (const endpoint of getRpcCandidates(network === "mainnet" ? "mainnet-beta" : "devnet")) {
    try {
      const connection = new Connection(endpoint, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }) });
      const poolAddress = new PublicKey(target.dbcPool), dbc = new DynamicBondingCurveClient(connection, "confirmed");
      const pool = await dbc.state.getPool(poolAddress);
      if (!pool || pool.poolState.baseMint.toBase58() !== mint) throw new Error("pool_unavailable");
      const [config, history, balances] = await Promise.all([
        dbc.state.getPoolConfig(pool.poolState.config),
        readPoolHistory(connection, poolAddress, network),
        connection.getParsedTokenAccountsByOwner(new PublicKey(wallet), { mint: pool.poolState.baseMint }, "confirmed"),
      ]);
      if (!config || !config.quoteMint.equals(NATIVE_MINT)) throw new Error("unsupported_quote");
      let price = (Number(pool.poolState.sqrtPrice.toString()) / 2 ** 64) ** 2 / 1e9;
      let complete = history.complete;
      const trades: RpcTrade[] = history.transactions.flatMap(({ signature, tx }) => { const p = readMarketSwap(tx, signature, mint, target.dbcPool); return p?.trade ? [p.trade] : []; });
      if (pool.poolState.isMigrated) {
        const migrated = await migratedPool(connection, poolAddress);
        if (!migrated) throw new Error("pool_unavailable");
        const quoteIsB = migrated.state.tokenBMint.equals(NATIVE_MINT), sqrt = Number(migrated.state.sqrtPrice.toString()) / 2 ** 64;
        price = (quoteIsB ? sqrt * sqrt : 1 / (sqrt * sqrt)) / 1e9;
        const h = await readPoolHistory(connection, migrated.address, network);
        complete &&= h.complete;
        trades.push(...h.transactions.flatMap(({ signature, tx }) => { const p = readMarketSwap(tx, signature, mint, migrated.address.toBase58(), quoteIsB); return p?.trade ? [p.trade] : []; }));
      }
      const decimals = balances.value[0]?.account.data.parsed.info.tokenAmount.decimals ?? 6;
      const actual = balances.value.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.amount), 0);
      const mine = trades.filter((t) => t.wallet === wallet);
      const position = positionFromTrades(mine, price, decimals);
      const expected = position.tokens * 10 ** decimals;
      const verified = complete && position.complete && Math.abs(actual - expected) <= 1;
      return { ...position, wallet, mint, network, heldTokens: actual / 10 ** decimals, verified, checkedAt: Date.now() };
    } catch (e) { lastError = e; }
  }
  throw lastError instanceof Error ? lastError : new Error("rpc_unavailable");
}
