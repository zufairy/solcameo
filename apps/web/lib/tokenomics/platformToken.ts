/**
 * SOLCAMEO platform token: the single source of truth for supply, tiers and the revenue flywheel.
 * Pure data and arithmetic, shared by the server (billing discount, epoch planning), Convex and the /tokenomics page.
 * Amounts are whole tokens unless a name says otherwise; money splits use integer micro-USDC (bigint) so nothing drifts.
 */

export const TOKEN_SYMBOL = "SOLCAMEO";
export const TOTAL_SUPPLY = 1_000_000_000;

export const ALLOCATION = [
  { key: "public", label: "Fair launch (bonding curve)", pct: 60, note: "Sold to the public on the curve. No presale, no private round.", color: "#d7ff00" },
  { key: "team", label: "Team", pct: 15, note: "12-month cliff, then linear vesting over 36 months.", color: "#7dd3fc" },
  { key: "treasury", label: "Treasury", pct: 12, note: "Held in a multisig for grants, listings and partnerships.", color: "#c4b5fd" },
  { key: "rewards", label: "Holder rewards", pct: 10, note: "Paid to tier holders over 3 years, capped per year.", color: "#fda4af" },
  { key: "liquidity", label: "Liquidity", pct: 3, note: "Seeded into the pool and permanently locked.", color: "#fcd34d" },
] as const;

export type TierKey = "none" | "bronze" | "silver" | "gold" | "diamond";
export interface Tier { key: TierKey; label: string; minTokens: number; discountPct: number; rewardWeight: number }

/** Holding tiers. Balance is read from the owner's wallet on-chain; there is nothing to stake. */
export const TIERS: readonly Tier[] = [
  { key: "none", label: "No tier", minTokens: 0, discountPct: 0, rewardWeight: 0 },
  { key: "bronze", label: "Bronze", minTokens: 250_000, discountPct: 3, rewardWeight: 1 },
  { key: "silver", label: "Silver", minTokens: 1_000_000, discountPct: 6, rewardWeight: 2.5 },
  { key: "gold", label: "Gold", minTokens: 5_000_000, discountPct: 10, rewardWeight: 6 },
  { key: "diamond", label: "Diamond", minTokens: 20_000_000, discountPct: 15, rewardWeight: 12 },
];
export const MAX_DISCOUNT_PCT = Math.max(...TIERS.map((t) => t.discountPct));

export function tierFor(balanceTokens: number): Tier {
  let hit = TIERS[0];
  if (Number.isFinite(balanceTokens)) for (const t of TIERS) if (balanceTokens >= t.minTokens) hit = t;
  return hit;
}

/** Price after the holder discount, rounded to the 6 decimals USDC settles in. */
export function discountedCost(cost: number, discountPct: number): number {
  const pct = Math.min(MAX_DISCOUNT_PCT, Math.max(0, Number.isFinite(discountPct) ? discountPct : 0));
  return +(cost * (1 - pct / 100)).toFixed(6);
}

/** Where each unit of weekly platform revenue goes, in basis points of 10,000. */
export const REVENUE_SPLIT = { buybackBps: 3000, opsBps: 4000, treasuryBps: 3000 } as const;
/** Of the tokens the buyback acquires: burned versus paid to holders. */
export const BUYBACK_SPLIT = { burnBps: 5000, rewardsBps: 5000 } as const;
/** Share of settled generation spend that is Solcameo margin (the 10% fee on top of provider cost: 10/110). */
export const GENERATION_MARGIN_BPS = 909;

export interface RevenuePlan { revenue: bigint; buyback: bigint; ops: bigint; treasury: bigint }

/** Split revenue (micro-USDC). The treasury share absorbs rounding so the parts always sum to the whole. */
export function splitRevenue(revenueMicro: bigint): RevenuePlan {
  if (revenueMicro < 0n) throw new Error("negative_revenue");
  const buyback = (revenueMicro * BigInt(REVENUE_SPLIT.buybackBps)) / 10_000n;
  const ops = (revenueMicro * BigInt(REVENUE_SPLIT.opsBps)) / 10_000n;
  return { revenue: revenueMicro, buyback, ops, treasury: revenueMicro - buyback - ops };
}

/** Margin earned on settled generation spend (micro-USDC). */
export function marginOf(settledMicro: bigint): bigint {
  return (settledMicro * BigInt(GENERATION_MARGIN_BPS)) / 10_000n;
}

export function splitBuyback(tokens: bigint): { burn: bigint; rewards: bigint } {
  const burn = (tokens * BigInt(BUYBACK_SPLIT.burnBps)) / 10_000n;
  return { burn, rewards: tokens - burn };
}

export interface HolderShare { wallet: string; balance: number; tier: TierKey; weight: number; amount: bigint }

/** Pro-rata reward by tier weight. The remainder goes to the largest weight so the pool pays out exactly. */
export function distributeRewards(pool: bigint, holders: ReadonlyArray<{ wallet: string; balance: number }>): HolderShare[] {
  const rows = holders.map((h) => { const t = tierFor(h.balance); return { wallet: h.wallet, balance: h.balance, tier: t.key, weight: t.rewardWeight }; }).filter((r) => r.weight > 0);
  const total = rows.reduce((s, r) => s + r.weight, 0);
  if (!rows.length || total <= 0 || pool <= 0n) return [];
  const SCALE = 1_000_000n;
  const out: HolderShare[] = rows.map((r) => ({ ...r, amount: (pool * BigInt(Math.round(r.weight * Number(SCALE)))) / (BigInt(Math.round(total * Number(SCALE)))) }));
  const paid = out.reduce((s, r) => s + r.amount, 0n);
  let top = 0;
  out.forEach((r, i) => { if (r.weight > out[top].weight) top = i; });
  out[top].amount += pool - paid;
  return out;
}

/** Start of the reward epoch (Monday 00:00 UTC) containing `ms`. */
export function epochStart(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
export const EPOCH_MS = 7 * 86_400_000;
