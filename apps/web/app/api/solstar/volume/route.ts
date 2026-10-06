import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { api } from "@/convex/_generated/api";
import { convexClient } from "@/lib/server/solstarRoute";
import { getRpcCandidates } from "@/lib/solana/network";
import { migratedPool } from "@/lib/server/dammLifecycle";
import { readMarketSwap, readPoolHistory } from "@/lib/server/marketLeaderboard";

export const runtime = "nodejs";
export const maxDuration = 60;

type Volume = { network: "mainnet"; volumeSol: number; volume24hSol: number; pools: number; complete: boolean; checkedAt: number };
let cached: { expires: number; value: Promise<Volume> } | null = null;

/** All-time and 24h SOL traded across every live mainnet bonding-curve and graduated pool, read from chain history. */
async function load(): Promise<Volume> {
  const rows = (await convexClient().query(api.solstarMarket.listMarket, { sort: "new", network: "mainnet", liveOnly: true })).filter(r => r.dbcPool);
  const dayAgo = Date.now() - 86_400_000;
  let volumeSol = 0, volume24hSol = 0, complete = true;
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      let ok = false;
      for (const endpoint of getRpcCandidates("mainnet-beta")) {
        try {
          const connection = new Connection(endpoint, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }) });
          const address = new PublicKey(row.dbcPool!);
          const pool = await new DynamicBondingCurveClient(connection, "confirmed").state.getPool(address);
          if (!pool) throw new Error("Pool unavailable");
          const mint = pool.poolState.baseMint.toBase58();
          const sources = [{ history: await readPoolHistory(connection, address, "mainnet"), pool: address.toBase58(), quoteIsB: true }];
          if (pool.poolState.isMigrated) {
            const migrated = await migratedPool(connection, address);
            if (migrated) sources.push({ history: await readPoolHistory(connection, migrated.address, "mainnet"), pool: migrated.address.toBase58(), quoteIsB: migrated.state.tokenBMint.equals(NATIVE_MINT) });
          }
          let poolVolume = 0, pool24h = 0, poolComplete = true;
          for (const s of sources) {
            if (!s.history.complete) poolComplete = false;
            for (const { signature, tx } of s.history.transactions) {
              const trade = readMarketSwap(tx, signature, mint, s.pool, s.quoteIsB)?.trade;
              if (!trade) continue;
              poolVolume += trade.sol;
              if (trade.time >= dayAgo) pool24h += trade.sol;
            }
          }
          volumeSol += poolVolume;
          volume24hSol += pool24h;
          if (!poolComplete) complete = false;
          ok = true;
          break;
        } catch { /* try the next RPC endpoint */ }
      }
      if (!ok) complete = false;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { network: "mainnet", volumeSol, volume24hSol, pools: rows.length, complete, checkedAt: Date.now() };
}

export async function GET() {
  try {
    if (!cached || cached.expires <= Date.now()) {
      const entry: { expires: number; value: Promise<Volume> } = { expires: Infinity, value: Promise.resolve(null as unknown as Volume) };
      entry.value = load().then(v => { entry.expires = Date.now() + 15_000; return v; });
      cached = entry;
    }
    return NextResponse.json(await cached.value, { headers: { "Cache-Control": "no-store" } });
  } catch {
    cached = null;
    return NextResponse.json({ error: "Trading volume is temporarily unavailable" }, { status: 503 });
  }
}
