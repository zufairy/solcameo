"use client";
import { useMemo, useState } from "react";
import { useQueries, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import { rankAgents, summarize, windowStart, type AgentStats, type WindowKey } from "@/lib/tournament/rank";
import type { MaterialData } from "@/lib/server/postMaterialRender";

const STATS = makeFunctionReference<"query">("tournament:agentStats");
const DAY = 24 * 60 * 60 * 1000;
export const PLATFORMS = ["youtube", "instagram", "tiktok", "facebook", "x"];
export function agoLabel(ms: number) {
  const h = Math.floor(ms / 3_600_000);
  return h < 1 ? `${Math.max(1, Math.floor(ms / 60_000))}m ago` : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
function useRosterQuery() { return useQuery(api.tournament.roster, {}); }
/** Roster ranked by views for one window — one small live subscription per agent. */
function useRanked(roster: ReturnType<typeof useRosterQuery>, since: number | null) {
  const queries = useMemo(() => { const q: Record<string, { query: typeof STATS; args: { mintAddress: string; since?: number } }> = {}; for (const a of roster ?? []) q[a.mintAddress] = { query: STATS, args: { mintAddress: a.mintAddress, ...(since === null ? {} : { since }) } }; return q; }, [roster, since]);
  const stats = useQueries(queries) as Record<string, AgentStats | undefined | Error>;
  const loaded = roster !== undefined && roster.every((a) => stats[a.mintAddress] !== undefined && !(stats[a.mintAddress] instanceof Error));
  const failed = roster !== undefined && roster.some((a) => stats[a.mintAddress] instanceof Error);
  const rows = useMemo(() => loaded && roster ? rankAgents(roster, stats as Record<string, AgentStats>, "views") : [], [loaded, roster, stats]);
  return { rows, loaded, failed, totals: useMemo(() => summarize(rows), [rows]) };
}

/** Live network data behind every post-material card, for the chosen window (the hero card is always 7 days, platforms 30). */
export function useMaterialData(window: WindowKey | "today") {
  const [now] = useState(() => Date.now());
  const since = useMemo(() => window === "today" ? now - DAY : windowStart(window, now), [window, now]);
  const roster = useRosterQuery();
  const sel = useRanked(roster, since);
  const week = useRanked(roster, now - 7 * DAY);
  const month = useRanked(roster, now - 30 * DAY);
  const { rows, totals } = sel;
  const loaded = sel.loaded && week.loaded && month.loaded, failed = sel.failed || week.failed || month.failed;
  const period = window === "today" ? "Today" : window === "7d" ? "Last 7 days" : window === "30d" ? "Last 30 days" : "All time";
  const date = useMemo(() => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date()), []);
  const base = useMemo(() => {
    const fresh = [...(roster ?? [])].sort((a, b) => b.createdAt - a.createdAt);
    return {
      period, date,
      agents: rows.slice(0, 5).map((a) => ({ name: a.name, handle: a.handle, avatarUrl: a.avatarUrl, views: a.views, posted: a.posted, generated: a.generated })),
      totalViews: totals.views, totalPosts: totals.posted, totalGenerated: totals.generated, active: totals.active,
      monthViews: month.totals.views,
      platforms: PLATFORMS.map((id) => ({ id, views: month.rows.reduce((s, r) => s + (r.byPlatform?.[id] ?? 0), 0) })),
      weekViews: week.totals.views, weekPosts: week.totals.posted, weekActive: week.totals.active,
      totalAgents: fresh.length, mintedToday: fresh.filter((a) => a.createdAt >= now - DAY).length,
      minted: fresh.slice(0, 4).map((a) => ({ name: a.name, handle: a.handle, avatarUrl: a.avatarUrl, ago: agoLabel(now - a.createdAt) })),
    } satisfies Omit<MaterialData, "kind">;
  }, [period, date, rows, totals, week.totals, month.rows, month.totals, roster, now]);
  return { base, rows, totals, week: week.totals, loaded, failed };
}
