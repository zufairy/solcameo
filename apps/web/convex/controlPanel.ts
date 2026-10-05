import { v, type Infer } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { verifyToken } from "./lib/supabaseAuth";
import { controlMessageValidator } from "./lib/controlPanelValidators";

/* ════════ /control panel persistence ════════
   Teams and chat history for the master control panel, stored per ACCOUNT so
   they follow the operator across devices and browsers. Every public entry
   point is an action that verifies the caller's access token, then reads or
   writes only that user's rows. */

type ControlMessage = Infer<typeof controlMessageValidator>;

const MAX_MESSAGES = 80;
const MAX_CONTENT_CHARS = 6_000;
const MAX_THREADS = 200;
const MAX_TEAMS = 50;
const MAX_MEMBERS = 8;

export type ControlTeam = { teamId: string; name: string; memberMints: string[]; createdAt: number; brief?: string };
export type ControlThread = { key: string; messages: ControlMessage[]; updatedAt: number };

async function callerId(ctx: ActionCtx, accessToken: string): Promise<Id<"users">> {
  const { supabaseId } = await verifyToken(accessToken);
  const user = await ctx.runQuery(internal.users.getBySupabaseId, { supabaseId });
  if (!user) throw new Error("Account not found");
  return user._id;
}

function clampMessages(messages: ControlMessage[]): ControlMessage[] {
  return messages.slice(-MAX_MESSAGES).map((m) => ({
    ...m,
    content: m.content.slice(0, MAX_CONTENT_CHARS),
    // A plan is small by design (≤6 steps); drop one that isn't, rather than
    // letting a malformed client blow the document size.
    ...(m.plan !== undefined && JSON.stringify(m.plan).length > 20_000 ? { plan: undefined } : {}),
    ...(m.notes ? { notes: m.notes.slice(0, 6).map((n) => n.slice(0, 300)) } : {}),
  }));
}

/* ── Internal data layer ──────────────────────────────────────────────── */

export const loadAll = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ teams: ControlTeam[]; threads: ControlThread[] }> => {
    const teams = await ctx.db.query("controlTeams").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_TEAMS);
    const threads = await ctx.db.query("controlThreads").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_THREADS);
    return {
      teams: teams
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((t) => ({ teamId: t.teamId, name: t.name, memberMints: t.memberMints, createdAt: t.createdAt, ...(t.brief ? { brief: t.brief } : {}) })),
      threads: threads.map((t) => ({ key: t.key, messages: t.messages, updatedAt: t.updatedAt })),
    };
  },
});

export const writeThread = internalMutation({
  args: { userId: v.id("users"), key: v.string(), messages: v.array(controlMessageValidator) },
  handler: async (ctx, { userId, key, messages }): Promise<{ updatedAt: number }> => {
    const updatedAt = Date.now();
    const existing = await ctx.db
      .query("controlThreads")
      .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", key))
      .unique();
    const clamped = clampMessages(messages);
    if (existing) {
      if (clamped.length === 0) await ctx.db.delete(existing._id);
      else await ctx.db.patch(existing._id, { messages: clamped, updatedAt });
    } else if (clamped.length > 0) {
      await ctx.db.insert("controlThreads", { userId, key, messages: clamped, updatedAt });
    }
    return { updatedAt };
  },
});

export const writeTeam = internalMutation({
  args: { userId: v.id("users"), teamId: v.string(), name: v.string(), memberMints: v.array(v.string()), createdAt: v.number(), brief: v.optional(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query("controlTeams")
      .withIndex("by_user_team", (q) => q.eq("userId", args.userId).eq("teamId", args.teamId))
      .unique();
    const row = {
      name: args.name.trim().slice(0, 60) || "Team",
      memberMints: [...new Set(args.memberMints)].slice(0, MAX_MEMBERS),
      brief: args.brief?.trim().slice(0, 1200) || undefined,
    };
    if (existing) {
      await ctx.db.patch(existing._id, row);
      return null;
    }
    const count = (await ctx.db.query("controlTeams").withIndex("by_user", (q) => q.eq("userId", args.userId)).take(MAX_TEAMS)).length;
    if (count >= MAX_TEAMS) throw new Error(`You can have up to ${MAX_TEAMS} teams.`);
    await ctx.db.insert("controlTeams", { userId: args.userId, teamId: args.teamId, createdAt: args.createdAt, ...row });
    return null;
  },
});

export const removeTeam = internalMutation({
  args: { userId: v.id("users"), teamId: v.string() },
  handler: async (ctx, { userId, teamId }): Promise<null> => {
    const team = await ctx.db
      .query("controlTeams")
      .withIndex("by_user_team", (q) => q.eq("userId", userId).eq("teamId", teamId))
      .unique();
    if (team) await ctx.db.delete(team._id);
    const thread = await ctx.db
      .query("controlThreads")
      .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", `team:${teamId}`))
      .unique();
    if (thread) await ctx.db.delete(thread._id);
    return null;
  },
});

/* ── Public (token-verified) ──────────────────────────────────────────── */

/** Everything the panel needs on open: the caller's teams + chat threads. */
export const bootstrap = action({
  args: { accessToken: v.string() },
  handler: async (ctx, { accessToken }): Promise<{ teams: ControlTeam[]; threads: ControlThread[] }> => {
    const userId = await callerId(ctx, accessToken);
    return await ctx.runQuery(internal.controlPanel.loadAll, { userId });
  },
});

export const saveThread = action({
  args: { accessToken: v.string(), key: v.string(), messages: v.array(controlMessageValidator) },
  handler: async (ctx, { accessToken, key, messages }): Promise<{ updatedAt: number }> => {
    const userId = await callerId(ctx, accessToken);
    return await ctx.runMutation(internal.controlPanel.writeThread, { userId, key: key.slice(0, 120), messages });
  },
});

export const saveTeam = action({
  args: { accessToken: v.string(), teamId: v.string(), name: v.string(), memberMints: v.array(v.string()), createdAt: v.number(), brief: v.optional(v.string()) },
  handler: async (ctx, { accessToken, ...team }): Promise<null> => {
    const userId = await callerId(ctx, accessToken);
    return await ctx.runMutation(internal.controlPanel.writeTeam, { userId, ...team, teamId: team.teamId.slice(0, 40) });
  },
});

export const deleteTeam = action({
  args: { accessToken: v.string(), teamId: v.string() },
  handler: async (ctx, { accessToken, teamId }): Promise<null> => {
    const userId = await callerId(ctx, accessToken);
    return await ctx.runMutation(internal.controlPanel.removeTeam, { userId, teamId });
  },
});
