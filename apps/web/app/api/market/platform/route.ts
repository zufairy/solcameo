import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { api } from "@/convex/_generated/api";
import { convexClient } from "@/lib/server/solstarRoute";
import { dbcConnection, dbcReadiness } from "@/lib/server/meteoraLaunch";
import { marketCapSol } from "@/lib/meteora/poolPrice";
import { migratedPool } from "@/lib/server/dammLifecycle";

export const runtime = "nodejs";
export const maxDuration = 20;

type Snapshot = {
  available: true; characterId: string | null; name: string; ticker: string; mint: string; pool: string; image: string;
  capSol: number | null; changeSinceLaunchPct: number | null; progress: number; reserveSol: number; targetSol: number; migrated: boolean; checkedAt: number;
};
const TTL_MS = 3000;
let cache: { at: number; data: Snapshot } | null = null;
let inflight: Promise<Snapshot | null> | null = null;

/** Live SOLCAMEO market numbers, read straight from the Meteora pool on Solana. */
async function compute(): Promise<Snapshot | null> {
  const network = dbcReadiness().network;
  const row = await convexClient().query(api.platformLaunch.get, { network, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
  if (!row || row.state !== "live" || !row.pool || !row.mint || !row.config) return null;
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  let listing = await convexClient().query(api.platformLaunch.listing, { network, authSecret: secret }).catch(() => null);
  // A live token with no market listing (the link step failed, or it went live before listing existed) heals itself here,
  // so /market/<id> and the trade box always exist for it. linkListing is idempotent.
  if (!listing) listing = await convexClient().mutation(api.platformLaunch.linkListing, { network, authSecret: secret }).catch(() => null);
  const connection = dbcConnection();
  const client = new DynamicBondingCurveClient(connection, "confirmed");
  const poolKey = new PublicKey(row.pool);
  const [pool, config, supply] = await Promise.all([
    client.state.getPool(poolKey), client.state.getPoolConfig(new PublicKey(row.config)), connection.getTokenSupply(new PublicKey(row.mint), "confirmed"),
  ]);
  if (!pool || !config) throw new Error("Pool unavailable");
  const decimals = supply.value.decimals;
  const supplyTokens = Number(supply.value.amount) / 10 ** decimals;
  const units = 10 ** (decimals - 9);
  const startSqrt = Number(config.sqrtStartPrice.toString()) / 2 ** 64;
  const launchCap = startSqrt * startSqrt * units * supplyTokens;
  let capSol: number | null = null;
  if (pool.poolState.isMigrated) {
    const migrated = await migratedPool(connection, poolKey);
    if (migrated) capSol = marketCapSol(Number(migrated.state.sqrtPrice.toString()) / 2 ** 64, supplyTokens, decimals, migrated.state.tokenBMint.equals(new PublicKey("So11111111111111111111111111111111111111112")));
  } else {
    const sqrt = Number(pool.poolState.sqrtPrice.toString()) / 2 ** 64;
    capSol = sqrt * sqrt * units * supplyTokens;
  }
  const reserveSol = Number(pool.poolState.quoteReserve.toString()) / 1e9;
  const targetSol = Number(config.migrationQuoteThreshold.toString()) / 1e9;
  return {
    available: true, characterId: listing?.characterId ?? null, name: row.name, ticker: row.ticker, mint: row.mint, pool: row.pool, image: row.image,
    capSol, changeSinceLaunchPct: capSol != null && launchCap > 0 ? (capSol / launchCap - 1) * 100 : null,
    progress: pool.poolState.isMigrated ? 1 : Math.min(1, targetSol > 0 ? reserveSol / targetSol : 0), reserveSol, targetSol,
    migrated: !!pool.poolState.isMigrated, checkedAt: Date.now(),
  };
}

export async function GET() {
  const headers = { "Cache-Control": "public, s-maxage=2, stale-while-revalidate=6" };
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data, { headers });
  try {
    inflight ??= compute().finally(() => { inflight = null; });
    const data = await inflight;
    if (!data) return NextResponse.json({ available: false }, { headers });
    cache = { at: Date.now(), data };
    return NextResponse.json(data, { headers });
  } catch {
    if (cache) return NextResponse.json({ ...cache.data, stale: true }, { headers });
    return NextResponse.json({ available: false, error: "Market data temporarily unavailable" }, { status: 503 });
  }
}
