import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import { rankAgents, summarize, type AgentStats } from "@/lib/tournament/rank";
import type { MaterialData, MaterialKind } from "./postMaterialRender";
import type { StatCaptionData } from "@/lib/marketingCaption";

const STATS = makeFunctionReference<"query">("tournament:agentStats");
const DAY = 86_400_000;
const PLATFORMS = ["youtube", "instagram", "tiktok", "facebook", "x"];
const ago = (ms: number) => { const h = Math.floor(ms / 3_600_000); return h < 1 ? `${Math.max(1, Math.floor(ms / 60_000))}m ago` : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`; };

/** Live network numbers for a statistics card, read straight from Convex (the same figures the admin templates show). Falls back to the "new agents" card when there are no views to brag about yet. */
export async function buildStatData(wantedKind: string): Promise<{ data: MaterialData; caption: StatCaptionData; kind: MaterialKind }> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Content Control backend is not configured");
  const convex = new ConvexHttpClient(url);
  const now = Date.now();
  const roster = (await convex.query(api.tournament.roster, {})).slice(0, 150);
  const stats = async (since: number) => {
    const rows = await Promise.all(roster.map(async (a) => [a.mintAddress, await convex.query(STATS, { mintAddress: a.mintAddress, since }).catch(() => undefined)] as const));
    const map = Object.fromEntries(rows) as Record<string, AgentStats | undefined>;
    const ranked = rankAgents(roster, map, "views");
    return { rows: ranked, totals: summarize(ranked) };
  };
  const [week, month] = await Promise.all([stats(now - 7 * DAY), stats(now - 30 * DAY)]);
  const fresh = [...roster].sort((a, b) => b.createdAt - a.createdAt);
  const platforms = PLATFORMS.map((id) => ({ id, views: month.rows.reduce((s, r) => s + (r.byPlatform?.[id] ?? 0), 0) }));
  const hasViews = week.totals.views > 0 || month.totals.views > 0;
  const kind = (["network", "leaderboard", "social", "engine"].includes(wantedKind) && !hasViews) || !["network", "leaderboard", "social", "engine", "minted"].includes(wantedKind) ? "minted" : wantedKind as MaterialKind;
  const top = (hasViews ? week.rows : month.rows).slice(0, 5);
  const data: MaterialData = {
    kind, period: "Last 7 days", date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(now)),
    agents: top.map((a) => ({ name: a.name, handle: a.handle, avatarUrl: a.avatarUrl, views: a.views, posted: a.posted, generated: a.generated })),
    totalViews: week.totals.views, totalPosts: week.totals.posted, totalGenerated: week.totals.generated, active: week.totals.active,
    weekViews: week.totals.views, weekPosts: week.totals.posted, weekActive: week.totals.active,
    totalAgents: fresh.length, mintedToday: fresh.filter((a) => a.createdAt >= now - DAY).length,
    minted: fresh.slice(0, 4).map((a) => ({ name: a.name, handle: a.handle, avatarUrl: a.avatarUrl, ago: ago(now - a.createdAt) })),
    monthViews: month.totals.views, platforms,
  };
  return {
    data, kind,
    caption: {
      weekViews: data.weekViews, weekPosts: data.weekPosts, weekActive: data.weekActive, monthViews: data.monthViews, totalAgents: data.totalAgents, mintedToday: data.mintedToday,
      totalPosts: data.totalPosts, totalGenerated: data.totalGenerated,
      agents: top.map((a) => ({ name: a.name, views: a.views })), platforms, minted: data.minted.map((m) => ({ name: m.name, handle: m.handle })),
    },
  };
}
