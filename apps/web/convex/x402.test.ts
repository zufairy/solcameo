/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const authSecret = "x402-test";
afterEach(() => vi.unstubAllEnvs());
function setup() { vi.stubEnv("INTERNAL_CRON_SECRET", authSecret); return convexTest(schema, modules); }
async function funded(t: ReturnType<typeof setup>) {
  await t.run(async ctx => {
    if (!(await ctx.db.query("x402Policies").withIndex("by_mintAddress",q=>q.eq("mintAddress","mint")).first())) await ctx.db.insert("x402Policies", { mintAddress:"mint", enabled:true, perRequestMicros:10000, dailyMicros:20000, updatedAt:Date.now(), walletAddress:"wallet", walletSecret:"encrypted", network:"solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" });
  });
  return await t.run(async ctx => ctx.db.insert("agentTasks", { mintAddress:"mint", sessionId:"session", type:"research", status:"running", title:"research" }));
}
describe("x402 receipts and budget", () => {
  it("rejects untrusted calls", async () => {
    const t = setup(); await expect(t.query(api.x402.getReport,{proofHash:"proof",authSecret:"wrong"})).rejects.toThrow("unauthorized");
  });
  it("only one report settlement can claim a payment proof", async () => {
    const t = setup(); const a = {proofHash:"proof",resource:"report",report:"{}",paymentHeader:"signed",authSecret};
    const claims = await Promise.all([t.mutation(api.x402.claimReport,a),t.mutation(api.x402.claimReport,a)]);
    expect(claims.sort()).toEqual([false,true]);
  });
  it("stores a receipt and consumes the signature globally exactly once", async () => {
    const t = setup(); await t.mutation(api.x402.claimReport,{proofHash:"proof",resource:"report",report:"{}",paymentHeader:"signed",authSecret});
    const a = {proofHash:"proof",receipt:"receipt",txSignature:"tx",authSecret};
    await t.mutation(api.x402.finishReport,a); await t.mutation(api.x402.finishReport,a);
    expect((await t.query(api.x402.getReport,{proofHash:"proof",authSecret}))?.state).toBe("paid");
    await t.mutation(api.x402.claimReport,{proofHash:"other",resource:"other",report:"{}",paymentHeader:"signed",authSecret});
    await expect(t.mutation(api.x402.finishReport,{...a,proofHash:"other"})).rejects.toThrow("already processed");
  });
  it("uncertain settlement cannot be claimed again", async () => {
    const t = setup(); const a = {proofHash:"proof",resource:"report",report:"{}",paymentHeader:"signed",authSecret};
    await t.mutation(api.x402.claimReport,a); await t.mutation(api.x402.markReportUnknown,{proofHash:"proof",authSecret});
    expect(await t.mutation(api.x402.claimReport,a)).toBe(false);
  });
  it("enforces cumulative reservations and reuses a task's purchase", async () => {
    const t = setup(); const taskId = await funded(t);
    const a = {taskId,mintAddress:"mint",amountMicros:10000,resource:"report",authSecret};
    const id = await t.mutation(api.x402.reservePurchase,a);
    expect(await t.mutation(api.x402.reservePurchase,a)).toBe(id);
    const second = await funded(t); await t.mutation(api.x402.reservePurchase,{...a,taskId:second});
    const third = await t.run(async ctx => ctx.db.insert("agentTasks",{mintAddress:"mint",sessionId:"s",type:"research",status:"running",title:"r"}));
    await expect(t.mutation(api.x402.reservePurchase,{...a,taskId:third})).rejects.toThrow("daily budget");
  });
  it("cannot release a signed payment after timeout", async () => {
    const t = setup(); const taskId = await funded(t);
    const id = await t.mutation(api.x402.reservePurchase,{taskId,mintAddress:"mint",amountMicros:10000,resource:"report",authSecret});
    expect(await t.mutation(api.x402.signPurchase,{id,paymentHeader:"signed",proofHash:"a".repeat(64),authSecret})).toBe(true);
    expect(await t.mutation(api.x402.signPurchase,{id,paymentHeader:"different",proofHash:"b".repeat(64),authSecret})).toBe(false);
    await t.mutation(api.x402.claimReport,{proofHash:"a".repeat(64),resource:"report",report:"{}",paymentHeader:"signed",authSecret});
    await t.mutation(api.x402.cancelUnsettledPurchase,{id,authSecret});
    expect((await t.query(api.x402.getPurchase,{id,authSecret}))?.state).toBe("signed");
  });
  it("atomically cancels an unclaimed signed proof before releasing budget", async () => {
    const t=setup(); const taskId=await funded(t);
    const id=await t.mutation(api.x402.reservePurchase,{taskId,mintAddress:"mint",amountMicros:10000,resource:"report",authSecret});
    await t.mutation(api.x402.signPurchase,{id,paymentHeader:"signed",proofHash:"a".repeat(64),authSecret});
    await t.mutation(api.x402.cancelUnsettledPurchase,{id,authSecret});
    expect((await t.query(api.x402.getPurchase,{id,authSecret}))?.state).toBe("cancelled");
    expect(await t.mutation(api.x402.claimReport,{proofHash:"a".repeat(64),resource:"report",report:"{}",paymentHeader:"signed",authSecret})).toBe(false);
  });
  it("cancellation racing seller claim cannot release a settling payment", async () => {
    const t=setup();const taskId=await funded(t);
    const id=await t.mutation(api.x402.reservePurchase,{taskId,mintAddress:"mint",amountMicros:10000,resource:"report",authSecret});
    await t.mutation(api.x402.signPurchase,{id,paymentHeader:"signed",proofHash:"a".repeat(64),authSecret});
    await Promise.all([t.mutation(api.x402.cancelUnsettledPurchase,{id,authSecret}),t.mutation(api.x402.claimReport,{proofHash:"a".repeat(64),resource:"report",report:"{}",paymentHeader:"signed",authSecret})]);
    const seller=await t.query(api.x402.getReport,{proofHash:"a".repeat(64),authSecret});
    const buyer=await t.query(api.x402.getPurchase,{id,authSecret});
    expect(seller?.state === "settling" ? buyer?.state === "signed" : seller?.state === "cancelled" && buyer?.state === "cancelled").toBe(true);
  });
  it("carries unknown signed payments into the next day's budget", async () => {
    const t = setup(); const taskId = await funded(t);
    const id = await t.mutation(api.x402.reservePurchase,{taskId,mintAddress:"mint",amountMicros:10000,resource:"report",authSecret});
    await t.mutation(api.x402.signPurchase,{id,paymentHeader:"signed",proofHash:"a".repeat(64),authSecret});
    await t.run(async ctx => {
      await ctx.db.patch(id,{day:Math.floor(Date.now()/86400000)-1});
      const policy = await ctx.db.query("x402Policies").first(); await ctx.db.patch(policy!._id,{dailyMicros:10000});
    });
    const next = await t.run(async ctx => ctx.db.insert("agentTasks",{mintAddress:"mint",sessionId:"s",type:"research",status:"running",title:"r"}));
    await expect(t.mutation(api.x402.reservePurchase,{taskId:next,mintAddress:"mint",amountMicros:10000,resource:"report",authSecret})).rejects.toThrow("daily budget");
  });
  it("revocation blocks signing and unsigned cancellation releases its budget", async () => {
    const t = setup(); const taskId = await funded(t);
    const id = await t.mutation(api.x402.reservePurchase,{taskId,mintAddress:"mint",amountMicros:10000,resource:"report",authSecret});
    await t.run(async ctx => { const p=await ctx.db.query("x402Policies").first(); await ctx.db.patch(p!._id,{enabled:false}); });
    await expect(t.mutation(api.x402.signPurchase,{id,paymentHeader:"signed",proofHash:"a".repeat(64),authSecret})).rejects.toThrow("revoked");
    await t.mutation(api.x402.cancelUnsettledPurchase,{id,authSecret});
    expect((await t.query(api.x402.getPurchase,{id,authSecret}))?.state).toBe("cancelled");
  });
  it("rejects unconfigured agents, mismatched tasks, and changed resources", async () => {
    const t = setup(); const taskId = await funded(t);
    const a = {taskId,mintAddress:"mint",amountMicros:10000,resource:"report",authSecret};
    await expect(t.mutation(api.x402.reservePurchase,{...a,mintAddress:"other"})).rejects.toThrow("invalid research task");
    await t.mutation(api.x402.reservePurchase,a);
    await expect(t.mutation(api.x402.reservePurchase,{...a,resource:"other"})).rejects.toThrow("conflict");
  });
});
