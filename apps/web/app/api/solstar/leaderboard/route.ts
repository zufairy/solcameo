import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { getUnClaimLpFee } from "@meteora-ag/cp-amm-sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { convexClient } from "@/lib/server/solstarRoute";
import { getRpcCandidates } from "@/lib/solana/network";
import { migratedPool } from "@/lib/server/dammLifecycle";
import { readMarketSwap, readPoolHistory } from "@/lib/server/marketLeaderboard";
import { LEADERBOARD_PERIODS, periodStart, rankTraders, type LeaderboardPeriod, type LeaderboardResponse, type EarnerRank, type RpcTrade, type ViewRank } from "@/lib/solstar/leaderboard";
export const runtime = "nodejs";
export const maxDuration = 60;
async function mapBounded<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}
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
  const lists = await Promise.all(clients.map(client => client.query(api.solstarMarket.listMarket, { sort: "new", network, liveOnly: true })));
  const rows = [...new Map(lists.flatMap((list, source) => list.map(row => ({ ...row, marketUrl: source ? `https://solcameo.com/market/${row.characterId}` : `/market/${row.characterId}` }))).map(row => [row.dbcPool, row])).values()];
  const since = periodStart(period), prices = new Map<string, number>(), trades: RpcTrade[] = [], earners: EarnerRank[] = [], errors: string[] = [];
  let complete = true;
  const unknownBalances = new Set<string>();
  const coinMeta = new Map<string, { ticker: string; name: string; imageUrl: string; marketUrl: string }>();
  // Bound concurrent pools to keep Helius reads fast without unbounded bursts.
  await mapBounded(rows, 3, async row => {
    let succeeded = false;
    for (const endpoint of [...new Set([...getRpcCandidates(network === "mainnet" ? "mainnet-beta" : "devnet"), process.env.SOLCAMEO_DBC_RPC_URL].filter((u): u is string => !!u))]) {
      try {
        const connection = new Connection(endpoint, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }) });
        const dbc = new DynamicBondingCurveClient(connection, "confirmed"), address = new PublicKey(row.dbcPool!);
        const pool = await dbc.state.getPool(address);
        if (!pool) throw new Error("Pool unavailable");
        const [config, history] = await Promise.all([dbc.state.getPoolConfig(pool.poolState.config), readPoolHistory(connection, address, network)]);
        if (!config || !config.quoteMint.equals(NATIVE_MINT)) throw new Error("Unsupported quote mint");
        const mint = pool.poolState.baseMint.toBase58();
        if (realizedOnly) {
          coinMeta.set(mint, { ticker: row.ticker, name: row.name, imageUrl: row.imageUrl, marketUrl: row.marketUrl });
          const poolTrades = history.transactions.flatMap(({ signature, tx }) => {
            const parsed = readMarketSwap(tx, signature, mint, address.toBase58());
            return parsed?.trade ? [parsed.trade] : [];
          });
          if (pool.poolState.isMigrated) {
            const migrated = await migratedPool(connection, address);
            if (!migrated) throw new Error("Graduated pool unavailable");
            const migratedHistory = await readPoolHistory(connection, migrated.address, network);
            poolTrades.push(...migratedHistory.transactions.flatMap(({ signature, tx }) => {
              const parsed = readMarketSwap(tx, signature, mint, migrated.address.toBase58(), migrated.state.tokenBMint.equals(NATIVE_MINT));
              return parsed?.trade ? [parsed.trade] : [];
            }));
            history.complete &&= migratedHistory.complete;
          }
          if (!history.complete) { complete = false; errors.push(`${row.name}: trade history is incomplete`); }
          // Current holdings must reconcile with swaps before their basis is trusted.
          const balances = new Map<string, number>();
          for (const trade of poolTrades) balances.set(trade.wallet, (balances.get(trade.wallet) ?? 0) + (trade.side === "buy" ? trade.units : -trade.units));
          for (const [wallet, expected] of balances) {
            try {
              const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(wallet), { mint: pool.poolState.baseMint }, "confirmed");
              const actual = accounts.value.reduce((sum, account) => sum + Number(account.account.data.parsed.info.tokenAmount.amount), 0);
              if (Math.abs(actual - expected) > 1) unknownBalances.add(wallet);
            } catch { unknownBalances.add(wallet); }
          }
          trades.push(...poolTrades);
          succeeded = true;
          break;
        }
        let price = (Number(pool.poolState.sqrtPrice.toString()) / 2 ** 64) ** 2 / 1e9;
        // Same integer rounding as the SDK, using the state already fetched.
        const share = BigInt(config.creatorTradingFeePercentage);
        const creatorTotal = (value: { toString(): string }) => Number(BigInt(value.toString()) * share / 100n);
        const feeBreakdown = { creator: {
          totalQuoteFee: creatorTotal(pool.poolState.metrics.totalTradingQuoteFee),
          totalBaseFee: creatorTotal(pool.poolState.metrics.totalTradingBaseFee),
          unclaimedQuoteFee: pool.poolState.creatorQuoteFee,
          unclaimedBaseFee: pool.poolState.creatorBaseFee,
        } };
        const decoded = history.transactions.map(({ signature, tx }) => ({ time: tx.blockTime! * 1000, swap: readMarketSwap(tx, signature, mint, address.toBase58()) }));
        const poolTrades = decoded.flatMap(d => d.swap?.trade ? [d.swap.trade] : []);
        let feesSol = Number(feeBreakdown.creator.totalQuoteFee.toString()) / 1e9 + Number(feeBreakdown.creator.totalBaseFee.toString()) * price;
        let claimableSol = Number(feeBreakdown.creator.unclaimedQuoteFee.toString()) / 1e9 + Number(feeBreakdown.creator.unclaimedBaseFee.toString()) * price;
        let feesInPeriod = decoded.filter(d => d.time >= since).reduce((total, d) => {
          const buy = d.swap?.trade?.side === "buy";
          const baseFee = config.collectFeeMode !== 0 && buy;
          return total + (d.swap?.fee ?? 0) * config.creatorTradingFeePercentage / 100 * (baseFee ? price : 1e-9);
        }, 0);
        let periodFeesAvailable = history.complete;
        if (pool.poolState.isMigrated) {
          const migrated = await migratedPool(connection, address);
          if (!migrated) throw new Error("Graduated pool unavailable");
          const quoteIsB = migrated.state.tokenBMint.equals(NATIVE_MINT);
          const sqrt = Number(migrated.state.sqrtPrice.toString()) / 2 ** 64;
          price = (quoteIsB ? sqrt * sqrt : 1 / (sqrt * sqrt)) / 1e9;
          const migratedHistory = await readPoolHistory(connection, migrated.address, network);
          poolTrades.push(...migratedHistory.transactions.flatMap(({ signature, tx }) => {
            const parsed = readMarketSwap(tx, signature, mint, migrated.address.toBase58(), quoteIsB);
            return parsed?.trade ? [parsed.trade] : [];
          }));
          history.complete &&= migratedHistory.complete;
          const positions = (await migrated.cp.getPositionsByUserAndTokenMint(pool.poolState.creator, pool.poolState.baseMint)).filter(p => p.pool.equals(migrated.address));
          for (const p of positions) {
            const pending = getUnClaimLpFee(migrated.state, p.positionState);
            const pendingQuote = quoteIsB ? pending.feeTokenB : pending.feeTokenA;
            const pendingBase = quoteIsB ? pending.feeTokenA : pending.feeTokenB;
            const claimedQuote = quoteIsB ? p.positionState.metrics.totalClaimedBFee : p.positionState.metrics.totalClaimedAFee;
            const claimedBase = quoteIsB ? p.positionState.metrics.totalClaimedAFee : p.positionState.metrics.totalClaimedBFee;
            claimableSol += Number(pendingQuote.toString()) / 1e9 + Number(pendingBase.toString()) * price;
            feesSol += (Number(pendingQuote.toString()) + Number(claimedQuote.toString())) / 1e9 + (Number(pendingBase.toString()) + Number(claimedBase.toString())) * price;
          }
          // LP accrual counters have no timestamps. Do not relabel lifetime LP fees as period earnings.
          periodFeesAvailable = false;
        }
        if (!history.complete) complete = false;
        if (period !== "all" && !periodFeesAvailable) { feesInPeriod = NaN; errors.push(`${row.name}: period creator-fee history unavailable`); }
        // Transfers outside a swap change holdings without providing cost basis.
        // Verify live balances so transferred tokens cannot inflate reported P&L.
        const balances = new Map<string, number>();
        for (const t of poolTrades) balances.set(t.wallet, (balances.get(t.wallet) ?? 0) + (t.side === "buy" ? t.units : -t.units));
        await mapBounded([...balances], 4, async ([wallet, expected]) => {
          try {
            const actual = await connection.getParsedTokenAccountsByOwner(new PublicKey(wallet), { mint: pool.poolState.baseMint }, "confirmed");
            const units = actual.value.reduce((sum, account) => sum + Number(account.account.data.parsed.info.tokenAmount.amount), 0);
            if (Math.abs(units - expected) > 1) unknownBalances.add(wallet);
          } catch { unknownBalances.add(wallet); }
        });
        prices.set(mint, price);
        trades.push(...poolTrades);
        earners.push({ wallet: pool.poolState.creator.toBase58(), name: row.name, ticker: row.ticker, imageUrl: row.imageUrl, characterId: row.characterId, marketUrl: row.marketUrl, feesSol: period === "all" ? feesSol : Number.isFinite(feesInPeriod) ? feesInPeriod : null, claimableSol });
        succeeded = true; break;
      } catch { /* Try another endpoint on the same cluster. */ }
    }
    if (!succeeded) { complete = false; errors.push(`${row.name}: RPC temporarily unavailable`); }
  });
  const traders = rankTraders(trades, prices, since, complete, realizedOnly).map(t => unknownBalances.has(t.wallet) ? { ...t, pnlSol: null, complete: false } : t).sort((a, b) => (b.pnlSol ?? -Infinity) - (a.pnlSol ?? -Infinity));
  for (const t of traders) t.coins = t.coins?.map(coin => ({ ...coin, ...coinMeta.get(coin.mint) }));
  if (unknownBalances.size) errors.push("Some wallet balances changed outside tracked swaps or are unavailable; their cost basis cannot be verified");
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
  const network = "mainnet" as const; // the home leaderboard ranks live mainnet tokens only
  const viewsOnly = req.nextUrl.searchParams.get("metric") === "views";
  const realizedOnly = req.nextUrl.searchParams.get("metric") === "realized";
  const key = `${network}:${period}:${viewsOnly}:${realizedOnly}`;
  try {
    let entry = cache.get(key);
    if (!entry || entry.expires <= Date.now() || req.nextUrl.searchParams.get("refresh") === "1") {
      entry = { expires: Infinity, value: load(period as LeaderboardPeriod, network, viewsOnly, realizedOnly).then(result => { const current = cache.get(key); if (current) current.expires = Date.now() + 30000; return result; }) };
      cache.set(key, entry);
    }
    const result = await entry.value;
    if (!result.complete || result.errors.length) cache.delete(key);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch { cache.delete(key); return NextResponse.json({ error: "Leaderboard RPC temporarily unavailable" }, { status: 503 }); }
}
