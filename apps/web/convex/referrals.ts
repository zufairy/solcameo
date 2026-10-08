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

/**
 * Referrers owed a payout: wallets whose pending earnings have reached `minUsdc`. Operations pays each one in USDC from the
 * treasury, then calls `markPaid` with the transfer signature, so a payout is always backed by an on-chain transfer.
 */
export const payoutQueue = query({
  args: { minUsdc: v.number(), authSecret: v.string() },
  handler: async (ctx, { minUsdc, authSecret }) => {
    gate(authSecret);
    const rows = await ctx.db.query("referralAccruals").withIndex("by_time").order("desc").take(5000);
    const owed = new Map<string, { usdc: number; upToAt: number; count: number }>();
    for (const r of rows) {
      if (r.status !== "pending") continue;
      const e = owed.get(r.referrerWallet) ?? { usdc: 0, upToAt: 0, count: 0 };
      e.usdc += r.shareUsdc; e.upToAt = Math.max(e.upToAt, r.at); e.count += 1;
      owed.set(r.referrerWallet, e);
    }
    return [...owed.entries()].filter(([, e]) => e.usdc >= minUsdc)
      .map(([wallet, e]) => ({ wallet, usdc: +e.usdc.toFixed(6), upToAt: e.upToAt, accruals: e.count })).sort((a, b) => b.usdc - a.usdc);
  },
});

/** Mark a referrer's pending earnings up to `upToAt` as paid by the on-chain transfer `txSignature`. Idempotent: paid rows are skipped. */
export const markPaid = mutation({
  args: { referrerWallet: v.string(), upToAt: v.number(), txSignature: v.string(), authSecret: v.string() },
  handler: async (ctx, { referrerWallet, upToAt, txSignature, authSecret }) => {
    gate(authSecret);
    if (txSignature.trim().length < 40) throw new Error("a real transfer signature is required");
    const rows = await ctx.db.query("referralAccruals").withIndex("by_referrer", (q) => q.eq("referrerWallet", referrerWallet).lte("at", upToAt)).take(1000);
    let paid = 0, usdc = 0;
    for (const r of rows) {
      if (r.status !== "pending") continue;
      await ctx.db.patch(r._id, { status: "paid", paidSig: txSignature.trim() });
      paid += 1; usdc += r.shareUsdc;
    }
    return { paid, usdc: +usdc.toFixed(6) };
  },
});

/* ── Automatic on-chain payouts ─────────────────────────────────────────────────
 * The payout route sends the USDC, then these mutations record it. beginPayout leases a referrer's pending earnings (one payout at a
 * time per wallet); a lease that already holds a signature is resumed (verified on-chain) instead of paid again. */

/** Lease a referrer's pending earnings for a payout, or hand back the unfinished one. */
export const beginPayout = mutation({
  args: { referrerWallet: v.string(), minUsdc: v.number(), authSecret: v.string() },
  handler: async (ctx, { referrerWallet, minUsdc, authSecret }) => {
    gate(authSecret);
    const open = await ctx.db.query("referralPayouts").withIndex("by_wallet", (q) => q.eq("referrerWallet", referrerWallet)).order("desc").first();
    if (open?.status === "sending") return { kind: "resume" as const, id: open._id, sig: open.sig ?? null, lastValidBlockHeight: open.lastValidBlockHeight ?? null, upToAt: open.upToAt, usdc: open.usdc, ageMs: Date.now() - open.createdAt };
    const rows = await ctx.db.query("referralAccruals").withIndex("by_referrer", (q) => q.eq("referrerWallet", referrerWallet)).order("desc").take(1000);
    const pending = rows.filter((r) => r.status === "pending");
    const usdc = +pending.reduce((n, r) => n + r.shareUsdc, 0).toFixed(6);
    if (usdc < minUsdc) return { kind: "none" as const };
    const upToAt = Math.max(...pending.map((r) => r.at));
    const now = Date.now();
    const id = await ctx.db.insert("referralPayouts", { referrerWallet, upToAt, usdc, status: "sending", createdAt: now, updatedAt: now });
    return { kind: "fresh" as const, id, upToAt, usdc };
  },
});

/** Keep the signature (and how long it can still land) the moment it is known, so a retry can verify it instead of resending. */
export const recordPayoutSig = mutation({
  args: { id: v.id("referralPayouts"), sig: v.string(), lastValidBlockHeight: v.optional(v.number()), authSecret: v.string() },
  handler: async (ctx, { id, sig, lastValidBlockHeight, authSecret }) => {
    gate(authSecret);
    await ctx.db.patch(id, { sig, ...(lastValidBlockHeight !== undefined ? { lastValidBlockHeight } : {}), updatedAt: Date.now() });
  },
});

/** The transfer is confirmed: mark every earning up to the lease as paid by its signature. Idempotent. */
export const finishPayout = mutation({
  args: { id: v.id("referralPayouts"), sig: v.string(), authSecret: v.string() },
  handler: async (ctx, { id, sig, authSecret }) => {
    gate(authSecret);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("payout not found");
    if (row.status === "paid") return { paid: 0, usdc: 0 };
    const rows = await ctx.db.query("referralAccruals").withIndex("by_referrer", (q) => q.eq("referrerWallet", row.referrerWallet).lte("at", row.upToAt)).take(1000);
    let paid = 0, usdc = 0;
    for (const r of rows) { if (r.status !== "pending") continue; await ctx.db.patch(r._id, { status: "paid", paidSig: sig }); paid += 1; usdc += r.shareUsdc; }
    await ctx.db.patch(id, { status: "paid", sig, updatedAt: Date.now() });
    return { paid, usdc: +usdc.toFixed(6) };
  },
});

/** Give the earnings back to the queue after a payout that provably never left (no signature, or one that can no longer land). */
export const failPayout = mutation({
  args: { id: v.id("referralPayouts"), error: v.string(), authSecret: v.string() },
  handler: async (ctx, { id, error, authSecret }) => {
    gate(authSecret);
    await ctx.db.patch(id, { status: "failed", error: error.slice(0, 300), updatedAt: Date.now() });
  },
});

/** Everyone with pending earnings at or above the minimum, plus any payout still waiting on confirmation. */
export const payoutWork = query({
  args: { minUsdc: v.number(), authSecret: v.string() },
  handler: async (ctx, { minUsdc, authSecret }) => {
    gate(authSecret);
    const rows = await ctx.db.query("referralAccruals").withIndex("by_time").order("desc").take(5000);
    const owed = new Map<string, number>();
    for (const r of rows) if (r.status === "pending") owed.set(r.referrerWallet, (owed.get(r.referrerWallet) ?? 0) + r.shareUsdc);
    const sending = await ctx.db.query("referralPayouts").withIndex("by_status", (q) => q.eq("status", "sending")).take(50);
    const wallets = new Set<string>([...owed].filter(([, usdc]) => usdc >= minUsdc).map(([w]) => w));
    for (const p of sending) wallets.add(p.referrerWallet);
    return [...wallets].slice(0, 12);
  },
});

/** A referrer's own payout history, for the page. */
export const payoutsFor = query({
  args: { wallet: v.string(), authSecret: v.string() },
  handler: async (ctx, { wallet, authSecret }) => {
    gate(authSecret);
    const rows = await ctx.db.query("referralPayouts").withIndex("by_wallet", (q) => q.eq("referrerWallet", wallet)).order("desc").take(10);
    return rows.map((r) => ({ at: r.createdAt, usdc: r.usdc, status: r.status, sig: r.sig ?? null }));
  },
});
