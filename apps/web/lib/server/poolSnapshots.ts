import { NATIVE_MINT } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { api } from "@/convex/_generated/api";
import { marketCapSol } from "@/lib/meteora/poolPrice";
import { migratedPool } from "@/lib/server/dammLifecycle";
import { getObjectText, listImageObjects } from "@/lib/server/imageStorage";
import { assertSolanaChain } from "@/lib/server/solanaChainGuard";
import { convexClient } from "@/lib/server/solstarRoute";
import { TtlCache, mapLimit } from "@/lib/server/ttlCache";
import { getNetwork, getRpcUrl } from "@/lib/solana/network";

/**
 * Live pool numbers for the market, built in layers that each cache for as long as the data really stays true:
 *   refs (which pools exist)  15s   one cheap Convex read
 *   static (supply, curve)    10min barely changes
 *   history (R2 trade marks)  30s   was re-listed and re-downloaded (up to 500 objects) on every poll
 *   live (pool account)       2s    ONE getMultipleAccounts for every coin instead of 3-4 RPC calls per coin
 * Concurrent callers share one load, and a failing RPC serves the last good value.
 */
export type PoolRef = { characterId: string; network: "devnet" | "mainnet"; mint: string; dbcPool: string; dbcConfig: string };
type Point = { time: number; price: number; volume: number; side?: "buy" | "sell" };
export type PoolSnapshot = {
  available: true; points: Point[]; appVolume24hLamports: string; appTrades24h: number; historyScope: string;
  reserveSol: number; targetSol: number; progress: number; migrated: boolean; capSol: number; supplyTokens: number;
  change24hPct: number | null; changeSinceLaunchPct: number | null; checkedAt: number; pool: string;
};

const refsCache = new TtlCache<PoolRef[]>(15_000, 4);
const staticCache = new TtlCache<{ supplyTokens: number; decimals: number; launchCapSol: number; targetSol: number }>(600_000, 300);
const historyCache = new TtlCache<{ points: Point[]; vol: bigint; trades: number }>(30_000, 300);
type Live = { reserveSol: number; sqrt: number; migrated: boolean };
const liveCache = new TtlCache<Map<string, Live>>(2_000, 20);
const chainCache = new TtlCache<true>(600_000, 4);
const connections = new Map<string, Connection>();

function connectionFor(network: PoolRef["network"]): Connection {
  const chain = network === "mainnet" ? "mainnet-beta" : "devnet";
  const url = chain === getNetwork() ? process.env.SOLCAMEO_DBC_RPC_URL || getRpcUrl(chain) : getRpcUrl(chain);
  let c = connections.get(url);
  if (!c) { c = new Connection(url, { commitment: "confirmed", fetch: (u, init) => fetch(u, { ...init, signal: AbortSignal.timeout(8000) }) }); connections.set(url, c); }
  return c;
}

export function poolRefs(network: PoolRef["network"]): Promise<PoolRef[]> {
  return refsCache.get(network, async () => (await convexClient().query(api.solstarMarket.poolRefs, { network })) as PoolRef[]);
}
export async function poolRefFor(characterId: string): Promise<PoolRef | null> {
  for (const n of ["mainnet", "devnet"] as const) {
    const hit = (await poolRefs(n).catch(() => [])).find((r) => r.characterId === characterId);
    if (hit) return hit;
  }
  return null;
}

async function staticFor(ref: PoolRef, client: DynamicBondingCurveClient, conn: Connection) {
  return staticCache.get(ref.mint, async () => {
    const [config, supply] = await Promise.all([client.state.getPoolConfig(new PublicKey(ref.dbcConfig)), conn.getTokenSupply(new PublicKey(ref.mint), "confirmed")]);
    if (!config) throw new Error("Pool config unavailable");
    const supplyTokens = Number(supply.value.amount) / 10 ** supply.value.decimals;
    const start = Number(config.sqrtStartPrice.toString()) / 2 ** 64;
    return { supplyTokens, decimals: supply.value.decimals, launchCapSol: start * start * 10 ** (supply.value.decimals - 9) * supplyTokens, targetSol: Number(config.migrationQuoteThreshold.toString()) / 1e9 };
  });
}

function historyFor(characterId: string) {
  return historyCache.get(characterId, async () => {
    let points: Point[] = []; let vol = 0n; let trades = 0;
    try {
      const records = (await listImageObjects(`dbc-trades/${characterId}/`)).slice(0, 500);
      const samples = await mapLimit(records, 16, async (r) => JSON.parse((await getObjectText(r.key)) ?? "null"));
      points = samples.filter((s) => s && Number.isFinite(s.capSol) && Number.isFinite(s.time)).map((s) => ({ time: s.observedAt ?? s.time, price: s.capSol, volume: Number(s.volumeLamports) / 1e9, side: s.side })).sort((a, b) => a.time - b.time);
      for (const s of samples) if (s && s.time >= Date.now() - 86_400_000) { vol += BigInt(s.volumeLamports); trades++; }
    } catch { /* Current pool state stays available if the observation store is down. */ }
    return { points, vol, trades };
  });
}

/** Read every pool account for one network in a single RPC round trip (chunked at the 100-account RPC limit). */
async function loadLive(refs: PoolRef[], client: DynamicBondingCurveClient): Promise<Map<string, Live>> {
  const out = new Map<string, Live>();
  for (let i = 0; i < refs.length; i += 100) {
    const chunk = refs.slice(i, i + 100);
    const accounts = await client.state.program.account.virtualPool.fetchMultiple(chunk.map((r) => new PublicKey(r.dbcPool)));
    chunk.forEach((r, j) => {
      const a = accounts[j]?.poolState;
      if (!a || a.baseMint.toBase58() !== r.mint) return;
      out.set(r.dbcPool, { reserveSol: Number(a.quoteReserve.toString()) / 1e9, sqrt: Number(a.sqrtPrice.toString()) / 2 ** 64, migrated: !!a.isMigrated });
    });
  }
  return out;
}

async function buildOne(ref: PoolRef, live: Live, conn: Connection, client: DynamicBondingCurveClient, maxPoints: number): Promise<PoolSnapshot> {
  const [st, hist] = await Promise.all([staticFor(ref, client, conn), historyFor(ref.characterId)]);
  const units = 10 ** (st.decimals - 9);
  let capSol = live.sqrt * live.sqrt * units * st.supplyTokens;
  if (live.migrated) {
    const m = await migratedPool(conn, new PublicKey(ref.dbcPool));
    if (!m) throw new Error("Graduated pool unavailable");
    capSol = marketCapSol(Number(m.state.sqrtPrice.toString()) / 2 ** 64, st.supplyTokens, st.decimals, m.state.tokenBMint.equals(NATIVE_MINT));
  }
  const dayAgo = Date.now() - 86_400_000;
  const base = [...hist.points].reverse().find((p) => p.time <= dayAgo)?.price ?? st.launchCapSol;
  const history = hist.points.length > maxPoints ? hist.points.filter((_, i) => i % Math.ceil(hist.points.length / (maxPoints - 1)) === 0).slice(-(maxPoints - 1)) : hist.points;
  return {
    available: true, points: [...history, { time: Date.now(), price: capSol, volume: 0 }],
    appVolume24hLamports: hist.vol.toString(), appTrades24h: hist.trades, historyScope: "confirmed_app_trades_and_rpc_observations",
    reserveSol: live.reserveSol, targetSol: st.targetSol, progress: live.migrated ? 1 : Math.min(1, live.reserveSol / st.targetSol), migrated: live.migrated,
    capSol, supplyTokens: st.supplyTokens, change24hPct: base > 0 ? (capSol / base - 1) * 100 : null,
    changeSinceLaunchPct: st.launchCapSol > 0 ? (capSol / st.launchCapSol - 1) * 100 : null, checkedAt: Date.now(), pool: ref.dbcPool,
  };
}

/** Snapshots for many pools of one network. Coins that fail are omitted; the rest still return. */
export async function snapshotMany(refs: PoolRef[], network: PoolRef["network"], maxPoints = 1000): Promise<Record<string, PoolSnapshot>> {
  if (!refs.length) return {};
  const conn = connectionFor(network);
  const client = new DynamicBondingCurveClient(conn, "confirmed");
  await chainCache.get(network, async () => { await assertSolanaChain(conn, network); return true as const; });
  const key = `${network}:${refs.map((r) => r.dbcPool).sort().join(",")}`;
  const live = await liveCache.get(key, () => loadLive(refs, client));
  const entries = await mapLimit(refs, 8, async (r) => {
    const l = live.get(r.dbcPool);
    if (!l) return null;
    try { return [r.characterId, await buildOne(r, l, conn, client, maxPoints)] as const; } catch { return null; }
  });
  return Object.fromEntries(entries.filter((e): e is NonNullable<typeof e> => !!e));
}
