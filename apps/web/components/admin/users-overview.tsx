"use client";

import { useMemo } from "react";
import { fmtUsd, isOnline } from "./util";

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

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl bg-[#0f2a1e] p-5">
      <p className="text-[12px] font-medium text-emerald-200/60">{label}</p>
      <p className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-emerald-50">{value}</p>
      {note && <p className="mt-2 text-[12px] text-emerald-300/70">{note}</p>}
    </div>
  );
}

/** Flat, screenshot-ready summary of the user base: one big total, the growth curve, then the numbers that matter. */
export function UsersOverview({ rows, now }: { rows: OverviewRow[]; now: number }) {
  const s = useMemo(() => summarizeUsers(rows, now), [rows, now]);
  const peak = Math.max(1, ...s.daily.map((d) => d.count));
  const pct = (n: number) => (s.total ? `${Math.round((n / s.total) * 100)}% of users` : undefined);
  const trend = s.weekChange === null ? null : `${s.weekChange >= 0 ? "+" : ""}${s.weekChange}% vs last week`;

  return (
    <section aria-label="Users overview" className="mb-5 grid gap-3 lg:grid-cols-[1.35fr_1fr]">
      <div className="flex flex-col justify-between rounded-3xl bg-emerald-400 p-6 text-emerald-950 sm:p-7">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-emerald-950/70">Total users</p>
          <p className="mt-3 text-[clamp(3.5rem,9vw,6.5rem)] font-semibold leading-[0.9] tracking-[-0.05em] tabular-nums">{nf(s.total)}</p>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] font-medium">
            <span>+{nf(s.thisWeek)} this week</span>
            <span className="text-emerald-950/40">·</span>
            <span>+{nf(s.today)} today</span>
            {trend && <><span className="text-emerald-950/40">·</span><span>{trend}</span></>}
          </p>
        </div>
        <div className="mt-7">
          <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`New users per day, last ${DAYS} days`}>
            {s.daily.map((d) => (
              <span key={d.from} title={`${new Date(d.from).toLocaleDateString("en-US", { month: "short", day: "numeric" })}: ${d.count}`}
                className="flex-1 rounded-[2px] bg-emerald-950" style={{ height: `${Math.max(d.count ? 8 : 3, (d.count / peak) * 100)}%`, opacity: d.count ? 1 : 0.25 }} />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[11px] font-medium text-emerald-950/60"><span>{DAYS} days ago</span><span>New users per day · {nf(s.thisMonth)} this month</span><span>Today</span></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Tile label="Online now" value={nf(s.online)} note={`${nf(s.active24h)} active in 24h`} />
        <Tile label="Active this week" value={nf(s.active7d)} note={pct(s.active7d)} />
        <Tile label="Creators" value={nf(s.creators)} note={`${nf(s.agents)} influencers made`} />
        <Tile label="Wallets connected" value={nf(s.withWallet)} note={pct(s.withWallet)} />
        <Tile label="Clips produced" value={nf(s.clipsProduced)} note={`${nf(s.clipsPosted)} posted`} />
        <Tile label="Invested" value={fmtUsd(s.invested)} note={`${nf(s.investors)} investors`} />
      </div>
    </section>
  );
}
