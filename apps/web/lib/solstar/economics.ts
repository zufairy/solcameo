export const BPS_DENOM = 10_000n;
export const TOTAL_FEE_BPS = 125n;
/** Largest amount any single operation may carry (stays inside Convex int64). */
export const MAX_AMOUNT = 1n << 62n;
/** Every paper wallet starts with 10 simulated SOL. Never spendable on real jobs. */
export const PAPER_START_LAMPORTS = 10_000_000_000n;
export const PAPER_VIRTUAL_SOL = 30_000_000_000n;
/** 1,000,000,000 tokens at 6 decimals. */
export const PAPER_VIRTUAL_TOKENS = 1_000_000_000_000_000n;

export interface Pool { solReserve: bigint; tokenReserve: bigint }
export interface FeeSplit { total: bigint; protocol: bigint; creator: bigint; ops: bigint; content: bigint }
export interface Quote {
  side: "buy" | "sell";
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint;
  feeSplit: FeeSplit;
  next: Pool;
}

function assertAmount(n: bigint, label: string): void {
  if (n <= 0n) throw new Error(`${label} must be positive`);
  if (n > MAX_AMOUNT) throw new Error(`${label} too large`);
}

export function feeOf(volume: bigint): bigint {
  if (volume < 0n) throw new Error("volume must not be negative");
  return (volume * TOTAL_FEE_BPS) / BPS_DENOM;
}

/** Protocol 20% of fee; rest 30% creator / 70% partner; partner 2/7 content, 5/7 ops (remainder to ops). */
export function splitFee(total: bigint): FeeSplit {
  if (total < 0n) throw new Error("fee must not be negative");
  const protocol = (total * 20n) / 100n;
  const rest = total - protocol;
  const creator = (rest * 30n) / 100n;
  const partner = rest - creator;
  const content = (partner * 2n) / 7n;
  const ops = partner - content;
  return { total, protocol, creator, ops, content };
}

export function quoteBuy(pool: Pool, lamportsIn: bigint): Quote {
  assertAmount(lamportsIn, "amount");
  const fee = feeOf(lamportsIn);
  if (fee === 0n) throw new Error("amount too small: zero output (dust)");
  const net = lamportsIn - fee;
  const out = (pool.tokenReserve * net) / (pool.solReserve + net);
  if (out <= 0n) throw new Error("amount too small: zero output (dust)");
  return {
    side: "buy", amountIn: lamportsIn, amountOut: out, fee, feeSplit: splitFee(fee),
    next: { solReserve: pool.solReserve + net, tokenReserve: pool.tokenReserve - out },
  };
}

export function quoteSell(pool: Pool, tokensIn: bigint): Quote {
  assertAmount(tokensIn, "amount");
  const gross = (pool.solReserve * tokensIn) / (pool.tokenReserve + tokensIn);
  if (gross <= 0n) throw new Error("amount too small: zero output (dust)");
  const fee = feeOf(gross);
  const net = gross - fee;
  return {
    side: "sell", amountIn: tokensIn, amountOut: net, fee, feeSplit: splitFee(fee),
    next: { solReserve: pool.solReserve - gross, tokenReserve: pool.tokenReserve + tokensIn },
  };
}
