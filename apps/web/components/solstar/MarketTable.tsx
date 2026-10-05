"use client";
import { getNetwork } from "@/lib/solana/network";
/* eslint-disable @next/next/no-img-element -- remote character portraits */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { useQuery, useConvexConnectionState } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  ArrowDownUp,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  Clock3,
  GraduationCap,
  Filter,
  Grid2X2,
  List,
  Search,
  ArrowDownRight,
  TrendingUp,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/error/error-boundary";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { formatUsdEstimate } from "@/lib/solstar/usdc";
import { useMarketWatchlist } from "./market-watchlist";
export type MarketRow = FunctionReturnType<
  typeof api.solstarMarket.listMarket
>[number];
type Sort = "new" | "volume" | "mcap" | "change";
export function MarketSparkline({ values = [] }: { values?: number[] }) {
  if (values.length < 2)
    return <span className="text-xs text-zinc-600">Awaiting snapshots</span>;
  const lo = Math.min(...values),
    hi = Math.max(...values),
    range = hi - lo || 1;
  const points = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * 88},${30 - ((v - lo) / range) * 26}`,
    )
    .join(" ");
  const color = values.at(-1)! >= values[0] ? "#5de39a" : "#f87171";
  return (
    <svg
      viewBox="0 0 88 36"
      width="88"
      height="36"
      aria-label="Recorded trade price history"
    >
      <polygon points={`0,36 ${points} 88,36`} fill={color} opacity=".12" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}
export function ChangePill({ value }: { value: number | null | undefined }) {
  return value == null ? (
    <span className="text-zinc-600">—</span>
  ) : (
    <span
      className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${value > 0 ? "bg-emerald-400/10 text-emerald-400" : value < 0 ? "bg-red-400/10 text-red-400" : "bg-white/5 text-zinc-500"}`}
    >
      {value > 0 ? "↑ " : value < 0 ? "↓ " : ""}
      {Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}%
    </span>
  );
}
export function SolstarMarket() {
  return (
    <ErrorBoundary
      fallback={
        <p className="p-8 text-zinc-400">
          Market data is unavailable. Refresh to reconnect.
        </p>
      }
    >
      <Market />
    </ErrorBoundary>
  );
}
function Market() {
  const solUsd = useSolUsd();
  const formatMarketUsd = (lamports: string) => formatUsdEstimate(lamports, solUsd);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<Sort>("mcap");
  const [category, setCategory] = useState("");
  const [graduatedOnly, setGraduatedOnly] = useState(false);
  const [pools, setPools] = useState<
    Record<
      string,
      {
        available: boolean;
        capSol: number | null;
        progress: number;
        migrated: boolean;
        appVolume24hLamports?: string;
        appTrades24h?: number;
        changeSinceLaunchPct?: number;
        points?: Array<{time:number;price:number;volume:number}>;
      }
    >
  >({});
  const [watchOnly, setWatchOnly] = useState(false);
  const [grid, setGrid] = useState(true);
  const [filters, setFilters] = useState(false);
  const [minVideos, setMinVideos] = useState(false);
  const [now, setNow] = useState(0);
  const watch = useMarketWatchlist();
  const connection = useConvexConnectionState();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 60000);
    return () => clearInterval(timer);
  }, []);
  const rows = useQuery(api.solstarMarket.listMarket, { sort, search: debounced || undefined, network: getNetwork()==="mainnet-beta"?"mainnet":"devnet", liveOnly: true });
  useEffect(() => {
    const controller = new AbortController();
    const live = rows?.filter((r) => r.dbcPool) ?? [];
    if (!live.length) return;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || controller.signal.aborted) return;
      refreshing = true;
      try {
        for (
          let offset = 0;
          offset < live.length && !controller.signal.aborted;
          offset += 4
        ) {
          await Promise.allSettled(
            live.slice(offset, offset + 4).map(async (r) => {
              try {
                const res = await fetch(
                  `/api/meteora/pool?characterId=${r.characterId}`,
                  { signal: controller.signal },
                );
                const data = await res.json();
                if (!controller.signal.aborted)
                  setPools(p => {
                    const points = new Map([...(p[r.characterId]?.points ?? []), ...(data.points ?? [])].map(point => [point.time, point]));
                    return { ...p, [r.characterId]: { ...data, points: [...points.values()].sort((a,b) => a.time-b.time).slice(-1000) } };
                  });
              } catch {
                /* Keep confirmed state through transient failures. */
              }
            }),
          );
        }
      } finally {
        refreshing = false;
      }
    };
    window.addEventListener("solcameo:trade-confirmed", refresh);
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      controller.abort();
      window.removeEventListener("solcameo:trade-confirmed", refresh);
      clearInterval(timer);
    };
  }, [rows]);
  const categories = useMemo(
    () => [...new Set(rows?.map((r) => r.category).filter(Boolean))].sort(),
    [rows],
  );
  const visible = rows?.filter(
    (r) =>
      (!graduatedOnly ||
        ["graduated", "migrated"].includes(r.state) ||
        pools[r.characterId]?.migrated) &&
      (!category || r.category === category) &&
      (!watchOnly || watch.ids.includes(r.characterId)) &&
      (!minVideos || r.videosPosted > 0),
  );
  visible?.sort((a,b) => sort === "new" ? b.createdAt-a.createdAt : sort === "volume" ? Number(pools[b.characterId]?.appVolume24hLamports ?? 0)-Number(pools[a.characterId]?.appVolume24hLamports ?? 0) : sort === "change" ? (pools[b.characterId]?.changeSinceLaunchPct ?? 0)-(pools[a.characterId]?.changeSinceLaunchPct ?? 0) : (pools[b.characterId]?.capSol ?? 0)-(pools[a.characterId]?.capSol ?? 0));
  const tabs = [
    { label: "All coins", sort: "mcap", Icon: ArrowDownUp },
    { label: "Trending", sort: "change", Icon: TrendingUp },
    { label: "New launches", sort: "new", Icon: Clock3 },
    { label: "24h volume", sort: "volume", Icon: ArrowDownUp },
  ] as const;
  const age = (created: number) => {
    const minutes = Math.max(0, Math.floor((now - created) / 60000));
    return !now
      ? "—"
      : minutes < 60
        ? `${minutes}m`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)}h`
          : `${Math.floor(minutes / 1440)}d`;
  };
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#141618] px-4 py-4 text-zinc-200 lg:px-10">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 top-40 size-[520px] rounded-full bg-[#d7ff00]/[0.06] blur-[130px]" />
        <div className="absolute right-0 top-[420px] size-[560px] rounded-full bg-[#7C4DFF]/[0.10] blur-[140px]" />
        <div className="absolute bottom-0 left-1/3 size-[480px] rounded-full bg-teal-400/[0.06] blur-[130px]" />
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((t) => (
            <Button
              key={t.sort}
              onClick={() => {
                setSort(t.sort);
                setWatchOnly(false);
                setGraduatedOnly(false);
              }}
              variant="ghost"
              className={`h-9 gap-2 rounded-md px-3 text-sm ${sort === t.sort && !watchOnly && !graduatedOnly ? "bg-white/10 text-white hover:bg-white/15" : "text-zinc-400"}`}
            >
              <t.Icon className="size-4" />
              {t.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            aria-pressed={graduatedOnly}
            onClick={() => {
              setGraduatedOnly(!graduatedOnly);
              setWatchOnly(false);
            }}
            className={`h-9 gap-2 rounded-md px-3 text-sm ${graduatedOnly ? "bg-white/10 text-[#d7ff00] hover:bg-white/15" : "text-zinc-400"}`}
          >
            <GraduationCap className="size-4" />
            Graduated
          </Button>
          <Button
            onClick={() => {
              setWatchOnly(!watchOnly);
              setGraduatedOnly(false);
            }}
            variant="ghost"
            aria-pressed={watchOnly}
            className={`h-9 gap-2 rounded-md px-3 text-sm ${watchOnly ? "bg-[#d7ff00] text-zinc-950 hover:bg-[#e3ff5c]" : "text-zinc-400"}`}
          >
            <Bookmark className="size-4" />
            Watchlist
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setFilters(true)}
            className="h-9 border-white/10 bg-[#202326]"
          >
            <Filter className="size-4" />
            Filter{category || minVideos ? " •" : ""}
          </Button>
          <div className="flex h-9 items-center rounded-lg border border-white/10 bg-[#202326] p-0.5">
            <Button
              variant="ghost"
              aria-pressed={grid}
              onClick={() => setGrid(true)}
              className={`h-8 ${grid ? "bg-white/10" : "text-zinc-500"}`}
            >
              <Grid2X2 className="size-4" />
              Grid
            </Button>
            <Button
              variant="ghost"
              aria-pressed={!grid}
              onClick={() => setGrid(false)}
              className={`h-8 ${!grid ? "bg-white/10" : "text-zinc-500"}`}
            >
              <List className="size-4" />
              Table
            </Button>
          </div>
        </div>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1 sm:max-w-2xl">
          <Search className="absolute left-3 top-3 size-4 text-zinc-500" />
          <Input
            value={search}
            maxLength={64}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search influencers or tickers…"
            aria-label="Search market"
            className="h-10 border-white/10 pl-9"
          />
        </div>
        <label className="group flex h-10 cursor-pointer select-none items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 text-sm text-zinc-300 backdrop-blur-xl transition-colors hover:bg-white/[0.08] has-[:checked]:border-[#d7ff00]/40 has-[:checked]:text-white">
          <input
            type="checkbox"
            checked={graduatedOnly}
            onChange={(e) => {
              setGraduatedOnly(e.target.checked);
              if (e.target.checked) setWatchOnly(false);
            }}
            className="peer sr-only"
          />
          <span aria-hidden="true" className="grid size-4 place-items-center rounded-[4px] border border-white/25 bg-black/30 text-transparent transition-colors peer-checked:border-[#d7ff00] peer-checked:bg-[#d7ff00] peer-checked:text-black peer-focus-visible:ring-2 peer-focus-visible:ring-[#d7ff00]/60">
            <Check className="size-3" strokeWidth={3.5} />
          </span>
          Graduated only
        </label>
        <div className="relative">
          <select
            aria-label="Sort coins"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-10 cursor-pointer appearance-none rounded-lg border border-white/10 bg-white/[0.04] py-0 pl-3.5 pr-9 text-sm text-zinc-200 backdrop-blur-xl outline-none transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-[#d7ff00]/50"
          >
            <option value="mcap" className="bg-[#202326]">Sort: Highest TVL</option>
            <option value="volume" className="bg-[#202326]">Sort: 24h volume</option>
            <option value="change" className="bg-[#202326]">Sort: Top gainers</option>
            <option value="new" className="bg-[#202326]">Sort: Newest</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-3 size-4 text-zinc-500" />
        </div>
        <p className="ml-auto text-sm font-medium text-white">
          {connection.isWebSocketConnected
            ? `${visible?.length ?? "…"} ${visible?.length === 1 ? "influencer" : "influencers"} live right now`
            : "Reconnecting…"}
        </p>
      </div>
      {rows === undefined ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[345px] rounded-lg bg-white/5" />
          ))}
        </div>
      ) : !visible?.length ? (
        <div className="rounded-md border border-white/10 py-20 text-center text-zinc-500">
          <p>No confirmed coins match this market.</p>
          <Link href="/create" className="mt-4 inline-flex h-9 items-center rounded-md bg-[#d7ff00] px-4 text-sm font-medium text-black hover:bg-[#e4ff59]">Create a coin</Link>{" "}
          <Button
            variant="link"
            onClick={() => {
              setSearch("");
              setCategory("");
              setWatchOnly(false);
              setMinVideos(false);
              setGraduatedOnly(false);
            }}
          >
            Reset filters
          </Button>
        </div>
      ) : grid ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {visible.map((r) => (
            <motion.article
              key={r.characterId}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="group relative overflow-hidden rounded-xl border border-white/[0.1] bg-gradient-to-b from-white/[0.075] to-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_24px_60px_-28px_rgba(0,0,0,0.9)] backdrop-blur-2xl backdrop-saturate-150 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:from-white/[0.1] motion-reduce:transition-none"
            >
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_55%_at_50%_-8%,rgba(255,255,255,0.2),transparent_62%)]" />
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-xl border border-white/70 [mask-image:radial-gradient(65%_45%_at_50%_0%,black,transparent)]" />
              <div className="relative p-5">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/market/${r.characterId}`}
                    className="flex min-w-0 items-center gap-3"
                  >
                    <Portrait row={r} large />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="font-apple truncate text-xl font-semibold tracking-tight text-white">
                          {r.name}
                        </h2>

                      </div>
                      <p className="mt-1 text-xs text-zinc-300">
                        ${r.ticker} · {age(r.createdAt)}
                      </p>
                    </div>
                  </Link>
                  <span className="shrink-0 self-start rounded-full border border-white/20 bg-gradient-to-b from-white/[0.16] to-white/[0.04] px-2.5 py-0.5 text-[10px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-xl">
                          {r.category}
                        </span>
                </div>
                <div className="mt-6 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] text-zinc-500">Market cap</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight text-[#f5f4ef]">
                      {r.network === "paper"
                        ? formatMarketUsd(r.marketCapLamports)
                        : pools[r.characterId]?.available &&
                            pools[r.characterId].capSol != null
                          ? <LiveValue value={String(Math.round(pools[r.characterId].capSol! * 1e9))} display={formatUsdEstimate(String(Math.round(pools[r.characterId].capSol! * 1e9)), solUsd)} />
                          : "—"}
                      <span className="ml-1 text-xs font-normal text-zinc-500">
                        USD
                      </span>
                    </p>
                    <div className="mt-1">
                      <ChangePill value={pools[r.characterId]?.changeSinceLaunchPct} /><span className="ml-2 text-[10px] text-zinc-500">since launch</span>
                    </div>
                  </div>
                  <MarketSparkline values={pools[r.characterId]?.points?.map(p => p.price) ?? []} />
                </div>
                <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-xs">
                  <div>
                    <dt className="text-[10px] text-zinc-500">{r.network === "paper" ? "24h volume" : "App 24h volume"}</dt>
                    <dd className="mt-2 text-zinc-300">
                      {r.network === "paper" && r.historyComplete
                        ? `${formatMarketUsd(r.volume24hLamports)} USD`
                        : pools[r.characterId]?.appVolume24hLamports ? `${formatUsdEstimate(pools[r.characterId].appVolume24hLamports!, solUsd)} USD` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-zinc-500">Holders</dt>
                    <dd className="mt-2 text-zinc-300">
                      {r.holders?.toLocaleString() ?? "—"}
                    </dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-[10px] text-zinc-500">Videos posted</dt>
                    <dd className="mt-2 text-zinc-300">
                      {r.videosPosted}
                      {r.videosCountCapped ? "+" : ""}
                    </dd>
                  </div>
                </dl>
                <p className="mt-5 flex items-center justify-between text-[10px] text-zinc-500">
                  <span>
                    {r.state === "graduated" ||
                    r.state === "migrated" ||
                    pools[r.characterId]?.migrated
                      ? "Graduated to DAMM v2"
                      : r.network === "paper"
                        ? "Simulated market · no on-chain pool"
                        : pools[r.characterId]?.available
                          ? `${Math.round(pools[r.characterId].progress * 100)}% to graduation`
                          : "Live token · awaiting pool data"}
                  </span>
                  <span className="size-1.5 rounded-full bg-teal-400" />
                </p>
                <div className="mt-2 h-1.5 overflow-hidden bg-white/10 [mask-image:repeating-linear-gradient(to_right,black_0px,black_5px,transparent_5px,transparent_8px)]">
                  <div
                    className="h-full bg-[#d7ff00]/80 transition-[width] duration-500 motion-reduce:transition-none"
                    style={{
                      width: `${r.state === "graduated" || r.state === "migrated" ? 100 : (pools[r.characterId]?.progress ?? 0) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <Link
                href={`/market/${r.characterId}`}
                className="market-cta flex items-center justify-between border-t border-white/[.08] px-5 py-4 text-xs font-medium"
              >
                View market
                <ArrowUpRight className="market-cta-arrow size-4" />
              </Link>
            </motion.article>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-white/10">
          <Table className="min-w-[1150px] text-sm">
            <TableHeader className="bg-[#202326]">
              <TableRow className="border-white/10 hover:bg-transparent">
                {[
                  "INFLUENCER",
                  "GRAPH",
                  "MCAP · USD",
                  "ATH · USD",
                  "AGE",
                  "24H TXNS",
                  "24H VOL · USD",
                  "HOLDERS",
                  "VIDEOS POSTED",
                  "1H",
                  "6H",
                  "24H",
                  "",
                ].map((h, i) => (
                  <TableHead
                    key={i}
                    className={`h-12 text-[11px] font-semibold text-zinc-400 ${i === 0 ? "w-[230px] pl-4" : "text-right"}`}
                  >
                    {h === "MCAP · USD" ||
                    h === "24H VOL · USD" ||
                    h === "24H" ? (
                      <button
                        onClick={() => {
                          setSort(
                            h === "MCAP · USD"
                              ? "mcap"
                              : h === "24H"
                                ? "change"
                                : "volume",
                          );
                          setWatchOnly(false);
                        }}
                        className="inline-flex items-center gap-1"
                      >
                        {h}
                        <ArrowDownUp className="size-3" />
                      </button>
                    ) : (
                      h
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r, i) => (
                <TableRow
                  key={r.characterId}
                  className="border-white/10 transition-colors hover:bg-white/[.035] motion-reduce:transition-none"
                >
                  <TableCell className="pl-4">
                    <Link
                      href={`/market/${r.characterId}`}
                      className="flex items-center gap-3 py-1"
                    >
                      <span className="w-4 text-xs text-zinc-600">{i + 1}</span>
                      <Portrait row={r} />
                      <div className="min-w-0">
                        <p className="max-w-40 truncate font-medium text-zinc-100">
                          {r.name}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          ${r.ticker}
                        </p>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <MarketSparkline values={pools[r.characterId]?.points?.map(p => p.price) ?? []} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-[#d7ff00]">
                    {r.network === "paper" ? (
                      <LiveValue
                        value={r.marketCapLamports}
                        display={formatMarketUsd(r.marketCapLamports)}
                      />
                    ) : (
                      pools[r.characterId]?.available && pools[r.characterId].capSol != null ? <LiveValue value={String(Math.round(pools[r.characterId].capSol! * 1e9))} display={formatMarketUsd(String(Math.round(pools[r.characterId].capSol! * 1e9)))} /> : "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.athLamports
                      ? formatMarketUsd(
                          (BigInt(r.athLamports) * 1000000000n).toString(),
                        )
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right text-zinc-400">
                    {age(r.createdAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.network === "paper"
                      ? r.historyComplete
                        ? r.trades24h.toLocaleString()
                        : "—"
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.network === "paper"
                      ? r.historyComplete
                        ? formatMarketUsd(r.volume24hLamports)
                        : "—"
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.holders?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/market/${r.characterId}?tab=videos`}
                      className="inline-flex items-center gap-1.5 text-emerald-200"
                    >
                      <Video className="size-3.5" />
                      {r.videosPosted}
                      {r.videosCountCapped ? "+" : ""}
                    </Link>
                  </TableCell>
                  {[0, 1, 2].map((n) => (
                    <TableCell key={n} className="text-right">
                      <ChangePill value={r.changes?.[n]} />
                    </TableCell>
                  ))}
                  <TableCell>
                    <span aria-label="Change since launch" className="grid size-7 place-items-center">{pools[r.characterId]?.changeSinceLaunchPct == null ? <span className="text-zinc-600">—</span> : pools[r.characterId].changeSinceLaunchPct! >= 0 ? <ArrowUpRight className="size-4 text-[#d7ff00]" /> : <ArrowDownRight className="size-4 text-red-400" />}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={filters} onOpenChange={setFilters}>
        <DialogContent className="border border-white/10 bg-[#202326] text-white">
          <DialogTitle>Market filters</DialogTitle>
          <DialogDescription>
            Filter by influencer category and published videos.
          </DialogDescription>
          <label className="text-sm text-zinc-400">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-[#09090b] px-3"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={minVideos}
              onChange={(e) => setMinVideos(e.target.checked)}
            />
            Has posted videos
          </label>
          <Button
            className="bg-[#d7ff00] text-black hover:bg-[#e4ff59]"
            onClick={() => setFilters(false)}
          >
            Apply filters
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
function Portrait({ row, large = false }: { row: MarketRow; large?: boolean }) {
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden border border-white/10 bg-[#d7ff00]/10 text-xs font-semibold text-[#d7ff00] ${large ? "size-16 rounded-[4px]" : "size-10 rounded-full"}`}
      aria-hidden="true"
    >
      {row.name.slice(0, 2).toUpperCase()}
      {row.imageUrl && (
        <img
          src={row.imageUrl}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  );
}

export function LiveValue({ value, display }: { value: string; display: string }) {
  const previous = useRef(value);
  const controls = useAnimationControls();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (previous.current === value) return;
    const up = BigInt(value) >= BigInt(previous.current);
    previous.current = value;
    if (reduced) return;
    void controls.start({
      backgroundColor: [
        up ? "rgba(93,227,154,.22)" : "rgba(248,113,113,.22)",
        "rgba(0,0,0,0)",
      ],
      transition: { duration: 0.75 },
    });
  }, [value, controls, reduced]);
  return (
    <motion.span
      animate={controls}
      className="rounded px-1 py-0.5 tabular-nums"
    >
      <motion.span key={display} initial={reduced ? false : { opacity: 0, rotateX: -70, y: -5 }} animate={{ opacity: 1, rotateX: 0, y: 0 }} transition={{ duration: 0.22 }} className="inline-block">{display}</motion.span>
    </motion.span>
  );
}
