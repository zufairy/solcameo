"use client";

import { useMemo } from "react";
import { fmtUsd } from "./util";
import { Dot, LimeHero, LimeLayout, LimeTile } from "./lime-panels";

export type OverviewClip = { postedAt: number | null; createdAt: number; views: number | null; cost: number; platform: string | null; agentName: string; mintAddress: string };

/** TEMPORARY: added to the headline total so the panel can be screenshotted with a realistic number. Set to 0 to remove. */
export const PREVIEW_BONUS = 3000;

const DAY = 86_400_000;
const DAYS = 30;
const nf = (n: number) => n.toLocaleString("en-US");
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K` : nf(n));

/** Every figure on the posted-videos overview, derived from the clips the page already loaded. */
export function summarizeClips(clips: OverviewClip[], now: number) {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const at = (c: OverviewClip) => c.postedAt ?? c.createdAt;
  const between = (from: number, to = Infinity) => clips.filter((c) => at(c) >= from && at(c) < to).length;
  const daily = Array.from({ length: DAYS }, (_, i) => {
    const from = startOfToday - (DAYS - 1 - i) * DAY;
    return { from, count: between(from, from + DAY) };
  });
  const views = clips.reduce((s, c) => s + (c.views ?? 0), 0);
  const cost = clips.reduce((s, c) => s + c.cost, 0);
  const platforms = new Map<string, number>();
  for (const c of clips) { const p = c.platform?.toLowerCase() ?? "unknown"; platforms.set(p, (platforms.get(p) ?? 0) + 1); }
  const topPlatform = [...platforms.entries()].sort((a, b) => b[1] - a[1])[0];
  const best = clips.reduce<OverviewClip | null>((b, c) => ((c.views ?? 0) > (b?.views ?? -1) ? c : b), null);
  return {
    generated: clips.length + PREVIEW_BONUS,
    today: between(startOfToday),
    thisWeek: between(now - 7 * DAY),
    thisMonth: between(now - 30 * DAY),
    views,
    avgViews: clips.length ? Math.round(views / clips.length) : 0,
    cost,
    avgCost: clips.length ? cost / clips.length : 0,
    agents: new Set(clips.map((c) => c.mintAddress)).size,
    topPlatform,
    best,
    daily,
  };
}

/** Flat lime summary of everything made and posted, for the top of the Posted Videos page. */
export function PostsOverview({ clips, now }: { clips: OverviewClip[]; now: number }) {
  const s = useMemo(() => summarizeClips(clips, now), [clips, now]);
  const bars = s.daily.map((d) => ({ key: d.from, label: new Date(d.from).toLocaleDateString("en-US", { month: "short", day: "numeric" }), count: d.count }));

  return (
    <LimeLayout label="Posted videos overview" hero={
      <LimeHero label="Videos generated" value={nf(s.generated)} bars={bars} barsCaption={`Posted per day · ${nf(s.thisMonth)} this month`}
        line={<><span>+{nf(s.today)} today</span><Dot /><span>+{nf(s.thisWeek)} this week</span>{PREVIEW_BONUS > 0 && <><Dot /><span>incl. {nf(PREVIEW_BONUS)} preview</span></>}</>} />
    }>
      <LimeTile label="Total views" value={compact(s.views)} note={`${compact(s.avgViews)} per video`} />
      <LimeTile label="Generation cost" value={fmtUsd(s.cost)} note={`${fmtUsd(s.avgCost)} per video`} />
      <LimeTile label="Posting agents" value={nf(s.agents)} note="influencers with posts" />
      <LimeTile label="Top platform" value={s.topPlatform ? s.topPlatform[0].replace(/^./, (c) => c.toUpperCase()) : "—"} note={s.topPlatform ? `${nf(s.topPlatform[1])} posts` : undefined} />
      <LimeTile label="Best video" value={s.best ? compact(s.best.views ?? 0) : "—"} note={s.best ? `${s.best.agentName} · views` : undefined} />
      <LimeTile label="Posted this week" value={nf(s.thisWeek)} note={`${nf(s.today)} today`} />
    </LimeLayout>
  );
}
