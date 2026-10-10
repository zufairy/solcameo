import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { fetchTokenStats, num, solamiDataKey, type TokenWindowStats } from "@/lib/solami/blur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOWS = [300, 3600, 86400];
const MAX_COINS = 24;
let cache: { at: number; body: unknown } | null = null;

const shape = (w: TokenWindowStats | undefined) => w && {
  trades: w.trades, buys: w.buys, sells: w.sells, traders: w.traders,
  volumeUsd: num(w.volume_usd), priceUsd: num(w.close), changePct: num(w.price_change_pct),
  buyPressure: w.trades ? w.buys / w.trades : 0.5,
};

/** Per-coin 5m / 1h / 24h stats for every live Solcameo coin, straight from Blur. Cached 15s so many viewers cost one fan-out. */
export async function GET() {
  if (!solamiDataKey()) return NextResponse.json({ configured: false, coins: [] });
  if (cache && Date.now() - cache.at < 15_000) return NextResponse.json(cache.body);
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) return NextResponse.json({ configured: true, coins: [] });
  const list = (await new ConvexHttpClient(url).query(api.solstarMarket.pulseCoins, {})).slice(0, MAX_COINS);
  const coins = await Promise.all(list.map(async (c) => {
    try {
      const s = await fetchTokenStats(c.mint, WINDOWS);
      return { ...c, m5: shape(s.windows["300"]), h1: shape(s.windows["3600"]), h24: shape(s.windows["86400"]), pool: s.primary_pool };
    } catch { return { ...c, m5: null, h1: null, h24: null, pool: null }; }
  }));
  const body = { configured: true, checkedAt: Date.now(), coins };
  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}
