import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { resolveAdmin } from "./admin";
import { lookupAccount, type AccountIdentity } from "./lib/accountLookup";

/** A session with no activity for this long (and no mint) reads "abandoned". */
export const ABANDONED_AFTER_MS = 48 * 60 * 60 * 1000;

export type BuilderSessionStatus = "minted" | "draft" | "abandoned";

export type BuilderSessionRow = {
  sessionId: string;
  wallet: string;
  /** Vello account that owns the wallet — who started the conversation. */
  accountName?: string;
  accountEmail?: string;
  agentType?: string;
  projectName?: string;
  draftName?: string;
  messageCount: number;
  startedAt: number;
  lastActivityAt: number;
  lastMessagePreview: string;
  status: BuilderSessionStatus;
};

export type BuilderSessionDetail = {
  session: Doc<"builderSessions">;
  draft: Doc<"nftDrafts"> | null;
  status: BuilderSessionStatus;
  account: AccountIdentity;
};

function deriveStatus(
  session: { mintAddress?: string; lastActivityAt: number },
  draft: { mintStatus: string } | null,
  now: number,
): BuilderSessionStatus {
  if (session.mintAddress || draft?.mintStatus === "minted") return "minted";
  if (now - session.lastActivityAt > ABANDONED_AFTER_MS) return "abandoned";
  return "draft";
}

// Hard display cap — the admin list shows the latest 300 sessions. The UI
// labels the list "latest 300" so the cap is never silent.
const LIST_LIMIT = 300;

export const listBuilderSessionsData = internalQuery({
  args: { filter: v.union(v.literal("all"), v.literal("minted"), v.literal("not_minted")) },
  handler: async (ctx, { filter }): Promise<BuilderSessionRow[]> => {
    const sessions = await ctx.db
      .query("builderSessions")
      .withIndex("by_lastActivity")
      .order("desc")
      .take(LIST_LIMIT);
    const now = Date.now();
    const rows: BuilderSessionRow[] = [];
    const cache = new Map<string, Doc<"users"> | null>();
    for (const s of sessions) {
      const draft = await ctx.db
        .query("nftDrafts")
        .withIndex("by_session", (q) => q.eq("sessionId", s.sessionId))
        .first();
      const status = deriveStatus(s, draft, now);
      if (filter === "minted" && status !== "minted") continue;
      if (filter === "not_minted" && status === "minted") continue;
      const last = s.messages[s.messages.length - 1];
      const account = await lookupAccount(ctx, { wallet: s.wallet }, cache);
      rows.push({
        sessionId: s.sessionId,
        wallet: s.wallet,
        ...account,
        agentType: s.agentType,
        projectName: s.projectName,
        draftName: draft?.name,
        messageCount: s.messageCount,
        startedAt: s.startedAt,
        lastActivityAt: s.lastActivityAt,
        lastMessagePreview: last ? last.content.slice(0, 120) : "",
        status,
      });
    }
    return rows;
  },
});

export const getBuilderSessionData = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }): Promise<BuilderSessionDetail | null> => {
    const session = await ctx.db
      .query("builderSessions")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!session) return null;
    const draft = await ctx.db
      .query("nftDrafts")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
    const account = await lookupAccount(ctx, { wallet: session.wallet }, new Map());
    return { session, draft, status: deriveStatus(session, draft, Date.now()), account };
  },
});

/* ── Admin-gated public wrappers ────────────────────────────────────────── */

export const listBuilderSessions = action({
  args: {
    accessToken: v.string(),
    filter: v.union(v.literal("all"), v.literal("minted"), v.literal("not_minted")),
  },
  handler: async (ctx, { accessToken, filter }): Promise<BuilderSessionRow[]> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runQuery(internal.adminBuilder.listBuilderSessionsData, { filter });
  },
});

export const getBuilderSession = action({
  args: { accessToken: v.string(), sessionId: v.string() },
  handler: async (ctx, { accessToken, sessionId }): Promise<BuilderSessionDetail | null> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runQuery(internal.adminBuilder.getBuilderSessionData, { sessionId });
  },
});
