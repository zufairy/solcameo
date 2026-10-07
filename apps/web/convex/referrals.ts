import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

/**
 * Referrals. A referrer earns a share of Solcameo's margin on every payment their referred wallets settle, in USDC, and only
 * while they hold SOLCAMEO. The server reads the holding on-chain and passes the resulting tier in; these functions never trust a
 * browser. Attribution is one level deep, permanent once bound, and lasts a year.
 */
const YEAR_MS = 365 * 86_400_000;
const STATS_KEY = "all";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function gate(secret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
}
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

async function stats(ctx: MutationCtx) {
  const row = await ctx.db.query("referralStats").withIndex("by_key", (q) => q.eq("key", STATS_KEY)).unique();
  if (row) return row;
  const id = await ctx.db.insert("referralStats", { key: STATS_KEY, accruedUsdc: 0, missedUsdc: 0, events: 0, referrers: 0, referred: 0 });
  return (await ctx.db.get(id))!;
}

/** The wallet's referral code, created on first use. */
export const ensureCode = mutation({
  args: { wallet: v.string(), authSecret: v.string() },
  handler: async (ctx, { wallet, authSecret }) => {
    gate(authSecret);
    const existing = await ctx.db.query("referralCodes").withIndex("by_wallet", (q) => q.eq("wallet", wallet)).unique();
    if (existing) return existing.code;
    for (let attempt = 0; attempt < 8; attempt++) {
      let code = "";
      for (let i = 0; i < 8; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (await ctx.db.query("referralCodes").withIndex("by_code", (q) => q.eq("code", code)).unique()) continue;
      await ctx.db.insert("referralCodes", { wallet, code, createdAt: Date.now() });
      const s = await stats(ctx);
      await ctx.db.patch(s._id, { referrers: s.referrers + 1 });
      return code;
    }
    throw new Error("code_unavailable");
  },
});

/** Bind a new wallet to the owner of `code`. Once only, never to yourself. */
export const bind = mutation({
  args: { refereeWallet: v.string(), code: v.string(), authSecret: v.string() },
  handler: async (ctx, { refereeWallet, code, authSecret }) => {
    gate(authSecret);
    const clean = code.trim().toUpperCase();
    const owner = await ctx.db.query("referralCodes").withIndex("by_code", (q) => q.eq("code", clean)).unique();
    if (!owner) return { ok: false as const, reason: "unknown_code" };
    if (owner.wallet === refereeWallet) return { ok: false as const, reason: "self_referral" };
    const bound = await ctx.db.query("referralBindings").withIndex("by_referee", (q) => q.eq("refereeWallet", refereeWallet)).unique();
    if (bound) return { ok: false as const, reason: "already_bound" };
    // Referral loops are refused: the referrer cannot already be this wallet's referee.
    const loop = await ctx.db.query("referralBindings").withIndex("by_referee", (q) => q.eq("refereeWallet", owner.wallet)).unique();
    if (loop && loop.referrerWallet === refereeWallet) return { ok: false as const, reason: "loop" };
    const now = Date.now();
    await ctx.db.insert("referralBindings", { refereeWallet, referrerWallet: owner.wallet, code: clean, boundAt: now, expiresAt: now + YEAR_MS });
    const s = await stats(ctx);
    await ctx.db.patch(s._id, { referred: s.referred + 1 });
    return { ok: true as const };
  },
});

/** Who referred this wallet, if the attribution is still running. */
export const bindingFor = query({
  args: { refereeWallet: v.string(), authSecret: v.string() },
  handler: async (ctx, { refereeWallet, authSecret }) => {
    gate(authSecret);
    const row = await ctx.db.query("referralBindings").withIndex("by_referee", (q) => q.eq("refereeWallet", refereeWallet)).unique();
    return row && row.expiresAt > Date.now() ? { referrerWallet: row.referrerWallet, boundAt: row.boundAt } : null;
  },
});

/**
 * Record the referrer's share of one settled payment. Idempotent per settlement. `tier` 0 means the referrer held too little
 * SOLCAMEO, so the share is kept as `missed`: it shows what they would have earned and is never paid.
 */
export const accrue = mutation({
  args: {
    settlementId: v.string(), referrerWallet: v.string(), refereeWallet: v.string(), mintAddress: v.string(),
    spendUsdc: v.number(), marginUsdc: v.number(), rate: v.number(), tier: v.number(), authSecret: v.string(),
  },
  handler: async (ctx, { authSecret, ...a }) => {
    gate(authSecret);
    if (!(a.spendUsdc > 0) || a.referrerWallet === a.refereeWallet) return { ok: false as const };
    if (await ctx.db.query("referralAccruals").withIndex("by_settlement", (q) => q.eq("settlementId", a.settlementId)).first()) return { ok: true as const, duplicate: true };
    const shareUsdc = +(a.marginUsdc * a.rate).toFixed(6);
    if (!(shareUsdc > 0)) return { ok: false as const };
    const status = a.tier > 0 ? ("pending" as const) : ("missed" as const);
    await ctx.db.insert("referralAccruals", { ...a, shareUsdc, status, at: Date.now() });
    const s = await stats(ctx);
    await ctx.db.patch(s._id, a.tier > 0 ? { accruedUsdc: +(s.accruedUsdc + shareUsdc).toFixed(6), events: s.events + 1 } : { missedUsdc: +(s.missedUsdc + shareUsdc).toFixed(6), events: s.events + 1 });
    return { ok: true as const, shareUsdc, status };
  },
});

/** A wallet's own referral numbers. */
export const mine = query({
  args: { wallet: v.string(), authSecret: v.string() },
  handler: async (ctx, { wallet, authSecret }) => {
    gate(authSecret);
    const code = (await ctx.db.query("referralCodes").withIndex("by_wallet", (q) => q.eq("wallet", wallet)).unique())?.code ?? null;
    const referees = await ctx.db.query("referralBindings").withIndex("by_referrer", (q) => q.eq("referrerWallet", wallet)).take(500);
    const accruals = await ctx.db.query("referralAccruals").withIndex("by_referrer", (q) => q.eq("referrerWallet", wallet)).order("desc").take(300);
    const sum = (status: string) => +accruals.filter((x) => x.status === status).reduce((n, x) => n + x.shareUsdc, 0).toFixed(6);
    const boundTo = await ctx.db.query("referralBindings").withIndex("by_referee", (q) => q.eq("refereeWallet", wallet)).unique();
    return {
      code, referred: referees.length,
      pendingUsdc: sum("pending"), paidUsdc: sum("paid"), missedUsdc: sum("missed"),
      recent: accruals.slice(0, 20).map((x) => ({ at: x.at, referee: short(x.refereeWallet), spendUsdc: x.spendUsdc, shareUsdc: x.shareUsdc, status: x.status, tier: x.tier })),
      referredBy: boundTo ? short(boundTo.referrerWallet) : null,
    };
  },
});

/** Public counters and the latest anonymised earnings, for the page's live ticker. */
export const publicStats = query({
  args: {},
  handler: async (ctx) => {
    const s = await ctx.db.query("referralStats").withIndex("by_key", (q) => q.eq("key", STATS_KEY)).unique();
    const recent = await ctx.db.query("referralAccruals").withIndex("by_time").order("desc").take(12);
    return {
      accruedUsdc: s?.accruedUsdc ?? 0, missedUsdc: s?.missedUsdc ?? 0, events: s?.events ?? 0, referrers: s?.referrers ?? 0, referred: s?.referred ?? 0,
      recent: recent.map((x) => ({ at: x.at, referrer: short(x.referrerWallet), shareUsdc: x.shareUsdc, missed: x.status === "missed" })),
    };
  },
});

/** The top referrers by earnings (pending and paid), anonymised. */
export const leaderboard = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("referralAccruals").withIndex("by_time").order("desc").take(500);
    const totals = new Map<string, number>();
    for (const r of rows) if (r.status !== "missed") totals.set(r.referrerWallet, (totals.get(r.referrerWallet) ?? 0) + r.shareUsdc);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([wallet, usdc]) => ({ wallet: short(wallet), usdc: +usdc.toFixed(4) }));
  },
});
