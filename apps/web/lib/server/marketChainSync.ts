import { marketRpcFetch } from "./marketRpcFetch";
import { Connection, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexClient, internalSecret } from "./solstarRoute";
import { getRpcCandidates } from "@/lib/solana/network";
import { readMarketSwap, readPoolHistory } from "./marketLeaderboard";
import { migratedPool } from "./dammLifecycle";
import type { RpcTrade } from "@/lib/solstar/leaderboard";

/**
 * Mirrors one coin's on-chain market into Convex: new swaps (decoded from Meteora's own events), the largest
 * holders and the pool price. The terminal subscribes to those Convex tables, so the browser never polls RPC for them.
 * Safe to call as often as you like: calls are coalesced per coin and Convex ignores swaps it already has.
 */
const MIN_GAP_MS = 10_000, OVERLAP_MS = 5 * 60_000, FIRST_SYNC_TRADES = 500, CHUNK = 100;
const lastRun = new Map<string, number>();
const inflight = new Map<string, Promise<SyncResult>>();
export type SyncResult = { ok: boolean; ingested: number; skipped?: string };

export function syncMarket(characterId: string): Promise<SyncResult> {
  const running = inflight.get(characterId);
  if (running) return running;
  if (Date.now() - (lastRun.get(characterId) ?? 0) < MIN_GAP_MS) return Promise.resolve({ ok: true, ingested: 0, skipped: "throttled" });
  lastRun.set(characterId, Date.now());
  if (lastRun.size > 500) lastRun.delete(lastRun.keys().next().value!);
  const work = run(characterId).finally(() => inflight.delete(characterId));
  inflight.set(characterId, work);
  return work;
}

async function run(characterId: string): Promise<SyncResult> {
  const secret = internalSecret();
  if (!secret) return { ok: false, ingested: 0, skipped: "not_configured" };
  const convex = convexClient();
  const id = characterId as Id<"ssCharacters">;
  const data = await convex.query(api.solstarMarket.terminal, { characterId: id });
  const token = data?.token;
  if (!token || token.network === "paper" || !token.mint || !token.dbcPool) return { ok: true, ingested: 0, skipped: "not_onchain" };
  const mint = token.mint, network = token.network as "mainnet" | "devnet", dbcPool = token.dbcPool;
  const state = await convex.query(api.solstarChain.syncState, { authSecret: secret, characterId: id });
  const since = state ? state.lastTime - OVERLAP_MS : 0;

  let lastError: unknown;
  for (const endpoint of getRpcCandidates(network === "mainnet" ? "mainnet-beta" : "devnet")) {
    try {
      const connection = new Connection(endpoint, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: marketRpcFetch });
      const poolAddress = new PublicKey(dbcPool), dbc = new DynamicBondingCurveClient(connection, "confirmed");
      const pool = await dbc.state.getPool(poolAddress);
      if (!pool || pool.poolState.baseMint.toBase58() !== mint) throw new Error("pool_unavailable");
      const config = await dbc.state.getPoolConfig(pool.poolState.config);
      if (!config || !config.quoteMint.equals(NATIVE_MINT)) throw new Error("unsupported_quote");

      let price = (Number(pool.poolState.sqrtPrice.toString()) / 2 ** 64) ** 2 / 1e9;
      if (pool.poolState.isMigrated) {
        const migrated = await migratedPool(connection, poolAddress);
        if (migrated) {
          const quoteIsB = migrated.state.tokenBMint.equals(NATIVE_MINT), sqrt = Number(migrated.state.sqrtPrice.toString()) / 2 ** 64;
          price = (quoteIsB ? sqrt * sqrt : 1 / (sqrt * sqrt)) / 1e9;

        }
      }

      const [supply, largest] = await Promise.all([
        connection.getTokenSupply(new PublicKey(mint), "confirmed"),
        connection.getTokenLargestAccounts(new PublicKey(mint), "confirmed"),
      ]);
      const decimals = supply.value.decimals, supplyRaw = supply.value.amount;
      const accounts = await connection.getMultipleParsedAccounts(largest.value.map((a) => a.address), { commitment: "confirmed" });
      const byOwner = new Map<string, bigint>();
      accounts.value.forEach((acc, i) => {
        const owner = (acc?.data as { parsed?: { info?: { owner?: string } } } | undefined)?.parsed?.info?.owner;
        if (owner) byOwner.set(owner, (byOwner.get(owner) ?? 0n) + BigInt(largest.value[i].amount));
      });
      const total = Number(supplyRaw) || 1;
      const holders = [...byOwner].filter(([, units]) => units > 0n).map(([wallet, units]) => ({
        wallet, units: units.toString(), supplyPct: (Number(units) / total) * 100,
        // Pool vaults are owned by a program-derived address, which is never on the ed25519 curve.
        isPool: !PublicKey.isOnCurve(new PublicKey(wallet).toBytes()),
      }));

      const common = { authSecret: secret, characterId: id, mint, network };
      const market = { priceSol: price, supplyRaw, decimals, slot: Math.min(supply.context.slot, largest.context.slot), holders };
      // Push holder data immediately; historical transaction scanning must not delay the first view.
      await convex.mutation(api.solstarChain.ingest, { ...common, swaps: [], market });
      const history = await readPoolHistory(connection, poolAddress, network);
      const trades: RpcTrade[] = history.transactions.flatMap(({ signature, tx }) => { const p = readMarketSwap(tx, signature, mint, dbcPool); return p?.trade ? [p.trade] : []; });
      if (pool.poolState.isMigrated) {
        const migrated = await migratedPool(connection, poolAddress);
        if (migrated) {
          const quoteIsB = migrated.state.tokenBMint.equals(NATIVE_MINT);
          const h = await readPoolHistory(connection, migrated.address, network);
          trades.push(...h.transactions.flatMap(({ signature, tx }) => { const p = readMarketSwap(tx, signature, mint, migrated.address.toBase58(), quoteIsB); return p?.trade ? [p.trade] : []; }));
        }
      }
      const fresh = trades.filter((t) => t.time > since).sort((a, b) => a.time - b.time).slice(state ? 0 : -FIRST_SYNC_TRADES);
      const swaps = fresh.map((t) => { const units = t.units / 10 ** decimals; return { signature: t.signature, wallet: t.wallet, side: t.side, units, sol: t.sol, priceSol: units > 0 ? t.sol / units : price, time: t.time }; });
      let ingested = 0;
      for (let i = 0; i < swaps.length; i += CHUNK) ingested += (await convex.mutation(api.solstarChain.ingest, { ...common, swaps: swaps.slice(i, i + CHUNK) })).applied;
      return { ok: true, ingested };
    } catch (e) { lastError = e; }
  }
  const limited = /429|too many requests/i.test(lastError instanceof Error ? lastError.message : "");
  if (limited) lastRun.set(characterId, Date.now() + 20_000);
  const message = limited ? "Market updates are temporarily delayed. Retrying shortly." : "Market updates temporarily unavailable. Retrying shortly.";
  try { await convex.mutation(api.solstarChain.ingest, { authSecret: secret, characterId: id, mint, network, swaps: [], error: message.slice(0, 120) }); } catch { /* Convex keeps the last good data */ }
  return { ok: false, ingested: 0, skipped: message };
}
