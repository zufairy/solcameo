import {
  PAPER_VIRTUAL_SOL,
  PAPER_VIRTUAL_TOKENS,
  quoteBuy,
  quoteSell,
} from "./economics";
export type LedgerTrade = {
  wallet: string;
  side: "buy" | "sell";
  amountIn: bigint;
  amountOut: bigint;
  createdAt: number;
};
export function deriveTerminal(trades: LedgerTrade[], now: number) {
  let pool = {
    solReserve: PAPER_VIRTUAL_SOL,
    tokenReserve: PAPER_VIRTUAL_TOKENS,
  };
  const points: Array<{
    time: number;
    price: number;
    volume: number;
    side: "buy" | "sell";
  }> = [];
  const positions = new Map<string, bigint>();
  const cash = new Map<string, bigint>();
  const bought = new Map<string, bigint>();
  let ath = (Number(PAPER_VIRTUAL_SOL) / Number(PAPER_VIRTUAL_TOKENS)) * 1e6;
  let buyVolume = 0n,
    sellVolume = 0n,
    buys = 0,
    sells = 0;
  const buyers = new Set<string>(),
    sellers = new Set<string>();
  for (const t of [...trades].sort((a, b) => a.createdAt - b.createdAt)) {
    const balance = positions.get(t.wallet) ?? 0n;
    positions.set(
      t.wallet,
      balance + (t.side === "buy" ? t.amountOut : -t.amountIn),
    );
    cash.set(
      t.wallet,
      (cash.get(t.wallet) ?? 0n) +
        (t.side === "buy" ? -t.amountIn : t.amountOut),
    );
    if (t.side === "buy")
      bought.set(t.wallet, (bought.get(t.wallet) ?? 0n) + t.amountIn);
    const q =
      t.side === "buy"
        ? quoteBuy(pool, t.amountIn)
        : quoteSell(pool, t.amountIn);
    pool = q.next;
    const price = (Number(pool.solReserve) / Number(pool.tokenReserve)) * 1e6;
    ath = Math.max(ath, price);
    points.push({
      time: t.createdAt,
      price,
      volume: Number(t.side === "buy" ? t.amountIn : t.amountOut) / 1e9,
      side: t.side,
    });
    if (t.createdAt < now - 86400000) continue;
    if (t.side === "buy") {
      buyVolume += t.amountIn;
      buys++;
      buyers.add(t.wallet);
    } else {
      sellVolume += t.amountOut;
      sells++;
      sellers.add(t.wallet);
    }
  }
  const current = (Number(pool.solReserve) / Number(pool.tokenReserve)) * 1e6;
  const changes = [3600000, 21600000, 86400000].map((window) => {
    const before =
      [...points].reverse().find((p) => p.time <= now - window)?.price ??
      (Number(PAPER_VIRTUAL_SOL) / Number(PAPER_VIRTUAL_TOKENS)) * 1e6;
    return ((current - before) / before) * 100;
  });
  return {
    points,
    ath,
    changes,
    buyVolume: buyVolume.toString(),
    sellVolume: sellVolume.toString(),
    buys,
    sells,
    buyers: buyers.size,
    sellers: sellers.size,
    holders: [...positions]
      .filter(([, units]) => units > 0n)
      .sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0))
      .map(([wallet, units]) => ({
        wallet,
        units: units.toString(),
        supplyPct: (Number(units) / Number(PAPER_VIRTUAL_TOKENS)) * 100,
        boughtLamports: (bought.get(wallet) ?? 0n).toString(),
        profitLamports: (
          (units * BigInt(Math.floor(current))) / 1000000n +
          (cash.get(wallet) ?? 0n)
        ).toString(),
      })),
  };
}
export function candlesFromPoints(
  points: Array<{ time: number; price: number }>,
  minutes: number,
  multiplier = 1,
) {
  const buckets = new Map<
    number,
    { time: number; open: number; high: number; low: number; close: number }
  >();
  for (const point of points) {
    const time = Math.floor(point.time / (minutes * 60000)) * minutes * 60;
    const value = point.price * multiplier;
    const prior = buckets.get(time);
    if (prior) {
      prior.high = Math.max(prior.high, value);
      prior.low = Math.min(prior.low, value);
      prior.close = value;
    } else
      buckets.set(time, {
        time,
        open: value,
        high: value,
        low: value,
        close: value,
      });
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
export function parseUnits(input: string, decimals: number): bigint | null {
  if (!new RegExp(`^\\d+(?:\\.\\d{0,${decimals}})?$`).test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  const value =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"));
  return value > 0n ? value : null;
}
