"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EarningsPoint } from "@/lib/types";

interface EarningsChartProps {
  data: EarningsPoint[];
}

export function EarningsChart({ data }: EarningsChartProps) {
  const formatted = data.map((d) => ({
    month: new Date(d.date).toLocaleDateString("en", {
      month: "short",
      year: "2-digit",
    }),
    earnings: d.earnings,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={formatted}>
        <defs>
          <linearGradient id="earningsGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(263 70% 65%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(263 70% 65%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 14%)" />
        <XAxis
          dataKey="month"
          tick={{ fill: "hsl(0 0% 55%)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "hsl(0 0% 55%)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${v}`}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(0 0% 8%)",
            border: "1px solid hsl(0 0% 14%)",
            borderRadius: "8px",
            fontSize: 12,
          }}
          formatter={(value: unknown) => [`$${(value as number).toLocaleString()}`, "Earnings"]}
        />
        <Area
          type="monotone"
          dataKey="earnings"
          stroke="hsl(263 70% 65%)"
          strokeWidth={2}
          fill="url(#earningsGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
