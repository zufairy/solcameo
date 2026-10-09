"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import {
  ComposedChart, LineChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  Users, LogIn, UserPlus, CalendarDays, DollarSign, Activity, TrendingUp, Loader2, Film,
} from "lucide-react";

type Analytics = FunctionReturnType<typeof api.analytics.getAdminAnalytics>;

const RANGES = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
] as const;

// Chart series colors (inline hsl to match the app's other recharts usage).
const C_ACTIVE = "hsl(160 84% 45%)"; // emerald — Active users (DAU)
const C_LOGIN = "hsl(199 89% 55%)";  // sky — Daily logins
const C_NEW = "hsl(263 70% 65%)";    // violet — New signups

// Distinct line color per social platform for the "videos posted" chart.
const PLATFORM_COLORS: Record<string, string> = {
  tiktok: "#22d3ee",    // cyan
  instagram: "#ec4899", // pink
  youtube: "#ef4444",   // red
  facebook: "#3b82f6",  // blue
  linkedin: "#14b8a6",  // teal
  x: "#e5e7eb",         // white
  threads: "#f59e0b",   // amber
  other: "#a855f7",     // purple
};
const platformColor = (p: string) => PLATFORM_COLORS[p] ?? "#84cc16";
const platformLabel = (p: string) => (p === "x" ? "X" : p.charAt(0).toUpperCase() + p.slice(1));

function Kpi({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string; value: string; sub: string; accent?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-[#e4ff59] px-5 py-4 text-[#10140a]">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#10140a]/60">
        {icon}<span>{label}</span>
      </div>
      <p className="text-[26px] font-semibold tabular-nums leading-none tracking-tight">{value}</p>
      <p className="text-[11px] font-medium text-[#10140a]/60">{sub}</p>
    </div>
  );
}

const nf = (n: number) => n.toLocaleString("en-US");

export function AnalyticsSection() {
  const { accessToken } = useSupabaseAuth();
  const getAnalytics = useAction(api.analytics.getAdminAnalytics);
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let alive = true;
    setLoading(true);
    setError(null);
    getAnalytics({ accessToken, days })
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : "Failed to load"); setLoading(false); } });
    return () => { alive = false; };
  }, [accessToken, days, getAnalytics]);

  const s = data?.summary;

  return (
    <div className="space-y-6">
      {/* Header + range toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-bold text-white">Analytics</h1>
          <p className="text-[12px] text-zinc-600">
            Signed-in activity, bucketed by UTC day. Anonymous pageviews live in Google Analytics.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-[#1e1e24] bg-[#0d0d10] p-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={`px-3 h-7 rounded-lg text-[12px] font-semibold transition-colors ${
                days === r.days ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={<Users className="size-3" />} label="Active today" value={s ? nf(s.dauToday) : "…"} sub="DAU (signed-in)" accent="text-emerald-400" />
        <Kpi icon={<LogIn className="size-3" />} label="Logins today" value={s ? nf(s.loginsToday) : "…"} sub="auth events" accent="text-sky-400" />
        <Kpi icon={<UserPlus className="size-3" />} label="New today" value={s ? nf(s.newUsersToday) : "…"} sub="signups" accent="text-violet-400" />
        <Kpi icon={<CalendarDays className="size-3" />} label="WAU" value={s ? nf(s.wau) : "…"} sub="active last 7d" accent="text-white" />
        <Kpi icon={<DollarSign className="size-3" />} label="Cost today" value={s ? `$${s.costTodayUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "…"} sub="video generation spend" accent="text-amber-400" />
        <Kpi icon={<Film className="size-3" />} label="Videos today" value={s ? nf(s.videosGeneratedToday) : "…"} sub="generated (clips + renders)" accent="text-white" />
      </div>

      {/* Main chart */}
      <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-emerald-400" />
            <h2 className="text-[14px] font-bold text-white">Daily active users & logins</h2>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <Legendly color={C_ACTIVE} label="Active users" />
            <Legendly color={C_LOGIN} label="Logins" />
            <Legendly color={C_NEW} label="New signups" />
          </div>
        </div>

        {loading ? (
          <div className="h-[320px] flex items-center justify-center text-zinc-600">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="h-[320px] flex items-center justify-center text-[13px] text-rose-400">{error}</div>
        ) : data && data.series.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={data.series} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <defs>
                <linearGradient id="activeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C_ACTIVE} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={C_ACTIVE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 12%)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "hsl(0 0% 45%)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "hsl(0 0% 45%)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(0 0% 5%)",
                  border: "1px solid hsl(0 0% 14%)",
                  borderRadius: "10px",
                  fontSize: 12,
                }}
                labelStyle={{ color: "hsl(0 0% 70%)", marginBottom: 4 }}
                labelFormatter={(label, payload) => {
                  const p = payload?.[0]?.payload as Analytics["series"][number] | undefined;
                  return p?.date ?? String(label);
                }}
              />
              <Bar dataKey="newUsers" name="New signups" fill={C_NEW} fillOpacity={0.35} radius={[3, 3, 0, 0]} barSize={14} />
              <Line
                type="monotone"
                dataKey="activeUsers"
                name="Active users"
                stroke={C_ACTIVE}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="logins"
                name="Logins"
                stroke={C_LOGIN}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Legend wrapperStyle={{ display: "none" }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[320px] flex items-center justify-center text-[13px] text-zinc-600">
            No activity recorded yet. Data starts accumulating from the first sign-in after deploy.
          </div>
        )}

        {/* Secondary stats under the chart */}
        {s && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-[#16161a] pt-4">
            <MiniStat icon={<TrendingUp className="size-3.5 text-emerald-400" />} label="Avg DAU" value={nf(s.avgDau)} sub={`over ${data?.rangeDays ?? days}d`} />
            <MiniStat icon={<Activity className="size-3.5 text-emerald-300" />} label="Peak DAU" value={nf(s.peakDau)} sub={s.peakDauDate} />
            <MiniStat icon={<LogIn className="size-3.5 text-sky-400" />} label="Logins" value={nf(s.totalLoginsInRange)} sub={`over ${data?.rangeDays ?? days}d`} />
            <MiniStat icon={<UserPlus className="size-3.5 text-violet-400" />} label="New signups" value={nf(s.newUsersInRange)} sub={`over ${data?.rangeDays ?? days}d`} />
          </div>
        )}
      </div>

      {/* Videos posted by platform */}
      <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Film className="size-4 text-sky-400" />
            <h2 className="text-[14px] font-bold text-white">Videos posted by platform</h2>
            {data && (
              <span className="text-[12px] text-zinc-600">
                · <span className="font-mono font-bold text-white">{nf(data.totalVideosPosted)}</span> total over {data.rangeDays}d
              </span>
            )}
          </div>
          {data && data.platforms.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap text-[11px]">
              {data.platforms.map((p: string) => (
                <Legendly key={p} color={platformColor(p)} label={`${platformLabel(p)} (${nf(data.platformTotals[p] ?? 0)})`} />
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="h-[300px] flex items-center justify-center text-zinc-600">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="h-[300px] flex items-center justify-center text-[13px] text-rose-400">{error}</div>
        ) : data && data.totalVideosPosted > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.platformSeries} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 12%)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "hsl(0 0% 45%)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "hsl(0 0% 45%)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip
                contentStyle={{ background: "hsl(0 0% 5%)", border: "1px solid hsl(0 0% 14%)", borderRadius: "10px", fontSize: 12 }}
                labelStyle={{ color: "hsl(0 0% 70%)", marginBottom: 4 }}
                labelFormatter={(label, payload) => {
                  const p = payload?.[0]?.payload as Analytics["platformSeries"][number] | undefined;
                  return p?.date ?? String(label);
                }}
                formatter={(value: unknown, name: unknown) => [nf(Number(value)), platformLabel(String(name))]}
              />
              {data.platforms.map((p: string) => (
                <Line
                  key={p}
                  type="monotone"
                  dataKey={p}
                  name={p}
                  stroke={platformColor(p)}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
              <Legend wrapperStyle={{ display: "none" }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[300px] flex items-center justify-center text-[13px] text-zinc-600">
            No videos posted in this range yet.
          </div>
        )}
      </div>
    </div>
  );
}

function Legendly({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-zinc-500">
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function MiniStat({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string; value: string; sub: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-zinc-600">{icon}{label}</span>
      <span className="text-[16px] font-mono font-bold tabular-nums text-white leading-none">{value}</span>
      <span className="text-[10px] text-zinc-700">{sub}</span>
    </div>
  );
}
