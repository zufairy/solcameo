import { z } from "zod";
import { PublicKey } from "@solana/web3.js";

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/).refine(s => Number.isFinite(Number(s)));
const count = z.number().int().nonnegative();
const windowSchema = z.object({ trades: count, buys: count, sells: count, traders: count,
  volume_usd: decimal, fees_usd: decimal, open: decimal, close: decimal, high: decimal, low: decimal, price_change_pct: decimal });
const statsSchema = z.object({ mint: z.string(), primary_pool: z.string().nullable(), windows: z.record(z.string(), windowSchema) });
const tradesSchema = z.array(z.object({ signature: z.string(), slot: count, block_time: count,
  dex: z.string(), pool: z.string(), side: z.enum(["buy", "sell"]), trader: z.string(), price_usd: decimal, volume_usd: decimal })).max(50);

async function solamiGet(path: string, mint: string, extra: Record<string, string>, fetcher: typeof fetch) {
  const key = process.env.SOLAMI_API_KEY?.trim();
  if (!key) throw new Error("SOLAMI_API_KEY with DataApi permission is required");
  const url = new URL(path, "https://api.solami.dev");
  url.search = new URLSearchParams({ chain: "solana", address: mint, ...extra }).toString();
  const res = await fetcher(url, { headers: { "x-api-key": key }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Solami data unavailable (${res.status})`);
  const raw = await res.text();
  if (raw.length > 500_000) throw new Error("Solami response too large");
  return JSON.parse(raw) as unknown;
}
/** A bounded live mainnet snapshot, not invented prices or an unlabelled 24h extrapolation. */
export async function buildSolamiReport(mint: string, fetcher: typeof fetch = fetch) {
  mint = new PublicKey(mint).toBase58();
  const [statsRaw, tradesRaw] = await Promise.all([
    solamiGet("/data/token/stats", mint, { windows: "300,3600,86400" }, fetcher),
    solamiGet("/data/token/trades", mint, { limit: "50" }, fetcher),
  ]);
  const stats = statsSchema.parse(statsRaw);
  const trades = tradesSchema.parse(tradesRaw);
  if (stats.mint !== mint || ["300", "3600", "86400"].some(w => !stats.windows[w])) throw new Error("Solami returned mismatched or incomplete windows");
  const observedAt = Date.now();
  const latest = trades[0]?.block_time;
  if (!latest || latest * 1000 < observedAt - 300_000 || latest * 1000 > observedAt + 60_000) throw new Error("No recent indexed trades; refusing to sell stale intelligence");
  return {
    version: 1, provider: "solami", chain: "solana-mainnet", mint, observedAt,
    latestTradeAt: latest * 1000, primaryPool: stats.primary_pool,
    windows: Object.fromEntries(Object.entries(stats.windows).map(([seconds, w]) => [seconds, {
      ...w, buyShare: w.buys + w.sells ? w.buys / (w.buys + w.sells) : null,
    }])),
    recentTrades: trades,
    evidence: trades.slice(0, 10).map(t => ({ signature: t.signature, slot: t.slot, url: `https://solscan.io/tx/${t.signature}` })),
    limitations: ["Indexed snapshot; not a continuous stream.", "Recent trades are a sample of at most 50, not total window volume.", "Buy share measures trade count, not net capital flow.", "Market observations are not an instruction to trade."],
  };
}
export type SolamiReport = Awaited<ReturnType<typeof buildSolamiReport>>;
