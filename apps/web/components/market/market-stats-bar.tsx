"use client";

import { TrendingUp, Users, DollarSign, Activity } from "lucide-react";

interface MarketStatsBarProps {
  totalTvl: number;
  totalAgents: number;
  totalEarnings: number;
}

export function MarketStatsBar({ totalTvl, totalAgents, totalEarnings }: MarketStatsBarProps) {
  const apr = totalTvl > 0 ? ((totalEarnings * 12) / totalTvl) * 100 : 0;

  const stats = [
    {
      icon: DollarSign,
      label: "Total TVL",
      value: totalTvl > 0 ? `$${totalTvl.toLocaleString()}` : "$0",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      icon: Users,
      label: "AI Agents",
      value: totalAgents.toString(),
      color: "text-green-400",
      bg: "bg-green-500/10",
    },
    {
      icon: TrendingUp,
      label: "Protocol APR",
      value: apr > 0 ? `${apr.toFixed(1)}%` : "—",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      icon: Activity,
      label: "Monthly Yield",
      value: totalEarnings > 0 ? `$${totalEarnings.toLocaleString()}` : "$0",
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map(({ icon: Icon, label, value, color, bg }) => (
        <div
          key={label}
          className="rounded-xl border border-border bg-card/40 px-4 py-3.5 flex items-center gap-3 hover:border-border/80 transition-colors"
        >
          <div className={`rounded-lg ${bg} p-2 shrink-0`}>
            <Icon className={`size-4 ${color}`} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`font-mono font-bold text-sm mt-0.5 ${color}`}>{value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
