/**
 * Live "stats sheet" for the control-panel agent chat — REAL numbers from the
 * database (views, virality scores, posting, earnings, credits, recent clip
 * runs) rendered as compact prompt lines, so the agent answers "how many views
 * did we get?" / "show the virality scores" with actual data instead of
 * "I don't have that information".
 */

export interface StatVideo {
  title: string;
  caption?: string;
  createdAt: number;
  state: string;            // posted | scheduled | generated
  viewCount: number | null;
  viralScore?: number;
  platform?: string;
  postUrl?: string | null;
}

export interface StatExtras {
  lifetimeEarningsUsdc?: number;
  monthlyEarningsUsdc?: number;
  creditsBalance?: number | null;
  connectedPlatforms?: string[];
  /** Most recent clip runs, newest first. */
  recentJobs?: Array<{ status: string; createdAt: number; error?: string }>;
  now?: number;
}

const DAY = 86_400_000;
const n = (x: number) => x.toLocaleString("en-US");
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const label = (v: StatVideo) => `"${(v.title || v.caption || "Untitled").replace(/\s+/g, " ").slice(0, 60)}"`;

export function buildAgentStatsLines(videos: StatVideo[], extra: StatExtras = {}): string[] {
  const now = extra.now ?? Date.now();
  const posted = videos.filter((v) => v.state === "posted");
  const scheduled = videos.filter((v) => v.state === "scheduled");
  const ready = videos.filter((v) => v.state === "generated");
  const withViews = videos.filter((v) => typeof v.viewCount === "number");
  const totalViews = withViews.reduce((s, v) => s + (v.viewCount ?? 0), 0);
  const scored = videos.filter((v) => typeof v.viralScore === "number");
  const avgScore = scored.length ? Math.round(scored.reduce((s, v) => s + (v.viralScore ?? 0), 0) / scored.length) : null;

  const lines: string[] = [];
  lines.push(`- Videos: ${n(videos.length)} total · ${n(posted.length)} posted · ${n(scheduled.length)} scheduled to post · ${n(ready.length)} made but not posted yet.`);
  lines.push(`- TOTAL VIEWS across all posted videos: ${n(totalViews)}${withViews.length < posted.length ? ` (view counts synced for ${withViews.length} of ${posted.length} posted videos; the rest haven't been measured yet)` : ""}.`);

  const byPlatform = new Map<string, { views: number; posts: number }>();
  for (const v of posted) {
    const p = v.platform || "unknown";
    const cur = byPlatform.get(p) ?? { views: 0, posts: 0 };
    byPlatform.set(p, { views: cur.views + (v.viewCount ?? 0), posts: cur.posts + 1 });
  }
  if (byPlatform.size) {
    lines.push(`- Views by platform: ${[...byPlatform.entries()].sort((a, b) => b[1].views - a[1].views).map(([p, s]) => `${p} ${n(s.views)} (${s.posts} posts)`).join(" · ")}.`);
  }

  const week = posted.filter((v) => now - v.createdAt < 7 * DAY);
  lines.push(`- Last 7 days: ${week.length} posted, ${n(week.reduce((s, v) => s + (v.viewCount ?? 0), 0))} views on those.`);

  if (scored.length) {
    lines.push(`- VIRALITY SCORE (Vello AI's 0-100 prediction per clip): average ${avgScore}/100 across ${scored.length} scored clips.`);
    const topScore = [...scored].sort((a, b) => (b.viralScore ?? 0) - (a.viralScore ?? 0)).slice(0, 5);
    lines.push(`- Highest virality scores: ${topScore.map((v) => `${label(v)} ${v.viralScore}/100${typeof v.viewCount === "number" ? `, ${n(v.viewCount)} views` : ""}`).join("; ")}.`);
  } else {
    lines.push("- VIRALITY SCORE: none yet — scores are computed for clips (AI Clipper videos); original videos don't get one.");
  }

  const topViews = [...withViews].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0)).slice(0, 5);
  if (topViews.length) {
    lines.push(`- Most viewed: ${topViews.map((v) => `${label(v)} ${n(v.viewCount ?? 0)} views${v.platform ? ` on ${v.platform}` : ""}${typeof v.viralScore === "number" ? `, score ${v.viralScore}` : ""}`).join("; ")}.`);
  }

  const latest = [...videos].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  if (latest.length) {
    lines.push("- Latest videos (newest first):");
    for (const v of latest) {
      lines.push(`  · ${day(v.createdAt)} ${label(v)} — ${v.state}${v.platform ? ` on ${v.platform}` : ""}${typeof v.viewCount === "number" ? `, ${n(v.viewCount)} views` : ""}${typeof v.viralScore === "number" ? `, virality ${v.viralScore}/100` : ""}`);
    }
  }

  if (typeof extra.lifetimeEarningsUsdc === "number" || typeof extra.monthlyEarningsUsdc === "number") {
    lines.push(`- Earnings: $${(extra.lifetimeEarningsUsdc ?? 0).toFixed(2)} lifetime · $${(extra.monthlyEarningsUsdc ?? 0).toFixed(2)} this month.`);
  }
  if (typeof extra.creditsBalance === "number") {
    lines.push(`- Credits balance (pays for making videos/clips): ${n(extra.creditsBalance)} credits.`);
  }
  if (extra.connectedPlatforms) {
    lines.push(`- Connected accounts: ${extra.connectedPlatforms.length ? extra.connectedPlatforms.join(", ") : "none"}.`);
  }
  const jobs = (extra.recentJobs ?? []).slice(0, 5);
  if (jobs.length) {
    lines.push(`- Recent clip runs: ${jobs.map((j) => `${day(j.createdAt)} ${j.status}${j.status === "error" && j.error ? ` (${j.error.replace(/\s+/g, " ").slice(0, 90)})` : ""}`).join("; ")}.`);
  }
  return lines;
}
