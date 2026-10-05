import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalAction,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { assertSecret } from "./lib/solstarAuth";
import { splitCollectedPartner } from "../lib/meteora/flywheel";
import { appFetch } from "./lib/appFetch";

export const status = query({
  args: { characterId: v.id("ssCharacters") },
  handler: async (ctx, a) => {
    const token = await ctx.db
      .query("ssTokens")
      .withIndex("by_character", (q) => q.eq("characterId", a.characterId))
      .unique();
    if (!token) return null;
    const wheel = await ctx.db
      .query("ssFlywheels")
      .withIndex("by_token", (q) => q.eq("tokenId", token._id))
      .unique();
    const budget = await ctx.db
      .query("ssBudgets")
      .withIndex("by_token", (q) => q.eq("tokenId", token._id))
      .unique();
    const jobs = await ctx.db
      .query("ssContentJobs")
      .withIndex("by_token", (q) => q.eq("tokenId", token._id))
      .order("desc")
      .take(5);
    const character = await ctx.db.get(a.characterId);
    return {
      ownerWallet: character?.ownerWallet,
      economy: token.economy ?? "creator-only",
      network: token.network,
      enabled: wheel?.enabled ?? false,
      status: wheel?.status ?? "creator_only",
      error: wheel?.error ?? null,
      treasury: token.treasuryWallet ?? null,
      available: (
        (budget?.fundedLamports ?? 0n) -
        (budget?.reservedLamports ?? 0n) -
        (budget?.spentLamports ?? 0n)
      ).toString(),
      funded: (budget?.fundedLamports ?? 0n).toString(),
      spent: (budget?.spentLamports ?? 0n).toString(),
      reserved: (budget?.reservedLamports ?? 0n).toString(),
      jobs: jobs.map((j) => ({
        id: j._id,
        status: j.status,
        videoUrl: j.videoUrl ?? null,
        createdAt: j.createdAt,
      })),
      updatedAt: wheel?.updatedAt ?? null,
    };
  },
});
export const setEnabled = mutation({
  args: {
    characterId: v.id("ssCharacters"),
    wallet: v.string(),
    enabled: v.boolean(),
    authSecret: v.string(),
  },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const c = await ctx.db.get(a.characterId);
    if (c?.ownerWallet !== a.wallet) throw new Error("character_not_found");
    const token = await ctx.db
      .query("ssTokens")
      .withIndex("by_character", (q) => q.eq("characterId", a.characterId))
      .unique();
    if (!token) throw new Error("token_not_found");
    const wheel = await ctx.db
      .query("ssFlywheels")
      .withIndex("by_token", (q) => q.eq("tokenId", token._id))
      .unique();
    if (!wheel)
      throw new Error("This launch uses its original creator-only economics.");
    await ctx.db.patch(wheel._id, {
      enabled: a.enabled,
      nextRunAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
export const due = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("ssFlywheels")
      .withIndex("by_next_run", (q) => q.lte("nextRunAt", Date.now()))
      .take(10);
    return rows.map((r) => r.tokenId);
  },
});
export const acquire = mutation({
  args: { tokenId: v.id("ssTokens"), authSecret: v.string() },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const wheel = await ctx.db
      .query("ssFlywheels")
      .withIndex("by_token", (q) => q.eq("tokenId", a.tokenId))
      .unique();
    if (!wheel || wheel.leaseUntil > Date.now()) return null;
    const token = await ctx.db.get(a.tokenId);
    if (
      !token ||
      !token.dbcPool ||
      !token.dbcConfig ||
      token.network === "paper"
    )
      return null;
    const character = await ctx.db.get(token.characterId);
    if (character?.status !== "approved") return null;
    const lease = Date.now() + 90000;
    await ctx.db.patch(wheel._id, {
      leaseUntil: lease,
      nextRunAt: Date.now() + 120000,
      updatedAt: Date.now(),
    });
    return { wheel, token, character, lease };
  },
});
export const progress = mutation({
  args: {
    tokenId: v.id("ssTokens"),
    lease: v.number(),
    status: v.string(),
    error: v.optional(v.string()),
    signature: v.optional(v.string()),
    transaction: v.optional(v.string()),
    quoteVault: v.optional(v.string()),
    clearClaim: v.optional(v.boolean()),
    authSecret: v.string(),
  },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const w = await ctx.db
      .query("ssFlywheels")
      .withIndex("by_token", (q) => q.eq("tokenId", a.tokenId))
      .unique();
    if (!w || w.leaseUntil !== a.lease) throw new Error("lease_lost");
    await ctx.db.patch(w._id, {
      status: a.status,
      error: a.error,
      updatedAt: Date.now(),
      ...(a.signature
        ? {
            claimSignature: a.signature,
            claimTransaction: a.transaction,
            claimVault: a.quoteVault,
          }
        : {}),
      ...(a.clearClaim
        ? {
            claimSignature: undefined,
            claimTransaction: undefined,
            claimVault: undefined,
          }
        : {}),
    });
  },
});
export const recordClaim = mutation({
  args: {
    tokenId: v.id("ssTokens"),
    signature: v.string(),
    amountLamports: v.int64(),
    authSecret: v.string(),
  },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const token = await ctx.db.get(a.tokenId);
    if (
      !token ||
      token.economy !== "sustainable-v1" ||
      token.network === "paper"
    )
      throw new Error("invalid_policy");
    const key = `dbc:${a.signature}`;
    const existing = await ctx.db
      .query("ssLedger")
      .withIndex("by_idem", (q) => q.eq("idempotencyKey", `${key}:content`))
      .unique();
    if (existing) {
      if (existing.tokenId !== a.tokenId)
        throw new Error("idempotency_conflict");
      return false;
    }
    const { content, ops } = splitCollectedPartner(a.amountLamports);
    const b = await ctx.db
      .query("ssBudgets")
      .withIndex("by_token", (q) => q.eq("tokenId", a.tokenId))
      .unique();
    if (!b || b.network !== token.network) throw new Error("budget_not_found");
    for (const [kind, amount, suffix] of [
      ["content_funding", content, "content"],
      ["platform_ops", ops, "ops"],
    ] as const)
      await ctx.db.insert("ssLedger", {
        tokenId: a.tokenId,
        network: token.network,
        kind,
        amountLamports: amount,
        idempotencyKey: `${key}:${suffix}`,
        source: a.signature,
        createdAt: Date.now(),
      });
    await ctx.db.patch(b._id, { fundedLamports: b.fundedLamports + content });
    return true;
  },
});
export const migrationConfirmed = mutation({
  args: {
    tokenId: v.id("ssTokens"),
    dammPool: v.string(),
    authSecret: v.string(),
  },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const t = await ctx.db.get(a.tokenId);
    if (!t || t.network === "paper") throw new Error("invalid_token");
    await ctx.db.patch(t._id, { state: "migrated", dammPool: a.dammPool });
  },
});
export const reserveVideo = mutation({
  args: {
    tokenId: v.id("ssTokens"),
    costLamports: v.int64(),
    authSecret: v.string(),
  },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    if (a.costLamports <= 0n || a.costLamports > 10000000000n)
      throw new Error("invalid_cost");
    const token = await ctx.db.get(a.tokenId);
    if (token?.network !== "mainnet") return null; // Test SOL cannot buy provider credits.
    const w = await ctx.db
      .query("ssFlywheels")
      .withIndex("by_token", (q) => q.eq("tokenId", a.tokenId))
      .unique();
    if (!w?.enabled) return null;
    const active = await ctx.db
      .query("ssContentJobs")
      .withIndex("by_token", (q) => q.eq("tokenId", a.tokenId))
      .order("desc")
      .take(1);
    if (
      active[0] &&
      (["reserved", "submitting", "running", "unknown"].includes(
        active[0].status,
      ) ||
        Date.now() - active[0].createdAt < 86400000)
    )
      return null;
    const rounds = await ctx.db
      .query("ssCommunityRounds")
      .withIndex("by_character_window", (q) =>
        q.eq("characterId", token.characterId),
      )
      .order("desc")
      .take(10);
    const round = rounds.find((r) => r.status === "complete" && r.plot);
    if (!round?.plot) return null;
    const key = `content-${round._id}`;
    if (
      await ctx.db
        .query("ssContentJobs")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique()
    )
      return null;
    const b = await ctx.db
      .query("ssBudgets")
      .withIndex("by_token", (q) => q.eq("tokenId", a.tokenId))
      .unique();
    if (
      !b ||
      b.fundedLamports - b.spentLamports - b.reservedLamports < a.costLamports
    )
      return null;
    const now = Date.now();
    await ctx.db.patch(b._id, {
      reservedLamports: b.reservedLamports + a.costLamports,
    });
    await ctx.db.insert("ssLedger", {
      tokenId: a.tokenId,
      network: "mainnet",
      kind: "reservation",
      amountLamports: a.costLamports,
      idempotencyKey: key,
      source: "kie",
      createdAt: now,
    });
    const id = await ctx.db.insert("ssContentJobs", {
      tokenId: a.tokenId,
      roundId: round._id,
      key,
      status: "reserved",
      costLamports: a.costLamports,
      prompt: round.plot,
      ...(round.referenceImageUrl ? { referenceImageUrl: round.referenceImageUrl } : {}),
      createdAt: now,
      updatedAt: now,
    });
    return { id, prompt: round.plot };
  },
});
export const currentJob = query({
  args: { tokenId: v.id("ssTokens"), authSecret: v.string() },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    return await ctx.db
      .query("ssContentJobs")
      .withIndex("by_token", (q) => q.eq("tokenId", a.tokenId))
      .order("desc")
      .first();
  },
});
export const updateJob = mutation({
  args: {
    id: v.id("ssContentJobs"),
    status: v.union(
      v.literal("submitting"),
      v.literal("running"),
      v.literal("unknown"),
      v.literal("failed"),
      v.literal("complete"),
      v.literal("rejected"),
    ),
    taskId: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const j = await ctx.db.get(a.id);
    if (!j) throw new Error("job_not_found");
    if (["complete", "failed", "rejected"].includes(j.status)) return;
    if (a.status === "submitting" && j.status !== "reserved")
      throw new Error("already_submitted");
    if (a.status === "running" && !a.taskId) throw new Error("task_required");
    if (["complete", "failed", "rejected"].includes(a.status)) {
      if (a.status === "complete" && (!a.videoUrl || !j.taskId))
        throw new Error("result_required");
      if (a.status === "rejected" && j.taskId)
        throw new Error("task_already_accepted");
      const b = await ctx.db
        .query("ssBudgets")
        .withIndex("by_token", (q) => q.eq("tokenId", j.tokenId))
        .unique();
      if (!b || b.reservedLamports < j.costLamports)
        throw new Error("reservation_missing");
      const spend = a.status !== "rejected";
      await ctx.db.patch(b._id, {
        reservedLamports: b.reservedLamports - j.costLamports,
        spentLamports: b.spentLamports + (spend ? j.costLamports : 0n),
      });
      await ctx.db.insert("ssLedger", {
        tokenId: j.tokenId,
        network: b.network,
        kind: spend ? "spend" : "release",
        amountLamports: j.costLamports,
        idempotencyKey: `${j.key}:${spend ? "spend" : "release"}`,
        source: "kie",
        createdAt: Date.now(),
      });
      if (a.status === "complete") {
        const last = await ctx.db
          .query("ssEpisodes")
          .withIndex("by_token", (q) => q.eq("tokenId", j.tokenId))
          .order("desc")
          .first();
        const token = await ctx.db.get(j.tokenId);
        const c = token ? await ctx.db.get(token.characterId) : null;
        await ctx.db.insert("ssEpisodes", {
          tokenId: j.tokenId,
          index: (last?.index ?? -1) + 1,
          videoUrl: a.videoUrl!,
          posterUrl: c?.referenceImageUrl ?? "",
          title: `${c?.name ?? "Creator"}: next chapter`,
          prompt: j.prompt,
          source: "generated",
          // The keeper submits every flywheel job to Kie grok-imagine/image-to-video.
          engine: "Grok Imagine",
          createdAt: Date.now(),
        });
      }
    }
    await ctx.db.patch(a.id, {
      status: a.status,
      ...(a.taskId ? { taskId: a.taskId } : {}),
      ...(a.videoUrl ? { videoUrl: a.videoUrl } : {}),
      error: a.error,
      updatedAt: Date.now(),
    });
  },
});
export const sweep = internalAction({
  args: {},
  handler: async (ctx) => {
    const ids = await ctx.runQuery(internal.solstarFlywheel.due, {});
    for (const tokenId of ids) {
      try {
        const res = await appFetch("/api/meteora/keeper", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.INTERNAL_CRON_SECRET}`,
          },
          body: JSON.stringify({ tokenId }),
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) console.error("DBC keeper failed", res.status);
      } catch (e) {
        console.error("DBC keeper unavailable", String(e));
      }
    }
  },
});
