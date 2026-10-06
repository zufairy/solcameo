"use client";

import { MAINNET_ONLY } from "@/lib/solstar/liveNetwork";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { MarketRow } from "./MarketTable";

/** Re-renders on an interval (single timer per consumer, cleaned up on unmount). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** characterId -> market row, for avatars/names. Undefined while loading. */
export function useCharacterMap(): Map<string, MarketRow> | undefined {
  const rows = useQuery(api.solstarMarket.listMarket, MAINNET_ONLY ? { sort: "new", network: "mainnet" } : { sort: "new" }) as MarketRow[] | undefined;
  return useMemo(() => (rows ? new Map(rows.map((r) => [r.characterId, r])) : undefined), [rows]);
}

export function CharAvatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-8 shrink-0", className)}>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className="bg-muted text-[11px] font-semibold">
        {name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

/** Catches Convex query failures; mirrors MarketErrorBoundary. */
export class PanelErrorBoundary extends Component<
  { children: ReactNode; message: string },
  { failed: boolean; attempt: number }
> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  retry = () => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }));
  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm font-medium">{this.props.message}</p>
          <button
            type="button"
            onClick={this.retry}
            className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Retry
          </button>
        </div>
      );
    }
    return <div key={this.state.attempt}>{this.props.children}</div>;
  }
}
