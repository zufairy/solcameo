import type { MaterialData } from "@/lib/server/postMaterialRender";

const kinds = new Set(["network", "minted", "leaderboard", "engine", "pulse", "social", "launch"]);
const safeAvatar = (value: unknown) => value === undefined || (typeof value === "string" && value.length <= 2048);
const safeCount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e12;

/** Shape/size guard for the card renderer's JSON body — shared by the dev lab and the admin Content Control route. */
export function validMaterial(d: MaterialData | undefined): d is MaterialData {
  return !!d && kinds.has(d.kind) && Array.isArray(d.agents) && d.agents.length <= 5 &&
    typeof d.period === "string" && d.period.length <= 24 && typeof d.date === "string" && d.date.length <= 30 &&
    safeCount(d.totalViews) && safeCount(d.totalPosts) && safeCount(d.totalGenerated) && safeCount(d.active) &&
    safeCount(d.monthViews) && Array.isArray(d.platforms) && d.platforms.length <= 8 && d.platforms.every((p) => typeof p.id === "string" && p.id.length <= 12 && safeCount(p.views)) &&
    (d.launchNo === undefined || safeCount(d.launchNo)) &&
    safeCount(d.weekViews) && safeCount(d.weekPosts) && safeCount(d.weekActive) && safeCount(d.totalAgents) && safeCount(d.mintedToday) &&
    Array.isArray(d.minted) && d.minted.length <= 4 && d.minted.every((m) => safeAvatar(m.avatarUrl) && typeof m.name === "string" && m.name.length <= 60 && typeof m.handle === "string" && m.handle.length <= 60 && typeof m.ago === "string" && m.ago.length <= 12 && (m.niche === undefined || (typeof m.niche === "string" && m.niche.length <= 60)) && (m.country === undefined || (typeof m.country === "string" && /^[A-Za-z]{2}$/.test(m.country)))) &&
    d.agents.every((a) => safeAvatar(a.avatarUrl) && typeof a.name === "string" && a.name.length <= 60 && typeof a.handle === "string" && a.handle.length <= 60 && safeCount(a.views) && safeCount(a.posted) && safeCount(a.generated)) &&
    (d.kind !== "launch" || d.minted.length > 0);
}
