import { v } from "convex/values";
import { mutation, action, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { resolveAdmin } from "./admin";
import { lookupAccount, type AccountIdentity } from "./lib/accountLookup";

const MAX_MESSAGES = 200;
const MAX_CONTENT_CHARS = 4_000;

export type LiveChatRow = {
  sessionId: string;
  wallet?: string;
  name?: string;
  email?: string;
  page?: string;
  /** Resolved Vello account (by verified DID, else wallet) — who asked. */
  accountName?: string;
  accountEmail?: string;
  messageCount: number;
  startedAt: number;
  lastActivityAt: number;
  lastMessagePreview: string;
};

/**
 * Append ONE message (visitor or AI) to a live-support chat, keyed by sessionId.
 * Public + fire-and-forget: the landing widget posts the visitor turn, and the
 * /api/support-chat route posts the AI turn. Follows the same public-mutation-
 * keyed-by-sessionId trust model as builderSessions.sync (telemetry, not money).
 */
export const append = mutation({
  args: {
    sessionId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    at: v.number(),
    wallet: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    userDid: v.optional(v.string()),
    page: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const content = args.content.slice(0, MAX_CONTENT_CHARS);
    if (!content.trim()) return { ok: true as const };
    const msg = { role: args.role, content, at: args.at };

    const existing = await ctx.db
      .query("liveChats")
      .withIndex("by_session_live", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (existing) {
      const messages = [...existing.messages, msg].slice(-MAX_MESSAGES);
      await ctx.db.patch(existing._id, {
        messages,
        messageCount: existing.messageCount + 1,
        lastActivityAt: args.at,
        // Never downgrade known identity; fill it in when we learn it.
        wallet: args.wallet ?? existing.wallet,
        name: args.name ?? existing.name,
        email: args.email ?? existing.email,
        userDid: args.userDid ?? existing.userDid,
        page: existing.page ?? args.page,
      });
      return { ok: true as const };
    }

    await ctx.db.insert("liveChats", {
      sessionId: args.sessionId,
      wallet: args.wallet,
      name: args.name,
      email: args.email,
      userDid: args.userDid,
      page: args.page,
      messages: [msg],
      messageCount: 1,
      startedAt: args.at,
      lastActivityAt: args.at,
    });
    return { ok: true as const };
  },
});

export type LiveChatDetail = Doc<"liveChats"> & AccountIdentity;

/* ── Admin-gated read side ──────────────────────────────────────────────────── */

const LIST_LIMIT = 300;

export const listData = internalQuery({
  args: {},
  handler: async (ctx): Promise<LiveChatRow[]> => {
    const rows = await ctx.db
      .query("liveChats")
      .withIndex("by_lastActivity_live")
      .order("desc")
      .take(LIST_LIMIT);
    const cache = new Map<string, Doc<"users"> | null>();
    const out: LiveChatRow[] = [];
    for (const s of rows) {
      const last = s.messages[s.messages.length - 1];
      const account = s.userDid || s.wallet
        ? await lookupAccount(ctx, { did: s.userDid, wallet: s.wallet }, cache)
        : {};
      out.push({
        sessionId: s.sessionId,
        wallet: s.wallet,
        name: s.name,
        email: s.email,
        page: s.page,
        ...account,
        messageCount: s.messageCount,
        startedAt: s.startedAt,
        lastActivityAt: s.lastActivityAt,
        lastMessagePreview: last ? last.content.slice(0, 120) : "",
      });
    }
    return out;
  },
});

export const getData = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }): Promise<LiveChatDetail | null> => {
    const chat = await ctx.db
      .query("liveChats")
      .withIndex("by_session_live", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!chat) return null;
    const account = chat.userDid || chat.wallet
      ? await lookupAccount(ctx, { did: chat.userDid, wallet: chat.wallet }, new Map())
      : {};
    return { ...chat, ...account };
  },
});

export const listForAdmin = action({
  args: { accessToken: v.string() },
  handler: async (ctx, { accessToken }): Promise<LiveChatRow[]> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runQuery(internal.liveChat.listData, {});
  },
});

export const getForAdmin = action({
  args: { accessToken: v.string(), sessionId: v.string() },
  handler: async (ctx, { accessToken, sessionId }): Promise<LiveChatDetail | null> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runQuery(internal.liveChat.getData, { sessionId });
  },
});
