"use client";

import { useMemo } from "react";
import { fmtUsd, isOnline } from "./util";
import { Dot, LimeHero, LimeLayout, LimeTile } from "./lime-panels";

export type OverviewRow = {
  createdAt?: number; lastSeenAt?: number; walletAddress?: string; status: string; isAdmin: boolean;
  agentCount: number; investedUsdc: number; creditBalance: number; clipsProduced: number; clipsPosted: number;
};

const DAY = 86_400_000;
const DAYS = 30;
const nf = (n: number) => n.toLocaleString("en-US");

/** Every figure on the overview, derived from the user list so the page needs no extra query. */
export function summarizeUsers(rows: OverviewRow[], now: number) {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const since = (days: number) => now - days * DAY;
  const created = (from: number, to = now) => rows.filter((r) => (r.createdAt ?? 0) >= from && (r.createdAt ?? 0) < to).length;
  // One bucket per calendar day, oldest first, ending today.
  const daily = Array.from({ length: DAYS }, (_, i) => {
    const from = startOfToday - (DAYS - 1 - i) * DAY;
    return { from, count: created(from, from + DAY) };
  });
  const thisWeek = created(since(7));
  const lastWeek = created(since(14), since(7));
  return {
    total: rows.length,
    today: created(startOfToday),
    thisWeek,
    thisMonth: created(since(30)),
    weekChange: lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null,
    online: rows.filter((r) => isOnline(r.lastSeenAt, now)).length,
    active24h: rows.filter((r) => (r.lastSeenAt ?? 0) >= since(1)).length,
    active7d: rows.filter((r) => (r.lastSeenAt ?? 0) >= since(7)).length,
    withWallet: rows.filter((r) => !!r.walletAddress).length,
    creators: rows.filter((r) => r.agentCount > 0).length,
    agents: rows.reduce((s, r) => s + r.agentCount, 0),
    investors: rows.filter((r) => r.investedUsdc > 0).length,
    invested: rows.reduce((s, r) => s + r.investedUsdc, 0),
    credits: rows.reduce((s, r) => s + r.creditBalance, 0),
    clipsProduced: rows.reduce((s, r) => s + (r.clipsProduced ?? 0), 0),
    clipsPosted: rows.reduce((s, r) => s + (r.clipsPosted ?? 0), 0),
    suspended: rows.filter((r) => r.status === "suspended").length,
    admins: rows.filter((r) => r.isAdmin).length,
    daily,
  };
}

/** Flat, screenshot-ready summary of the user base: one big total, the growth curve, then the numbers that matter. */
export function UsersOverview({ rows, now }: { rows: OverviewRow[]; now: number }) {
  const s = useMemo(() => summarizeUsers(rows, now), [rows, now]);
  const pct = (n: number) => (s.total ? `${Math.round((n / s.total) * 100)}% of users` : undefined);
  const trend = s.weekChange === null ? null : `${s.weekChange >= 0 ? "+" : ""}${s.weekChange}% vs last week`;
  const bars = s.daily.map((d) => ({ key: d.from, label: new Date(d.from).toLocaleDateString("en-US", { month: "short", day: "numeric" }), count: d.count }));

  return (
    <LimeLayout label="Users overview" hero={
      <LimeHero label="Total users" value={nf(s.total)} bars={bars} barsCaption={`New users per day · ${nf(s.thisMonth)} this month`}
        line={<><span>+{nf(s.thisWeek)} this week</span><Dot /><span>+{nf(s.today)} today</span>{trend && <><Dot /><span>{trend}</span></>}</>} />
    }>
      <LimeTile label="Online now" value={nf(s.online)} note={`${nf(s.active24h)} active in 24h`} />
      <LimeTile label="Active this week" value={nf(s.active7d)} note={pct(s.active7d)} />
      <LimeTile label="Creators" value={nf(s.creators)} note={`${nf(s.agents)} influencers made`} />
      <LimeTile label="Wallets connected" value={nf(s.withWallet)} note={pct(s.withWallet)} />
      <LimeTile label="Clips produced" value={nf(s.clipsProduced)} note={`${nf(s.clipsPosted)} posted`} />
      <LimeTile label="Invested" value={fmtUsd(s.invested)} note={`${nf(s.investors)} investors`} />
    </LimeLayout>
  );
}
