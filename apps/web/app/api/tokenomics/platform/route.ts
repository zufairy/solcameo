import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getNetwork } from "@/lib/solana/network";
import { getUsdcBalanceStrict, getSolBalanceStrict } from "@/lib/trader/usdcTransfer";
import { TOTAL_SUPPLY, tierFor, type TierKey } from "@/lib/tokenomics/platformToken";
import { mintSupply, platformTokenMint, platformWallets, tokenBalanceOf, topHolders, type TopHolder } from "@/lib/server/platformTokenChain";

export const runtime = "nodejs";
export const maxDuration = 20;

export interface PlatformTokenState {
  ok: true;
  network: string;
  launched: boolean;
  mint?: string;
  supply?: number;
  burned?: number;
  burnedPct?: number;
  locked?: { team: number | null; treasury: number | null; rewards: number | null };
  circulating?: number;
  holders?: Array<TopHolder & { tier: TierKey }>;
  revenue: { usdc: number | null; sol: number | null; wallet: string | null };
  epochs: Array<{ id: string; epochStart: number; epochEnd: number; settledMicro: number; revenueMicro: number; buybackMicro: number; opsMicro: number; treasuryMicro: number; truncated: boolean; status: string; burnTokens?: string; burnSig?: string }>;
  checkedAt: number;
}

const TTL_MS = 5000;
let cache: { at: number; data: PlatformTokenState } | null = null;
let inflight: Promise<PlatformTokenState> | null = null;

async function compute(): Promise<PlatformTokenState> {
  const wallets = platformWallets();
  const mint = platformTokenMint();
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const [usdc, sol, epochs] = await Promise.all([
    wallets.revenue ? getUsdcBalanceStrict(wallets.revenue).catch(() => null) : Promise.resolve(null),
    wallets.revenue ? getSolBalanceStrict(wallets.revenue).catch(() => null) : Promise.resolve(null),
    url ? new ConvexHttpClient(url).query(api.platformToken.listEpochs, { limit: 8 }).catch(() => []) : Promise.resolve([]),
  ]);
  const base: PlatformTokenState = { ok: true, network: getNetwork(), launched: false, revenue: { usdc, sol, wallet: wallets.revenue }, epochs: epochs as PlatformTokenState["epochs"], checkedAt: Date.now() };
  if (!mint) return base;
  const supplyInfo = await mintSupply(mint);
  if (!supplyInfo) throw new Error("Could not read the SOLCAMEO supply");
  const { supply } = supplyInfo;
  const [team, treasury, rewards, holders] = await Promise.all([
    wallets.team ? tokenBalanceOf(wallets.team, mint) : Promise.resolve(null),
    wallets.treasury ? tokenBalanceOf(wallets.treasury, mint) : Promise.resolve(null),
    wallets.rewards ? tokenBalanceOf(wallets.rewards, mint) : Promise.resolve(null),
    topHolders(mint, supply),
  ]);
  const burned = Math.max(0, TOTAL_SUPPLY - supply);
  const locked = (team ?? 0) + (treasury ?? 0) + (rewards ?? 0);
  return {
    ...base, launched: true, mint: mint.toBase58(), supply, burned, burnedPct: (burned / TOTAL_SUPPLY) * 100,
    locked: { team, treasury, rewards }, circulating: Math.max(0, supply - locked),
    holders: holders.map((h) => ({ ...h, tier: tierFor(h.kind === "wallet" && !h.label ? h.balance : 0).key })),
  };
}

/** Live SOLCAMEO state straight from Solana RPC (supply, burns, holders, vesting, revenue), shared across callers for 5s. */
export async function GET() {
  const headers = { "Cache-Control": "public, s-maxage=3, stale-while-revalidate=10" };
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data, { headers });
  try {
    inflight ??= compute().finally(() => { inflight = null; });
    const data = await inflight;
    cache = { at: Date.now(), data };
    return NextResponse.json(data, { headers });
  } catch (e) {
    if (cache) return NextResponse.json({ ...cache.data, stale: true });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "RPC read failed" }, { status: 502 });
  }
}

