import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { consumeSignature } from "./lib/payments";

function authorize(secret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
}
const reportValidator = v.object({ proofHash: v.string(), resource: v.string(), report: v.string(), paymentHeader: v.string(),
  state: v.union(v.literal("settling"), v.literal("paid"), v.literal("unknown"), v.literal("cancelled")), receipt: v.optional(v.string()) });
export const getReport = query({
  args: { proofHash: v.string(), authSecret: v.string() }, returns: v.union(reportValidator, v.null()),
  handler: async (ctx, a) => {
    authorize(a.authSecret);
    const r = await ctx.db.query("x402Reports").withIndex("by_proofHash", q => q.eq("proofHash", a.proofHash)).unique();
    return r ? { proofHash: r.proofHash, resource: r.resource, report: r.report, paymentHeader: r.paymentHeader, state: r.state, receipt: r.receipt } : null;
  },
});
export const claimReport = mutation({
  args: { proofHash: v.string(), resource: v.string(), report: v.string(), paymentHeader: v.string(), authSecret: v.string() }, returns: v.boolean(),
  handler: async (ctx, a) => {
    authorize(a.authSecret);
    if (a.report.length > 100_000) throw new Error("report too large");
    const prior = await ctx.db.query("x402Reports").withIndex("by_proofHash", q => q.eq("proofHash", a.proofHash)).unique();
    if (prior) return false;
    await ctx.db.insert("x402Reports", { proofHash: a.proofHash, resource: a.resource, report: a.report, paymentHeader: a.paymentHeader, state: "settling", createdAt: Date.now() });
    return true;
  },
});
export const finishReport = mutation({
  args: { proofHash: v.string(), receipt: v.string(), txSignature: v.string(), authSecret: v.string() }, returns: v.null(),
  handler: async (ctx, a) => {
    authorize(a.authSecret);
    const r = await ctx.db.query("x402Reports").withIndex("by_proofHash", q => q.eq("proofHash", a.proofHash)).unique();
    if (!r) throw new Error("missing report");
    if (r.state === "cancelled") throw new Error("payment was cancelled before settlement");
    if (r.state === "paid") { if (r.receipt !== a.receipt) throw new Error("receipt conflict"); return null; }
    await consumeSignature(ctx, { txSignature: a.txSignature, purpose: "x402_report", ref: a.proofHash, amount: 0.01 });
    await ctx.db.patch(r._id, { state: "paid", receipt: a.receipt });
    return null;
  },
});
export const markReportUnknown = mutation({
  args: { proofHash: v.string(), receipt: v.optional(v.string()), authSecret: v.string() }, returns: v.null(),
  handler: async (ctx, a) => {
    authorize(a.authSecret);
    const r = await ctx.db.query("x402Reports").withIndex("by_proofHash", q => q.eq("proofHash", a.proofHash)).unique();
    if (r && (r.state === "settling" || r.state === "unknown")) await ctx.db.patch(r._id, { state: "unknown", ...(a.receipt ? { receipt: a.receipt } : {}) });
    return null;
  },
});
export const setPolicy = mutation({
  args: { mintAddress: v.string(), ownerWallet: v.string(), enabled: v.boolean(), perRequestMicros: v.number(), dailyMicros: v.number(), walletAddress: v.string(), walletSecret: v.string(), network: v.string(), authSecret: v.string() }, returns: v.string(),
  handler: async (ctx, a) => {
    authorize(a.authSecret);
    const agent = await ctx.db.query("influencers").withIndex("by_mint", q => q.eq("mintAddress", a.mintAddress)).first();
    if (!agent || agent.creatorWallet !== a.ownerWallet) throw new Error("not owner");
    if (![a.perRequestMicros, a.dailyMicros].every(n => Number.isSafeInteger(n) && n >= 0) || a.perRequestMicros > 100_000 || a.dailyMicros > 1_000_000 || a.perRequestMicros > a.dailyMicros) throw new Error("invalid budget (maximum $0.10/request, $1/day)");
    const prior = await ctx.db.query("x402Policies").withIndex("by_mintAddress", q => q.eq("mintAddress", a.mintAddress)).unique();
    if (prior && (prior.walletAddress !== a.walletAddress || prior.walletSecret !== a.walletSecret || prior.network !== a.network)) throw new Error("wallet rotation is not supported");
    const value = { network: a.network, walletAddress: a.walletAddress, walletSecret: a.walletSecret, mintAddress: a.mintAddress, enabled: a.enabled, perRequestMicros: a.perRequestMicros, dailyMicros: a.dailyMicros, updatedAt: Date.now() };
    if (prior) await ctx.db.replace(prior._id, value); else await ctx.db.insert("x402Policies", value);
    return value.walletAddress;
  },
});
const policyValidator = v.object({ _id: v.id("x402Policies"), _creationTime: v.number(), mintAddress: v.string(), enabled: v.boolean(), perRequestMicros: v.number(), dailyMicros: v.number(), updatedAt: v.number(), walletAddress: v.string(), walletSecret: v.string(), network: v.string() });
const purchaseValidator = v.object({ _id: v.id("x402Purchases"), _creationTime: v.number(), taskId: v.id("agentTasks"), mintAddress: v.string(), day: v.number(), amountMicros: v.number(), resource: v.string(), state: v.union(v.literal("reserved"), v.literal("signed"), v.literal("paid"), v.literal("cancelled")), paymentHeader: v.optional(v.string()), proofHash: v.optional(v.string()), receipt: v.optional(v.string()), report: v.optional(v.string()), createdAt: v.number() });
export const getPolicyServer = query({
  args: { mintAddress: v.string(), authSecret: v.string() }, returns: v.union(policyValidator, v.null()),
  handler: async (ctx, a) => { authorize(a.authSecret); return await ctx.db.query("x402Policies").withIndex("by_mintAddress", q => q.eq("mintAddress", a.mintAddress)).unique(); },
});
export const reservePurchase = mutation({
  args: { taskId: v.id("agentTasks"), mintAddress: v.string(), amountMicros: v.number(), resource: v.string(), authSecret: v.string() }, returns: v.id("x402Purchases"),
  handler: async (ctx, a) => {
    authorize(a.authSecret);
    const task = await ctx.db.get(a.taskId);
    if (!task || task.mintAddress !== a.mintAddress || task.type !== "research" || task.status !== "running") throw new Error("invalid research task");
    const prior = await ctx.db.query("x402Purchases").withIndex("by_taskId", q => q.eq("taskId", a.taskId)).unique();
    if (prior) { if (prior.resource !== a.resource || prior.amountMicros !== a.amountMicros) throw new Error("purchase conflict"); return prior._id; }
    const policy = await ctx.db.query("x402Policies").withIndex("by_mintAddress", q => q.eq("mintAddress", a.mintAddress)).unique();
    if (!policy?.enabled || !Number.isSafeInteger(a.amountMicros) || a.amountMicros !== 10_000 || a.amountMicros > policy.perRequestMicros) throw new Error("x402 purchase not authorized");
    const day = Math.floor(Date.now() / 86_400_000);
    const purchases = await ctx.db.query("x402Purchases").withIndex("by_mintAddress_day", q => q.eq("mintAddress", a.mintAddress).eq("day", day)).take(101);
    const pending = await ctx.db.query("x402Purchases").withIndex("by_mintAddress_state", q => q.eq("mintAddress", a.mintAddress).eq("state", "signed")).take(101);
    const carryover = pending.filter(p => p.day !== day).reduce((sum, p) => sum + p.amountMicros, 0);
    if (purchases.length >= 100 || pending.length >= 100 || carryover + purchases.filter(p => p.state !== "cancelled").reduce((sum, p) => sum + p.amountMicros, 0) + a.amountMicros > policy.dailyMicros) throw new Error("x402 daily budget exceeded");
    return await ctx.db.insert("x402Purchases", { taskId: a.taskId, mintAddress: a.mintAddress, amountMicros: a.amountMicros, resource: a.resource, day, state: "reserved", createdAt: Date.now() });
  },
});
export const getPurchase = query({
  args: { id: v.id("x402Purchases"), authSecret: v.string() }, returns: v.union(purchaseValidator, v.null()),
  handler: async (ctx, a) => { authorize(a.authSecret); return await ctx.db.get(a.id); },
});
export const signPurchase = mutation({
  args: { id: v.id("x402Purchases"), paymentHeader: v.string(), proofHash: v.string(), authSecret: v.string() }, returns: v.boolean(),
  handler: async (ctx, a) => {
    authorize(a.authSecret);
    const p = await ctx.db.get(a.id);
    if (!p || p.state !== "reserved") return false;
    const policy = await ctx.db.query("x402Policies").withIndex("by_mintAddress", q => q.eq("mintAddress", p.mintAddress)).unique();
    if (!policy?.enabled || p.amountMicros > policy.perRequestMicros) throw new Error("x402 policy revoked");
    if (p.day !== Math.floor(Date.now() / 86_400_000)) throw new Error("Unsigned reservation expired");
    const daily = await ctx.db.query("x402Purchases").withIndex("by_mintAddress_day", q => q.eq("mintAddress", p.mintAddress).eq("day", p.day)).take(101);
    const pending = await ctx.db.query("x402Purchases").withIndex("by_mintAddress_state", q => q.eq("mintAddress", p.mintAddress).eq("state", "signed")).take(101);
    const carryover = pending.filter(r => r.day !== p.day).reduce((sum,r) => sum+r.amountMicros,0);
    if (daily.length > 100 || pending.length > 100 || carryover + daily.filter(r => r.state !== "cancelled").reduce((sum,r) => sum+r.amountMicros,0) > policy.dailyMicros) throw new Error("x402 daily budget reduced");
    if (!/^[a-f0-9]{64}$/.test(a.proofHash)) throw new Error("invalid proof hash");
    if (a.paymentHeader.length > 20_000) throw new Error("payload too large");
    await ctx.db.patch(p._id, { state: "signed", paymentHeader: a.paymentHeader, proofHash: a.proofHash }); return true;
  },
});
export const completePurchase = mutation({
  args: { id: v.id("x402Purchases"), receipt: v.string(), report: v.string(), authSecret: v.string() }, returns: v.null(),
  handler: async (ctx, a) => {
    authorize(a.authSecret); const p = await ctx.db.get(a.id);
    if (!p || (p.state !== "signed" && p.state !== "paid")) throw new Error("invalid purchase");
    if (p.state === "paid") { if (p.receipt !== a.receipt || p.report !== a.report) throw new Error("receipt conflict"); return null; }
    if (a.report.length > 100_000) throw new Error("report too large");
    await ctx.db.patch(p._id, { state: "paid", day: Math.floor(Date.now() / 86_400_000), receipt: a.receipt, report: a.report }); return null;
  },
});
export const cancelUnsettledPurchase = mutation({
  args: { id: v.id("x402Purchases"), authSecret: v.string() }, returns: v.null(),
  handler: async (ctx, a) => {
    authorize(a.authSecret); const p = await ctx.db.get(a.id);
    if (p?.state === "reserved") await ctx.db.patch(p._id, { state: "cancelled" });
    if (p?.state === "signed" && p.proofHash && p.paymentHeader) {
      const seller = await ctx.db.query("x402Reports").withIndex("by_proofHash", q => q.eq("proofHash", p.proofHash!)).unique();
      if (!seller) {
        // This buyer is constrained to OUR resource server. Atomically prevent
        // its proof from ever settling before releasing the reserved budget.
        // A racing seller either claims first (budget stays held), or sees this
        // tombstone and cannot settle. Never apply this to third-party sellers.
        await ctx.db.insert("x402Reports", { proofHash: p.proofHash, resource: p.resource, paymentHeader: p.paymentHeader, report: "{}", state: "cancelled", createdAt: Date.now() });
        await ctx.db.patch(p._id, { state: "cancelled" });
      } else if (seller.state === "cancelled") await ctx.db.patch(p._id, { state: "cancelled" });
    }
    return null;
  },
});
