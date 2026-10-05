// convex/solstarBudget.ts
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { assertSecret } from "./lib/solstarAuth";
import { MAX_AMOUNT, type FeeSplit } from "../lib/solstar/economics";
import type { Network } from "../lib/solstar/types";

async function budgetFor(ctx: MutationCtx, tokenId: Id<"ssTokens">) {
  const row = await ctx.db.query("ssBudgets").withIndex("by_token", (q) => q.eq("tokenId", tokenId)).first();
  if (!row) throw new Error("budget_not_found");
  return row;
}
const byKey = (ctx: MutationCtx, key: string) =>
  ctx.db.query("ssLedger").withIndex("by_idem", (q) => q.eq("idempotencyKey", key)).first();

/** Credit one trade's fee split to the ledger (idempotent per key). Only `content` becomes spendable budget. */
export async function applyFeeSplit(
  ctx: MutationCtx,
  a: { tokenId: Id<"ssTokens">; network: Network; split: FeeSplit; idempotencyKey: string; source: string },
): Promise<boolean> {
  const token = await ctx.db.get(a.tokenId);
  if (!token) throw new Error("token_not_found");
  if (token.network !== a.network) throw new Error("network_mismatch");
  if (await byKey(ctx, `${a.idempotencyKey}:protocol`)) return false;
  const now = Date.now();
  const rows = [
    { kind: "protocol", suffix: "protocol", amount: a.split.protocol },
    { kind: "creator_earning", suffix: "creator", amount: a.split.creator },
    { kind: "platform_ops", suffix: "ops", amount: a.split.ops },
    { kind: "content_funding", suffix: "content", amount: a.split.content },
  ] as const;
  for (const r of rows) {
    await ctx.db.insert("ssLedger", {
      tokenId: a.tokenId, network: a.network, kind: r.kind, amountLamports: r.amount,
      idempotencyKey: `${a.idempotencyKey}:${r.suffix}`, source: a.source, createdAt: now,
    });
  }
  const b = await budgetFor(ctx, a.tokenId);
  await ctx.db.patch(b._id, { fundedLamports: b.fundedLamports + a.split.content });
  return true;
}

export const reserve = mutation({
  args: { tokenId: v.id("ssTokens"), amountLamports: v.int64(), idempotencyKey: v.string(), provider: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    if (a.amountLamports <= 0n || a.amountLamports > MAX_AMOUNT) throw new Error("invalid_amount");
    if (a.idempotencyKey.length < 1 || a.idempotencyKey.length > 128 || a.idempotencyKey.includes(":")) throw new Error("invalid_key");
    const token = await ctx.db.get(a.tokenId);
    if (!token) throw new Error("token_not_found");
    if (token.network === "paper" && a.provider !== "demo") throw new Error("paper_cannot_fund_real_provider");
    const existing = await byKey(ctx, a.idempotencyKey);
    if (existing) {
      if (existing.kind !== "reservation" || existing.tokenId !== a.tokenId || existing.amountLamports !== a.amountLamports) {
        throw new Error("idempotency_conflict");
      }
      return { ok: true as const, reused: true };
    }
    const b = await budgetFor(ctx, a.tokenId);
    if (b.fundedLamports - b.reservedLamports - b.spentLamports < a.amountLamports) throw new Error("insufficient_budget");
    await ctx.db.patch(b._id, { reservedLamports: b.reservedLamports + a.amountLamports });
    await ctx.db.insert("ssLedger", {
      tokenId: a.tokenId, network: token.network, kind: "reservation", amountLamports: a.amountLamports,
      idempotencyKey: a.idempotencyKey, source: a.provider, createdAt: Date.now(),
    });
    return { ok: true as const, reused: false };
  },
});

async function settle(ctx: MutationCtx, tokenId: Id<"ssTokens">, key: string, as: "release" | "spend") {
  const res = await byKey(ctx, key);
  if (!res || res.kind !== "reservation" || res.tokenId !== tokenId) throw new Error("reservation_not_found");
  const other = as === "release" ? "spend" : "release";
  if (await byKey(ctx, `${key}:${other}`)) throw new Error("reservation_settled");
  if (await byKey(ctx, `${key}:${as}`)) return { ok: true as const, reused: true };
  const b = await budgetFor(ctx, tokenId);
  await ctx.db.patch(b._id, {
    reservedLamports: b.reservedLamports - res.amountLamports,
    spentLamports: b.spentLamports + (as === "spend" ? res.amountLamports : 0n),
  });
  await ctx.db.insert("ssLedger", {
    tokenId, network: res.network, kind: as, amountLamports: res.amountLamports,
    idempotencyKey: `${key}:${as}`, source: res.source, createdAt: Date.now(),
  });
  return { ok: true as const, reused: false };
}

export const release = mutation({
  args: { tokenId: v.id("ssTokens"), reservationKey: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => { assertSecret(a.authSecret); return settle(ctx, a.tokenId, a.reservationKey, "release"); },
});
export const spend = mutation({
  args: { tokenId: v.id("ssTokens"), reservationKey: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => { assertSecret(a.authSecret); return settle(ctx, a.tokenId, a.reservationKey, "spend"); },
});
