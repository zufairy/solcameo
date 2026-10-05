"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronUp, ChevronDown, TrendingUp, Plus } from "lucide-react";
import type { AIInfluencer } from "@/lib/types";

type SortKey = "tvl" | "sharePrice" | "apr" | "monthlyEarnings" | "availableShares";
type SortDir = "asc" | "desc";

interface InfluencerTableProps {
  influencers: AIInfluencer[];
}

export function InfluencerTable({ influencers }: InfluencerTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("tvl");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...influencers].sort((a, b) => {
    let aVal: number;
    let bVal: number;
    if (sortKey === "apr") {
      aVal = a.tvl > 0 ? (a.monthlyEarnings * 12) / a.tvl : 0;
      bVal = b.tvl > 0 ? (b.monthlyEarnings * 12) / b.tvl : 0;
    } else if (sortKey === "availableShares") {
      aVal = a.totalShares > 0 ? a.availableShares / a.totalShares : 0;
      bVal = b.totalShares > 0 ? b.availableShares / b.totalShares : 0;
    } else {
      aVal = a[sortKey];
      bVal = b[sortKey];
    }
    return sortDir === "desc" ? bVal - aVal : aVal - bVal;
  });

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col)
      return <ChevronDown className="size-3 text-muted-foreground/30 ml-1" />;
    return sortDir === "desc" ? (
      <ChevronDown className="size-3 text-emerald-400 ml-1" />
    ) : (
      <ChevronUp className="size-3 text-emerald-400 ml-1" />
    );
  }

  function SortableHead({
    col,
    children,
    className,
  }: {
    col: SortKey;
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <TableHead
        className={`cursor-pointer select-none whitespace-nowrap hover:text-foreground transition-colors ${className ?? ""}`}
        onClick={() => handleSort(col)}
      >
        <div className="flex items-center">
          {children}
          <SortIcon col={col} />
        </div>
      </TableHead>
    );
  }

  if (influencers.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/20 py-24 text-center space-y-3">
        <p className="text-muted-foreground text-sm font-medium">
          No AI Agents in the market yet.
        </p>
        <p className="text-xs text-muted-foreground/60 max-w-xs mx-auto">
          Launch your first AI Influencer from the Studio or use the Agent Builder.
        </p>
        <div className="flex justify-center gap-2 pt-2">
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" render={<Link href="/studio/build" />}>
            <Plus className="size-3.5 mr-1" />
            Launch Agent
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card/20">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="pl-5 text-muted-foreground font-medium">
              Agent
            </TableHead>
            <TableHead className="text-muted-foreground font-medium">
              Niche
            </TableHead>
            <SortableHead col="tvl" className="text-muted-foreground font-medium">
              TVL
            </SortableHead>
            <SortableHead
              col="sharePrice"
              className="text-muted-foreground font-medium"
            >
              Price / Share
            </SortableHead>
            <SortableHead col="apr" className="text-muted-foreground font-medium">
              APR
            </SortableHead>
            <SortableHead
              col="monthlyEarnings"
              className="text-muted-foreground font-medium"
            >
              Monthly Yield
            </SortableHead>
            <SortableHead
              col="availableShares"
              className="text-muted-foreground font-medium"
            >
              Shares Left
            </SortableHead>
            <TableHead className="text-right pr-5 text-muted-foreground font-medium">
              Action
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((inf) => {
            const apr =
              inf.tvl > 0
                ? ((inf.monthlyEarnings * 12) / inf.tvl) * 100
                : 0;
            const soldPct =
              inf.totalShares > 0
                ? ((inf.totalShares - inf.availableShares) / inf.totalShares) *
                  100
                : 0;

            return (
              <TableRow
                key={inf.id}
                className="border-border/50 hover:bg-muted/20 transition-colors"
              >
                <TableCell className="pl-5 py-3.5">
                  <Link
                    href={`/market/${inf.id}`}
                    className="flex items-center gap-3"
                  >
                    <Avatar className="size-9 border border-border shrink-0">
                      <AvatarImage src={inf.avatarUrl} alt={inf.name} />
                      <AvatarFallback className="text-xs bg-muted text-muted-foreground">
                        {inf.name[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-sm leading-tight hover:text-emerald-400 transition-colors">
                        {inf.name}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {inf.handle}
                      </p>
                    </div>
                  </Link>
                </TableCell>

                <TableCell>
                  <Badge
                    variant="secondary"
                    className="capitalize text-xs font-normal"
                  >
                    {inf.niche}
                  </Badge>
                </TableCell>

                <TableCell>
                  <span className="font-mono text-sm font-semibold">
                    {inf.tvl > 0 ? `$${inf.tvl.toLocaleString()}` : "—"}
                  </span>
                </TableCell>

                <TableCell>
                  <span className="font-mono text-sm">
                    ${inf.sharePrice.toFixed(2)}
                  </span>
                </TableCell>

                <TableCell>
                  {apr > 0 ? (
                    <span className="font-mono text-sm font-bold text-emerald-400 flex items-center gap-1">
                      <TrendingUp className="size-3" />
                      {apr.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </TableCell>

                <TableCell>
                  <span className="font-mono text-sm text-emerald-400">
                    {inf.monthlyEarnings > 0
                      ? `$${inf.monthlyEarnings.toLocaleString()}`
                      : "—"}
                  </span>
                </TableCell>

                <TableCell>
                  <div className="flex flex-col gap-1.5 min-w-[90px]">
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground font-mono">
                        {inf.availableShares.toLocaleString()}
                      </span>
                      <span className="text-xs text-muted-foreground/50 font-mono">
                        / {inf.totalShares.toLocaleString()}
                      </span>
                    </div>
                    <Progress
                      value={soldPct}
                      className="h-1 bg-muted [&>div]:bg-emerald-500"
                    />
                  </div>
                </TableCell>

                <TableCell className="text-right pr-5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-500/10 text-emerald-400 hover:text-emerald-300 text-xs h-7"
                    render={<Link href={`/market/${inf.id}`} />}
                  >
                    Invest →
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
