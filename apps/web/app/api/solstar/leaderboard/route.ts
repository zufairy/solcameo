import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexClient } from "@/lib/server/solstarRoute";
import { LIVE_NETWORK } from "@/lib/solstar/liveNetwork";
import { LEADERBOARD_PERIODS, periodStart, type LeaderboardPeriod, type LeaderboardResponse, type ViewRank } from "@/lib/solstar/leaderboard";
import { leaderboardFromChain } from "@/lib/solstar/leaderboardFromChain";
import { syncAllMarkets } from "@/lib/server/marketChainSync";
export const runtime = "nodejs";
export const maxDuration = 60;
const STALE_SYNC_MS = 90_000, KICK_GAP_MS = 60_000;
let lastKick = 0;
const cache = new Map<string, { expires: number; value: Promise<LeaderboardResponse> }>();
async function load(period: LeaderboardPeriod, network: "mainnet" | "devnet", viewsOnly = false, realizedOnly = false): Promise<LeaderboardResponse> {
  const clients = [convexClient()];
  // Optional public market mirror lets localhost include production purchases
  // without changing its development database or any authenticated account data.
  const mirror = process.env.SOLCAMEO_LEADERBOARD_CONVEX_URL;
  if (mirror && mirror !== process.env.NEXT_PUBLIC_CONVEX_URL) clients.push(new ConvexHttpClient(mirror));
  if (viewsOnly) {
    const ranked = new Map<string, ViewRank>();
    const seen = new Set<string>();
    const totals = new Map<string, number>();
    const since = periodStart(period);
    for (const [source, client] of clients.entries()) {
      const [agents, feed] = await Promise.all([client.query(api.influencers.listSearchable, {}), client.query(api.clipJobs.globalVideoFeed, { limit: 120 })]);
      if (Array.isArray(feed)) continue;
      for (const v of feed.items) if (!seen.has(v.id) && v.createdAt >= since) { seen.add(v.id); totals.set(v.mint, (totals.get(v.mint) ?? 0) + Math.max(0, v.viewCount ?? 0)); }
      for (const a of agents) if (a.ticker) ranked.set(a.mintAddress, { mint: a.mintAddress, name: a.name, ticker: a.ticker, imageUrl: a.avatarUrl, marketUrl: source ? `https://solcameo.com/market/${a.mintAddress}` : `/market/${a.mintAddress}`, views: 0 });
    }
    const views = [...ranked.values()].map(a => ({ ...a, views: totals.get(a.mint) ?? 0 })).sort((a, b) => b.views - a.views);
    return { views, traders: [], earners: [], network, complete: true, errors: [], checkedAt: Date.now() };
  }
  // Everything comes from the market tables Convex already holds, so this never touches the chain.
  const targets = await clients[0].query(api.solstarMarket.tokenomicsTargets, { network });
  const coins = (await Promise.all(targets.map(t => clients[0].query(api.solstarChain.leaderboardCoin, { characterId: t.characterId as Id<"ssCharacters"> })))).filter((c): c is NonNullable<typeof c> => !!c);
  const { traders, earners, complete, errors } = leaderboardFromChain(coins, { period, realizedOnly, marketUrl: (id) => `/market/${id}` });
  // Keep the tables fresh in the background when they have gone quiet; the answer above never waits on it.
  if (coins.some((c) => !c.state || Date.now() - c.state.syncedAt > STALE_SYNC_MS) && Date.now() - lastKick > KICK_GAP_MS) { lastKick = Date.now(); void syncAllMarkets(network).catch(() => undefined); }
  const wallets = [...new Set([...traders.map(t => t.wallet), ...earners.map(e => e.wallet)])];
  for (const client of clients) {
    for (let offset = 0; offset < wallets.length; offset += 100) {
      try {
        const profiles = await client.query(api.users.leaderboardProfiles, { wallets: wallets.slice(offset, offset + 100) });
        for (const profile of profiles) {
          for (const t of traders) if (t.wallet === profile.wallet) { if (profile.name) t.profileName = profile.name; if (profile.image) t.profileImage = profile.image; }
          for (const e of earners) if (e.wallet === profile.wallet) { if (profile.name) e.creatorName = profile.name; if (profile.image) e.creatorImage = profile.image; }
        }
      } catch { /* An unnamed wallet still links to its verified on-chain account. */ }
    }
  }
  return { traders, earners: earners.sort((a, b) => (b.feesSol ?? -Infinity) - (a.feesSol ?? -Infinity)), network, complete, errors, checkedAt: Date.now() };
}
export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period") ?? "all";
  if (!Object.hasOwn(LEADERBOARD_PERIODS, period)) return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  const network = LIVE_NETWORK; // mainnet unless the deployment is explicitly pointed at devnet
  const viewsOnly = req.nextUrl.searchParams.get("metric") === "views";
  const realizedOnly = req.nextUrl.searchParams.get("metric") === "realized";
  const key = `${network}:${period}:${viewsOnly}:${realizedOnly}`;
  try {
    let entry = cache.get(key);
    if (!entry || entry.expires <= Date.now() || req.nextUrl.searchParams.get("refresh") === "1") {
      entry = { expires: Infinity, value: load(period as LeaderboardPeriod, network, viewsOnly, realizedOnly).then(result => { const current = cache.get(key); if (current) current.expires = Date.now() + 5000; return result; }) };
      cache.set(key, entry);
    }
    const result = await entry.value;
    // Partial results (one coin unreadable) are kept briefly so polling does not re-run every RPC read each time;
    // a result that is wholly incomplete is dropped so the next request retries.
    if (!result.complete) cache.delete(key);
    else if (result.errors.length) { const current = cache.get(key); if (current) current.expires = Math.min(current.expires, Date.now() + 15000); }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch { cache.delete(key); return NextResponse.json({ error: "Leaderboard RPC temporarily unavailable" }, { status: 503 }); }
}
