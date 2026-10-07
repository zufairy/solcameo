"use client";

import { MAINNET_ONLY } from "@/lib/solstar/liveNetwork";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactSol, formatPct, formatSol } from "@/lib/solstar/format";
import { CharAvatar, PanelErrorBoundary } from "./feedShared";
import type { MarketRow } from "./MarketTable";
import { marketPath } from "@/lib/solstar/marketSlug";

const TOP = 10;

function hasVolume(rows: MarketRow[]): boolean {
  return rows.some((r) => /^\d+$/.test(r.volume24hLamports) && BigInt(r.volume24hLamports) > 0n);
}

function changeTone(bps: string): string {
  if (/^\d+$/.test(bps) && BigInt(bps) > 0n) return "text-emerald-400";
  if (/^-\d+$/.test(bps) && BigInt(bps) < 0n) return "text-red-400";
  return "text-muted-foreground";
}

function TrendingList() {
  // Volume ranking first; if nothing has traded yet, fall back to newest. Both subscriptions are cheap
  // and the "new" one is also what the feed/ticker share.
  const byVolume = useQuery(api.solstarMarket.listMarket, MAINNET_ONLY ? { sort: "volume", network: "mainnet" } : { sort: "volume" }) as MarketRow[] | undefined;
  const byNew = useQuery(api.solstarMarket.listMarket, MAINNET_ONLY ? { sort: "new", network: "mainnet" } : { sort: "new" }) as MarketRow[] | undefined;
  const loading = byVolume === undefined || byNew === undefined;
  const rows = loading ? [] : (hasVolume(byVolume) ? byVolume : byNew).slice(0, TOP);

  return (
    <>
      <p role="status" className="sr-only">
        {loading ? "Loading trending characters" : `${rows.length} trending characters`}
      </p>
      {loading ? (
        <div className="space-y-3 p-4" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No characters yet.</p>
      ) : (
        <ol className="py-2">
          {rows.map((r) => (
            <li key={r.characterId}>
              <Link
                href={marketPath(r)}
                className="flex items-center gap-3 px-6 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <CharAvatar name={r.name} src={r.imageUrl} className="size-11 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{r.name}</p>
                  <p className="mt-1 truncate text-xs text-zinc-500">${r.ticker} <span className="ml-2 font-mono">{formatSol(r.priceLamports, 9)} SOL</span></p>
                </div>
                <div className="shrink-0 text-right font-mono text-xs tabular-nums">
                  <p className="text-[15px] font-semibold text-zinc-200">{formatCompactSol(r.marketCapLamports)} SOL</p>
                  <p className={`mt-1 ${changeTone(r.changeBps)}`}>{formatPct(r.changeBps)}</p>
                </div>

              </Link>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export function TrendingPanel() {
  return (
    <div className="max-h-[calc(100dvh-240px)] overflow-y-auto">
      <PanelErrorBoundary message="Trending is unavailable right now.">
        <TrendingList />
      </PanelErrorBoundary>
    </div>
  );
}
