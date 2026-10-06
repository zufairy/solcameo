import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { getNetwork } from "@/lib/solana/network";
import { rpcCandidates, rpcTry } from "@/lib/solana/rpc";
import { feeBreakdown } from "@/lib/tokenomics/liveMath";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Live tokenomics, straight from Solana RPC.
 * For every launched coin we read three kinds of accounts in batched calls:
 *   - the Meteora DBC virtual pool  → SOL held by the curve, fee counters (creator+partner pot / protocol / unclaimed creator)
 *   - the pool config               → graduation target, creator fee share
 *   - the token mint                → current supply, so burned = fixed supply − supply
 * Nothing is estimated from the database; Convex only tells us WHICH addresses to read. Results are cached for
 * a few seconds and concurrent requests share one RPC round trip.
 */
type Target = { characterId: string; name: string; ticker: string; mint: string; dbcPool: string; dbcConfig: string; state: string };
export interface LiveCoin {
  characterId: string; name: string; ticker: string; pool: string; mint: string;
  reserveSol: number; targetSol: number; progress: number; migrated: boolean;
  feesSol: number; creatorEarnedSol: number; creatorClaimedSol: number; creatorUnclaimedSol: number; platformEarnedSol: number; platformClaimedSol: number; platformUnclaimedSol: number; protocolSol: number;
  supplyTokens: number; burnedTokens: number; capSol: number | null;
}
export interface LiveTokenomics {
  ok: true; network: string; slot: number; fetchedAt: number;
  totals: {
    coins: number; graduated: number; reserveSol: number; marketCapSol: number; feesSol: number;
    creatorEarnedSol: number; creatorClaimedSol: number; creatorUnclaimedSol: number; platformEarnedSol: number; platformClaimedSol: number; platformUnclaimedSol: number; protocolSol: number;
    burnedTokens: number; supplyTokens: number; fixedSupplyTokens: number;
  };
  coins: LiveCoin[];
}

const TARGETS = makeFunctionReference<"query">("solstarMarket:tokenomicsTargets");
const FIXED_SUPPLY = 1_000_000_000;
const TTL_MS = 3000;
let cache: { at: number; data: LiveTokenomics } | null = null;
let inflight: Promise<LiveTokenomics> | null = null;

const sol = (v: unknown) => Number(String(v ?? 0)) / 1e9;
const chunk = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function compute(): Promise<LiveTokenomics> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("Convex not configured");
  const network = getNetwork();
  const dbNetwork = network === "mainnet-beta" ? "mainnet" : "devnet";
  const targets = (await new ConvexHttpClient(convexUrl).query(TARGETS, { network: dbNetwork })) as Target[];
  const urls = rpcCandidates(network);

  const run = <T,>(fn: (c: Connection) => Promise<T>) => rpcTry(urls, fn);
  const slot = await run((c) => c.getSlot("confirmed")).catch(() => 0);
  if (targets.length === 0) return { ok: true, network, slot, fetchedAt: Date.now(), totals: { coins: 0, graduated: 0, reserveSol: 0, marketCapSol: 0, feesSol: 0, creatorEarnedSol: 0, creatorClaimedSol: 0, creatorUnclaimedSol: 0, platformEarnedSol: 0, platformClaimedSol: 0, platformUnclaimedSol: 0, protocolSol: 0, burnedTokens: 0, supplyTokens: 0, fixedSupplyTokens: FIXED_SUPPLY }, coins: [] };

  // Mint accounts: supply + decimals (SPL and Token-2022 share the first 82 bytes of layout).
  const mintInfos = (await Promise.all(chunk(targets, 100).map((g) => run((c) => c.getMultipleAccountsInfo(g.map((t) => new PublicKey(t.mint)), "confirmed"))))).flat();

  // DBC pools + configs through the SDK's anchor coder, one batched call each.
  type Acc = { fetchMultiple: (k: PublicKey[]) => Promise<unknown[]> };
  const poolKeys = targets.map((t) => new PublicKey(t.dbcPool)), cfgKeys = targets.map((t) => new PublicKey(t.dbcConfig));
  const [pools, configs] = await Promise.all([
    run(async (c) => {
      const accounts = new DynamicBondingCurveClient(c, "confirmed").state.program.account as unknown as { virtualPool: Acc };
      return (await Promise.all(chunk(poolKeys, 100).map((g) => accounts.virtualPool.fetchMultiple(g)))).flat();
    }),
    run(async (c) => {
      const accounts = new DynamicBondingCurveClient(c, "confirmed").state.program.account as unknown as { poolConfig: Acc };
      return (await Promise.all(chunk(cfgKeys, 100).map((g) => accounts.poolConfig.fetchMultiple(g)))).flat();
    }),
  ]);

  const coins: LiveCoin[] = [];
  targets.forEach((t, i) => {
    const pool = (pools[i] as { poolState?: Record<string, unknown> } | null)?.poolState ?? null, cfg = configs[i] as Record<string, unknown> | null, mint = mintInfos[i];
    if (!pool || !cfg || !mint) return;
    const metrics = (pool.metrics ?? {}) as Record<string, unknown>;
    const decimals = mint.data[44], supplyRaw = mint.data.readBigUInt64LE(36);
    const supplyTokens = Number(supplyRaw) / 10 ** decimals;
    const reserveSol = sol(pool.quoteReserve), targetSol = sol(cfg.migrationQuoteThreshold);
    // On-chain counters, see lib/tokenomics/liveMath.ts for what each field means.
    const f = feeBreakdown({ totalTradingQuoteFee: metrics.totalTradingQuoteFee, totalProtocolQuoteFee: metrics.totalProtocolQuoteFee, creatorTradingFeePercentage: cfg.creatorTradingFeePercentage, creatorQuoteFee: pool.creatorQuoteFee, partnerQuoteFee: pool.partnerQuoteFee });
    const migrated = Number(pool.isMigrated ?? 0) === 1;
    const sqrt = Number(String(pool.sqrtPrice ?? 0)) / 2 ** 64, units = 10 ** (decimals - 9);
    coins.push({
      characterId: t.characterId, name: t.name, ticker: t.ticker, pool: t.dbcPool, mint: t.mint,
      reserveSol, targetSol, progress: migrated ? 1 : targetSol > 0 ? Math.min(1, reserveSol / targetSol) : 0, migrated,
      ...f,
      supplyTokens, burnedTokens: Math.max(0, FIXED_SUPPLY - supplyTokens), capSol: migrated ? null : sqrt * sqrt * units * supplyTokens,
    });
  });
  coins.sort((a, b) => b.feesSol - a.feesSol || b.reserveSol - a.reserveSol);
  const sum = (f: (c: LiveCoin) => number) => coins.reduce((s, c) => s + f(c), 0);
  return {
    ok: true, network, slot, fetchedAt: Date.now(), coins,
    totals: {
      coins: coins.length, graduated: coins.filter((c) => c.migrated).length,
      reserveSol: sum((c) => (c.migrated ? 0 : c.reserveSol)), marketCapSol: sum((c) => c.capSol ?? 0), feesSol: sum((c) => c.feesSol),
      creatorEarnedSol: sum((c) => c.creatorEarnedSol), creatorClaimedSol: sum((c) => c.creatorClaimedSol), creatorUnclaimedSol: sum((c) => c.creatorUnclaimedSol),
      platformEarnedSol: sum((c) => c.platformEarnedSol), platformClaimedSol: sum((c) => c.platformClaimedSol), platformUnclaimedSol: sum((c) => c.platformUnclaimedSol), protocolSol: sum((c) => c.protocolSol),
      burnedTokens: sum((c) => c.burnedTokens), supplyTokens: sum((c) => c.supplyTokens), fixedSupplyTokens: FIXED_SUPPLY * coins.length,
    },
  };
}

export async function GET() {
  const now = Date.now();
  const headers = { "Cache-Control": "public, s-maxage=2, stale-while-revalidate=10" };
  if (cache && now - cache.at < TTL_MS) return NextResponse.json(cache.data, { headers });
  try {
    inflight ??= compute().finally(() => { inflight = null; });
    const data = await inflight;
    cache = { at: Date.now(), data };
    return NextResponse.json(data, { headers });
  } catch (e) {
    // Serve the last good snapshot (marked stale) rather than a blank page.
    if (cache) return NextResponse.json({ ...cache.data, stale: true });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "RPC read failed" }, { status: 502 });
  }
}
