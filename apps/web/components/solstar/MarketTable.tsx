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
  Clock3,
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
    <main className="min-h-screen bg-[#181a1c] px-4 py-4 text-zinc-200 lg:px-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 pb-3">
          {tabs.map((t) => (
            <Button
              key={t.sort}
              onClick={() => {
                setSort(t.sort);
                setWatchOnly(false);
                setGraduatedOnly(false);
              }}
              variant="ghost"
              className={`h-9 gap-2 ${sort === t.sort && !watchOnly ? "rounded-md border-transparent bg-white/10 text-white hover:bg-white/15" : "text-zinc-400"}`}
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
            className={graduatedOnly ? "text-[#d7ff00]" : "text-zinc-400"}
          >
            Graduated
          </Button>
          <Button
            onClick={() => {
              setWatchOnly(!watchOnly);
              setGraduatedOnly(false);
            }}
            variant="ghost"
            aria-pressed={watchOnly}
            className={
              watchOnly ? "bg-[#d7ff00] text-zinc-950" : "text-zinc-400"
            }
          >
            <Bookmark className="size-4" />
            Watchlist
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setFilters(true)}
            className="h-10 border-white/10 bg-[#202326]"
          >
            <Filter className="size-4" />
            Filter{category || minVideos ? " •" : ""}
          </Button>
          <div className="flex rounded-lg border border-white/10 bg-[#202326] p-1">
            <Button
              variant="ghost"
              aria-pressed={grid}
              onClick={() => setGrid(true)}
              className={grid ? "bg-white/10" : "text-zinc-500"}
            >
              <Grid2X2 className="size-4" />
              Grid
            </Button>
            <Button
              variant="ghost"
              aria-pressed={!grid}
              onClick={() => setGrid(false)}
              className={!grid ? "bg-white/10" : "text-zinc-500"}
            >
              <List className="size-4" />
              Table
            </Button>
          </div>
        </div>
      </div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-sm">
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
      </div>
      <p className="mb-4 flex items-center gap-2 text-xs text-zinc-500">
        <span
          className={`size-1.5 rounded-full ${connection.isWebSocketConnected ? "bg-teal-400" : "bg-amber-400"}`}
        />
        {visible?.length ?? "…"} markets ·{" "}
        {connection.isWebSocketConnected ? "Live updates" : "Reconnecting"}
      </p>
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
              className="group overflow-hidden rounded-lg border border-white/[.09] bg-[#202326] transition-colors hover:border-[#d7ff00]/35 motion-reduce:transition-none"
            >
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/market/${r.characterId}`}
                    className="flex min-w-0 items-center gap-3"
                  >
                    <Portrait row={r} large />
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-[#f5f4ef]">
                        {r.name}
                      </h2>
                      <p className="mt-1 text-xs text-zinc-500">
                        ${r.ticker} · {age(r.createdAt)}
                      </p>
                    </div>
                  </Link>
                  <span aria-label="Change since launch" className="grid size-7 place-items-center">{pools[r.characterId]?.changeSinceLaunchPct == null ? <span className="text-zinc-600">—</span> : pools[r.characterId].changeSinceLaunchPct! >= 0 ? <ArrowUpRight className="size-4 text-[#d7ff00]" /> : <ArrowDownRight className="size-4 text-red-400" />}</span>
                </div>
                <div className="mt-5 flex gap-2 text-[10px]">
                  <span className="rounded-md bg-white/5 px-2 py-1 text-zinc-400">
                    {r.network === "paper"
                      ? "Preview"
                      : r.dbcPool
                        ? `DBC · ${r.network}`
                        : `Solana · ${r.network}`}
                  </span>
                  <span className="rounded-md bg-teal-400/10 px-2 py-1 text-teal-400">
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
                    <div className="mt-2">
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
                className="flex items-center justify-between border-t border-white/[.08] px-5 py-4 text-xs text-zinc-500 transition-colors hover:bg-white/5 hover:text-[#d7ff00]"
              >
                View market
                <ArrowUpRight className="size-4" />
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
      className={`relative grid shrink-0 place-items-center overflow-hidden border border-white/10 bg-[#d7ff00]/10 text-xs font-semibold text-[#d7ff00] ${large ? "size-14 rounded-lg" : "size-10 rounded-full"}`}
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
