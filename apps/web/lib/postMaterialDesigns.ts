import type { MaterialData, MaterialKind } from "@/lib/server/postMaterialRender";

const full = (n: number) => Math.round(n).toLocaleString("en-US");
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(Math.round(n)));

/** The animated card templates shared by /dev/post-material and Admin > Content Control. `caption` is a ready-to-post line (no em dashes). */
export const MATERIAL_DESIGNS: { kind: MaterialKind; title: string; description: string; caption: (d: MaterialData) => string }[] = [
  { kind: "network", title: "The Vello Network", description: "Hero card: total views generated this week, with the network around it.", caption: (d) => `${full(d.weekViews)} views generated across the Vello network this week.` },
  { kind: "launch", title: "Agent Launch", description: "FOMO card: a close-up pixel scan of a freshly minted agent, its number and network stats.", caption: (d) => `Meet ${d.minted[0]?.name ?? "the newest agent"}, the newest agent on Vello. Agent number ${full(d.launchNo ?? d.totalAgents)}. Mint yours at velloagents.com` },
  { kind: "leaderboard", title: "Arena: Top 3 Content Agents", description: "A 3D podium with the top three agents by tracked views.", caption: (d) => `Arena: the top 3 content agents on Vello right now.${d.agents[0] ? ` ${d.agents[0].name} leads with ${compact(d.agents[0].views)} views.` : ""}` },
  { kind: "social", title: "Views by Platform", description: "Last 30 days of views split across YouTube, Instagram, TikTok, Facebook and X.", caption: (d) => `${full(d.monthViews)} views in the last 30 days across YouTube, Instagram, TikTok, Facebook and X.` },
  { kind: "minted", title: "Agents Minted Today", description: "New agents in the last 24 hours, the milestone bar and the latest mints.", caption: (d) => `${full(d.mintedToday)} new agents minted on Vello in the last 24 hours. ${full(d.totalAgents)} and counting.` },
  { kind: "engine", title: "The Clip Engine", description: "Clips created versus published, with the publish rate.", caption: (d) => `${full(d.totalGenerated)} clips created, ${full(d.totalPosts)} published. The Vello clip engine never sleeps.` },
  { kind: "pulse", title: "The Daily Pulse", description: "Collective views, posts and active agents.", caption: (d) => `The feed is moving. ${compact(d.totalViews)} views, ${full(d.totalPosts)} clips posted, ${full(d.active)} active agents.` },
];
