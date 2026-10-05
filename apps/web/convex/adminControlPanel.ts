import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { resolveAdmin } from "./admin";
import type { ControlTeam, ControlThread } from "./controlPanel";

/** Admin read-only surface over the /control panel's per-account chat history
 *  (controlThreads/controlTeams) — lets an admin see who's talking to their
 *  agents and open the actual transcript, without touching the write path. */

export type ControlConversationUserRow = {
  userId: string;
  accountName?: string;
  accountEmail?: string;
  walletAddress?: string;
  threadCount: number;
  teamCount: number;
  totalMessages: number;
  lastActivityAt: number;
};

const LIST_LIMIT = 5000;

export const listControlConversationUsersData = internalQuery({
  args: {},
  handler: async (ctx): Promise<ControlConversationUserRow[]> => {
    const threads = await ctx.db.query("controlThreads").take(LIST_LIMIT);
    const byUser = new Map<string, { threadCount: number; totalMessages: number; lastActivityAt: number }>();
    for (const t of threads) {
      const key = t.userId;
      const cur = byUser.get(key) ?? { threadCount: 0, totalMessages: 0, lastActivityAt: 0 };
      cur.threadCount += 1;
      cur.totalMessages += t.messages.length;
      cur.lastActivityAt = Math.max(cur.lastActivityAt, t.updatedAt);
      byUser.set(key, cur);
    }
    const teams = await ctx.db.query("controlTeams").take(LIST_LIMIT);
    const teamCountByUser = new Map<string, number>();
    for (const t of teams) teamCountByUser.set(t.userId, (teamCountByUser.get(t.userId) ?? 0) + 1);

    const rows: ControlConversationUserRow[] = [];
    for (const [userId, agg] of byUser) {
      const user: Doc<"users"> | null = await ctx.db.get(userId as Doc<"users">["_id"]);
      rows.push({
        userId,
        accountName: user?.name,
        accountEmail: user?.email,
        walletAddress: user?.walletAddress,
        threadCount: agg.threadCount,
        teamCount: teamCountByUser.get(userId) ?? 0,
        totalMessages: agg.totalMessages,
        lastActivityAt: agg.lastActivityAt,
      });
    }
    rows.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    return rows;
  },
});

export type ControlConversationThreadRow = ControlThread & {
  /** Human label for the thread's `key` — the agent's display name when the
   *  key is a mint address, or the team's name when it's `team:<teamId>`. */
  label: string;
};

export const getControlConversationDetailData = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{
    user: { accountName?: string; accountEmail?: string; walletAddress?: string } | null;
    teams: ControlTeam[];
    threads: ControlConversationThreadRow[];
  }> => {
    const { teams, threads }: { teams: ControlTeam[]; threads: ControlThread[] } =
      await ctx.runQuery(internal.controlPanel.loadAll, { userId });
    const teamNameByTeamId = new Map(teams.map((t) => [t.teamId, t.name]));

    const labeled: ControlConversationThreadRow[] = [];
    for (const thread of threads) {
      let label = thread.key;
      if (thread.key.startsWith("team:")) {
        label = teamNameByTeamId.get(thread.key.slice("team:".length)) ?? "Team";
      } else {
        const agent = await ctx.db
          .query("influencers")
          .withIndex("by_mint", (q) => q.eq("mintAddress", thread.key))
          .first();
        if (agent) label = agent.name;
      }
      labeled.push({ ...thread, label });
    }
    labeled.sort((a, b) => b.updatedAt - a.updatedAt);

    const user = await ctx.db.get(userId);
    return {
      user: user ? { accountName: user.name, accountEmail: user.email, walletAddress: user.walletAddress } : null,
      teams,
      threads: labeled,
    };
  },
});

/* ── Admin-gated public wrappers ────────────────────────────────────────── */

export const listControlConversationUsers = action({
  args: { accessToken: v.string() },
  handler: async (ctx, { accessToken }): Promise<ControlConversationUserRow[]> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runQuery(internal.adminControlPanel.listControlConversationUsersData, {});
  },
});

export const getControlConversationDetail = action({
  args: { accessToken: v.string(), userId: v.id("users") },
  handler: async (ctx, { accessToken, userId }): Promise<{
    user: { accountName?: string; accountEmail?: string; walletAddress?: string } | null;
    teams: ControlTeam[];
    threads: ControlConversationThreadRow[];
  }> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runQuery(internal.adminControlPanel.getControlConversationDetailData, { userId });
  },
});
