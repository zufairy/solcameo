"use client";
/* eslint-disable @next/next/no-img-element -- remote episode media */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Connection, PublicKey } from "@solana/web3.js";
import { MarketCharacterChat } from "./MarketCharacterChat";
import { MarketInfoCarousel } from "./MarketInfoCarousel";
import { useSearchParams } from "next/navigation";
import { useQuery, useConvexConnectionState } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Loader2,
  Star,
  Video,
} from "lucide-react";
import { PumpFeePayout } from "@/components/solcameo/PumpFeePayout";
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
import { ErrorBoundary } from "@/components/error/error-boundary";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { formatUsdEstimate } from "@/lib/solstar/usdc";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { LiveDbcLaunch } from "@/components/solcameo/LiveDbcLaunch";
import { DEFAULT_DBC } from "@/lib/meteora/options";
import { PAPER_VIRTUAL_TOKENS } from "@/lib/solstar/economics";
import { marketCapLamports, priceLamportsPerToken } from "@/lib/solstar/market";
import { getReadRpcUrl, getAccountExplorerUrl } from "@/lib/solana/network";
import { TerminalChart } from "./TerminalChart";
import { FlywheelPanel } from "@/components/solcameo/FlywheelPanel";
import { TradeTicket } from "./TradeTicket";
import { useMarketWatchlist } from "./market-watchlist";

type ChainData = {
  available: boolean;
  reason?: string;
  error?: string;
  network?: string;
  slot?: number;
  checkedAt?: number;
  supply?: { amount: string; decimals: number; uiAmountString: string };
  holders?: Array<{ wallet: string; units: string; supplyPct: number }>;
  trades?: Array<{
    signature: string;
    wallet: string;
    side: string;
    units: string;
    lamports: string;
    createdAt: number;
  }>;
  historyError?: string;
  accounts?: Array<{ address: string; amount: string; uiAmountString: string }>;
};
const short = (s: string) =>
  s.length > 16 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
export function MarketTerminal({
  characterId,
}: {
  characterId: Id<"ssCharacters">;
}) {
  return (
    <ErrorBoundary
      fallback={
        <div className="p-10 text-zinc-400">
          Market data is unavailable.{" "}
          <Link href="/market" className="text-emerald-300">
            Return to market
          </Link>
        </div>
      }
    >
      <Terminal key={characterId} characterId={characterId} />
    </ErrorBoundary>
  );
}
function Terminal({ characterId }: { characterId: Id<"ssCharacters"> }) {
  const data = useQuery(api.solstarMarket.terminal, { characterId });
  const usd = useSolUsd();
  const { publicKey } = useUnifiedSolanaWallet();
  const formatSol = (lamports: string) => formatUsdEstimate(lamports, usd);
  const formatCompactSol = formatSol;
  const connection = useConvexConnectionState();
  const watch = useMarketWatchlist();
  const params = useSearchParams();
  const [mobilePanel, setMobilePanel] = useState<
    "chart" | "trade" | "community"
  >("chart");
  const [poolError, setPoolError] = useState("");
  const [poolCheckedAt, setPoolCheckedAt] = useState<number>();
  const [communityTab, setCommunityTab] = useState<"chat" | "feed">("chat");
  const [tab, setTab] = useState(
    params.get("tab") === "videos" ? "videos" : "holders",
  );
  const [minutes, setMinutes] = useState(1);
  const [mcap, setMcap] = useState(true);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [chain, setChain] = useState<ChainData | null>(null);
  const [dbc, setDbc] = useState<{
    available: boolean;
    capSol: number | null;
    reserveSol: number;
    targetSol: number;
    progress: number;
    migrated: boolean;
    supplyTokens?: number;
    points?: Array<{
      time: number;
      price: number;
      volume: number;
      side: "buy" | "sell";
    }>;
    appVolume24hLamports?: string;
  } | null>(null);
  const [chainError, setChainError] = useState("");
  const feed = useQuery(api.solstarFeed.listFeed, { limit: 50 });
  const poolConnection = useMemo(
    () =>
      new Connection(
        getReadRpcUrl(
          data?.token.network === "mainnet" ? "mainnet-beta" : "devnet",
        ),
        "confirmed",
      ),
    [data?.token.network],
  );
  useEffect(() => {
    if (!data?.token.dbcPool) return;
    const controller = new AbortController();
    let refreshing = false,
      queued = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (controller.signal.aborted || document.hidden) return;
      if (refreshing) {
        queued = true;
        return;
      }
      refreshing = true;
      try {
        const res = await fetch(
          `/api/meteora/pool?characterId=${characterId}`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(15000),
            ]),
          },
        );
        const next = await res.json();
        if (!res.ok || !next.available)
          throw new Error(next.error || "Waiting for pool data");
        if (!controller.signal.aborted) {
          setDbc((previous) => {
            const merged = [
              ...(previous?.points ?? []),
              ...(next.points ?? []),
            ];
            const byTime = new Map(merged.map((point) => [point.time, point]));
            return {
              ...next,
              points: [...byTime.values()]
                .sort((a, b) => a.time - b.time)
                .slice(-5000),
            };
          });
          setPoolError("");
          setPoolCheckedAt(Date.now());
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setPoolError(
            e instanceof Error ? e.message : "Pool RPC reconnecting",
          );
      } finally {
        refreshing = false;
        if (queued && !controller.signal.aborted) {
          queued = false;
          void refresh();
        }
      }
    };
    const notify = () => {
      if (debounce || controller.signal.aborted) return;
      debounce = setTimeout(() => {
        debounce = undefined;
        void refresh();
        window.dispatchEvent(new Event("solcameo:trade-confirmed"));
      }, 250);
    };
    // Subscribe to this pool even when it falls outside the home market's latest 30.
    const subscription = poolConnection.onAccountChange(
      new PublicKey(data.token.dbcPool),
      notify,
      "confirmed",
    );
    window.addEventListener("solcameo:trade-confirmed", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      void poolConnection.removeAccountChangeListener(subscription);
      window.removeEventListener("solcameo:trade-confirmed", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [characterId, data?.token.dbcPool, poolConnection]);
  const onChain = !!data?.token.mint && data.token.network !== "paper";
  useEffect(() => {
    if (!onChain) return;
    const controller = new AbortController();
    let refreshing = false;
    async function refresh() {
      if (document.hidden || refreshing || controller.signal.aborted) return;
      refreshing = true;
      try {
        const res = await fetch(
          `/api/solstar/token-chain?characterId=${encodeURIComponent(characterId)}`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(15000),
            ]),
          },
        );
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        setChain(result);
        setChainError("");
      } catch (e) {
        if (!controller.signal.aborted)
          setChainError(e instanceof Error ? e.message : "RPC unavailable");
      } finally {
        refreshing = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    window.addEventListener("solcameo:trade-confirmed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("solcameo:trade-confirmed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [characterId, onChain]);
  if (data === undefined)
    return (
      <div className="grid min-h-[65vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-emerald-300" />
      </div>
    );
  if (!data)
    return (
      <div className="p-10 text-zinc-400">
        Character unavailable. <Link href="/market">Return to market</Link>
      </div>
    );
  if (
    data.token.network === "paper" ||
    !data.token.mint ||
    !data.token.dbcPool ||
    !["live", "graduated", "migrated"].includes(data.token.state)
  )
    return (
      <div className="mx-auto h-full max-w-6xl overflow-y-auto overscroll-contain px-6 py-10">
        <div className="mb-6 h-[420px]">
          <MarketCharacterChat characterId={characterId} />
        </div>
        <Link href="/market" className="text-xs text-zinc-400">
          ← Back to market
        </Link>
        <h1 className="mt-6 text-2xl font-semibold">{data.character.name}</h1>
        <p className="mt-3 text-sm text-zinc-400">
          This character has no confirmed market yet. Launch the coin to enable
          on-chain prices and trading.
        </p>
        {publicKey?.toBase58() === data.character.ownerWallet ? (
          <div className="mt-6">
            <LiveDbcLaunch
              characterId={characterId}
              options={DEFAULT_DBC}
              onComplete={() =>
                window.dispatchEvent(new Event("solcameo:trade-confirmed"))
              }
            />
          </div>
        ) : (
          <Link
            href="/create"
            className="mt-6 inline-flex h-9 items-center rounded-md bg-[#d7ff00] px-4 text-sm font-medium text-black hover:bg-[#e4ff59]"
          >
            Create a coin
          </Link>
        )}
      </div>
    );
  const { character, token, stats, episodes, trades, budget } = data;
  const pool = {
    solReserve: BigInt(token.solReserve),
    tokenReserve: BigInt(token.tokenReserve),
  };
  const price = priceLamportsPerToken(pool).toString();
  const cap = marketCapLamports(pool, PAPER_VIRTUAL_TOKENS).toString();
  const volume = stats
    ? (BigInt(stats.buyVolume) + BigInt(stats.sellVolume)).toString()
    : null;
  const recentTrades = chain?.trades ?? [];
  const buys = onChain
      ? recentTrades.filter((t) => t.side === "buy").length
      : (stats?.buys ?? 0),
    sells = onChain
      ? recentTrades.filter((t) => t.side === "sell").length
      : (stats?.sells ?? 0);
  const rows =
    stats?.holders.filter((h) =>
      h.wallet.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const displayedTrades = onChain
    ? (chain?.trades ?? []).map((t) => ({
        _id: t.signature,
        wallet: t.wallet,
        side: t.side,
        createdAt: t.createdAt,
        amountIn: t.side === "buy" ? t.lamports : t.units,
        amountOut: t.side === "buy" ? t.units : t.lamports,
      }))
    : trades;
  const events =
    feed?.filter(
      (e) => e.tokenId === token._id || e.characterId === characterId,
    ) ?? [];
  const explorer = (address: string) =>
    getAccountExplorerUrl(
      address,
      token.network === "mainnet" ? "mainnet-beta" : "devnet",
    );
  async function copy() {
    try {
      await navigator.clipboard.writeText(token.mint || characterId);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <main className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#181a1c] text-zinc-300">
      <div className="flex items-center justify-between shrink-0 border-b border-white/10 px-4 py-2 text-[11px] text-zinc-500">
        <Link
          href="/market"
          className="flex items-center gap-1.5 hover:text-white"
        >
          <ArrowLeft className="size-3.5" />
          Explore influencers
        </Link>
        <span className="flex items-center gap-2">
          <span
            className={`size-1.5 rounded-full ${connection.isWebSocketConnected ? "bg-emerald-300" : "bg-amber-400"}`}
          />
          {poolError
            ? "Pool reconnecting"
            : connection.isWebSocketConnected
              ? "Connected"
              : "Reconnecting"}{" "}
          ·{" "}
          {token.network === "paper"
            ? "Paper preview · no mint"
            : `Solana ${token.network}`}
        </span>
      </div>
      <div
        className="flex shrink-0 border-b border-white/10 p-1 lg:hidden"
        role="group"
        aria-label="Market panels"
      >
        {(["chart", "trade", "community"] as const).map((panel) => (
          <button
            type="button"
            key={panel}
            aria-pressed={mobilePanel === panel}
            onClick={() => setMobilePanel(panel)}
            className={`flex-1 rounded-md py-2 text-xs capitalize ${mobilePanel === panel ? "bg-white/10 text-white" : "text-zinc-500"}`}
          >
            {panel}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[310px_minmax(0,1fr)_320px] xl:grid-cols-[350px_minmax(0,1fr)_330px] 2xl:grid-cols-[400px_minmax(0,1fr)_360px]">
        <aside
          className={`${mobilePanel === "community" ? "flex" : "hidden"} h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-white/10 lg:flex`}
        >
          <div className="flex shrink-0 border-b border-white/10 p-2 gap-1">
            <Button
              size="sm"
              variant="ghost"
              className={
                communityTab === "chat"
                  ? "bg-white/5 text-[#d7ff00]"
                  : "text-zinc-500"
              }
              onClick={() => setCommunityTab("chat")}
            >
              Chat
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={
                communityTab === "feed"
                  ? "bg-white/5 text-[#d7ff00]"
                  : "text-zinc-500"
              }
              onClick={() => setCommunityTab("feed")}
            >
              Activity
            </Button>
          </div>
          {communityTab === "chat" ? (
            <div className="min-h-0 flex-1 overflow-hidden"><MarketCharacterChat characterId={characterId} /></div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {events.length ? (
                events.map((e) => (
                  <div
                    key={e.id}
                    className="border-b border-white/5 px-3 py-2.5"
                  >
                    <p className="mb-1 font-sans tabular-nums text-[10px] text-zinc-500">
                      {short(e.wallet || "Vello")} ·{" "}
                      {new Date(e.createdAt).toLocaleTimeString("en-MY", {
                        timeZone: "Asia/Kuala_Lumpur",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <p className="text-xs leading-relaxed text-zinc-300">
                      {e.body}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2 text-zinc-500">
                      {character.referenceImageUrl && (
                        <img
                          src={character.referenceImageUrl}
                          alt=""
                          className="size-5 rounded-full object-cover"
                        />
                      )}
                      <span className="text-xs">${token.ticker}</span>
                      <span className="ml-auto text-[10px] text-emerald-300">
                        {token.network}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="p-5 text-xs leading-relaxed text-zinc-600">
                  No recent activity for this influencer. Trades and follows
                  appear here as they happen.
                </p>
              )}

            </div>
          )}
              <div className="mt-auto shrink-0 border-t border-white/10 bg-[#181a1c] p-4">
                <h2 className="mb-2 text-xs font-medium text-zinc-400">
                  About the influencer
                </h2>
                <div className="mb-3 flex items-center gap-3">
                  {character.referenceImageUrl && (
                    <img
                      src={character.referenceImageUrl}
                      alt={character.name}
                      className="size-12 rounded-[4px] object-cover"
                    />
                  )}
                  <div>
                    <p className="text-sm font-medium text-white">
                      {character.name}
                    </p>
                    <p className="mt-1 text-[10px] text-zinc-500">
                      ${token.ticker} · {character.category}
                    </p>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-zinc-500">
                  {character.bio}
                </p>
                <p className="mt-4 text-[10px] uppercase tracking-widest text-zinc-600">
                  {character.category}
                </p>
              </div>
        </aside>
        <section
          className={`${mobilePanel === "chart" ? "block" : "hidden"} min-h-0 min-w-0 overflow-y-auto overscroll-contain lg:block`}
        >
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-3">
              {character.referenceImageUrl && (
                <img
                  src={character.referenceImageUrl}
                  alt=""
                  className="size-12 rounded-xl object-cover"
                />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold text-white">
                    {token.ticker}
                  </h1>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void copy()}
                    aria-label="Copy token address"
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => watch.toggle(characterId)}
                    aria-label="Watch influencer"
                    aria-pressed={watch.ids.includes(characterId)}
                  >
                    <Star
                      className={`size-3.5 ${watch.ids.includes(characterId) ? "fill-emerald-300 text-emerald-300" : ""}`}
                    />
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {character.name} ·{" "}
                  {copied ? "Copied" : short(token.mint || characterId)}{" "}
                  {token.dbcPool && (
                    <a
                      href={`https://www.meteora.ag/dbc/${token.dbcPool}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mr-2 text-[#d7ff00]"
                    >
                      Meteora <ExternalLink className="inline size-3" />
                    </a>
                  )}
                  {token.mint && (
                    <a
                      href={explorer(token.mint)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </p>
              </div>
            </div>
            <div className="flex gap-5">
              <Metric
                label="Market cap · USD"
                value={
                  token.network === "paper"
                    ? formatCompactSol(cap)
                    : dbc?.available && dbc.capSol != null
                      ? formatSol(String(Math.round(dbc.capSol * 1e9)))
                      : "—"
                }
                big
              />
              <Metric
                label={
                  token.network === "paper"
                    ? "24h vol · USD"
                    : "App 24h vol · USD"
                }
                value={
                  token.network === "paper"
                    ? volume
                      ? formatCompactSol(volume)
                      : "—"
                    : dbc?.appVolume24hLamports
                      ? formatCompactSol(dbc.appVolume24hLamports)
                      : "—"
                }
              />
              <Metric
                label={onChain ? "Top account owners" : "Holders"}
                value={
                  (onChain
                    ? chain?.holders?.length
                    : stats?.holders.length
                  )?.toLocaleString() ?? "—"
                }
              />
              <Metric
                label="Videos"
                value={`${episodes.length}${episodes.length === 100 ? "+" : ""}`}
              />
            </div>
          </header>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <div className="flex gap-1">
              {[1, 5, 60, 240, 1440].map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant="ghost"
                  aria-pressed={minutes === m}
                  className={
                    minutes === m ? "text-emerald-300" : "text-zinc-500"
                  }
                  onClick={() => setMinutes(m)}
                >
                  {m < 60 ? `${m}m` : m < 1440 ? `${m / 60}h` : "D"}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMcap(!mcap)}
                className="text-zinc-400"
              >
                Price /{" "}
                <span className={mcap ? "text-emerald-300" : "text-white"}>
                  {mcap ? "MCap" : "Price"}
                </span>
              </Button>
              <span className="py-1 text-xs text-emerald-300">USD</span>
            </div>
          </div>
          <div className="border-b border-white/10">
            {poolError && (
              <p role="status" className="px-4 pt-2 text-[10px] text-amber-300">
                {poolError} · showing last confirmed data
              </p>
            )}
            <div className="px-4 pt-4 text-xs text-zinc-500">
              {token.ticker}/USD · {mcap ? "Market cap" : "Price"} · {minutes}
              min ·{" "}
              {token.network === "paper"
                ? "Vello paper ledger"
                : "Confirmed app trades · observed pool prices"}
            </div>
            <TerminalChart
              supplyTokens={dbc?.supplyTokens}
              points={
                usd == null
                  ? []
                  : (token.network === "paper"
                      ? (stats?.points ?? [])
                      : (dbc?.points ?? [])
                    ).map((p) => ({
                      ...p,
                      price: p.price * usd,
                      volume: (p.volume ?? 0) * usd,
                    }))
              }
              minutes={minutes}
              mcap={mcap}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4">
            <div className="flex gap-4">
              {["holders", "trades", "videos"].map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`border-b-2 py-4 text-sm capitalize ${tab === t ? "border-emerald-300 text-white" : "border-transparent text-zinc-500"}`}
                >
                  {t}
                  {t === "holders" && stats ? (
                    <span className="ml-2 rounded bg-white/5 px-1.5 text-xs text-zinc-500">
                      {stats.holders.length}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            {tab !== "videos" && (
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search wallet…"
                aria-label="Search wallet"
                className="my-2 w-48 border-white/10 text-xs"
              />
            )}
          </div>
          {tab === "holders" && onChain ? (
            <div className="overflow-auto">
              <Table className="[&_td:first-child]:pl-4 [&_th:first-child]:pl-4">
                <TableHeader>
                  <TableRow>
                    {["Holder wallet", "Tokens", "% supply"].map((label) => (
                      <TableHead key={label}>{label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chain?.holders
                    ?.filter((h) =>
                      h.wallet.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((h) => (
                      <TableRow key={h.wallet}>
                        <TableCell>
                          <a
                            href={explorer(h.wallet)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-sans tabular-nums text-xs text-[#d7ff00]"
                          >
                            {short(h.wallet)}
                          </a>
                        </TableCell>
                        <TableCell>
                          {(
                            Number(h.units) /
                            10 ** (chain.supply?.decimals ?? 6)
                          ).toLocaleString()}
                        </TableCell>
                        <TableCell>{h.supplyPct.toFixed(3)}%</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              <p className="p-4 text-[10px] text-zinc-500">
                Confirmed owners of the largest 20 token accounts, including
                pool vaults. {chainError || chain?.historyError}
              </p>
            </div>
          ) : tab === "holders" ? (
            <div className="overflow-auto">
              <Table className="min-w-[530px] [&_td:first-child]:pl-4 [&_th:first-child]:pl-4">
                <TableHeader>
                  <TableRow className="border-white/10">
                    {[
                      "Holder",
                      "Tokens held",
                      "% supply",
                      "Position · USD",
                      "P&L · USD",
                      "Bought · USD",
                    ].map((t) => (
                      <TableHead key={t} className="text-xs text-zinc-500">
                        {t}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((h) => (
                    <TableRow key={h.wallet} className="border-white/10">
                      <TableCell className="font-sans tabular-nums text-xs">
                        {short(h.wallet)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {(Number(h.units) / 1e6).toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell>{h.supplyPct.toFixed(3)}%</TableCell>
                      <TableCell className="text-emerald-300">
                        {formatSol(
                          (
                            (BigInt(h.units) * BigInt(price)) /
                            1000000n
                          ).toString(),
                        )}
                      </TableCell>
                      <TableCell
                        className={
                          BigInt(h.profitLamports) >= 0n
                            ? "text-emerald-400"
                            : "text-red-400"
                        }
                      >
                        {BigInt(h.profitLamports) < 0n ? "−" : "+"}
                        {formatSol(
                          (BigInt(h.profitLamports) < 0n
                            ? -BigInt(h.profitLamports)
                            : BigInt(h.profitLamports)
                          ).toString(),
                        )}
                      </TableCell>
                      <TableCell>{formatSol(h.boughtLamports)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!rows.length && (
                <p className="p-10 text-center text-xs text-zinc-600">
                  {token.network === "paper"
                    ? stats
                      ? "No matching holders yet."
                      : "Complete holder history unavailable."
                    : "See confirmed token accounts in the Solana panel."}
                </p>
              )}
            </div>
          ) : tab === "trades" ? (
            <div className="overflow-auto">
              <Table className="min-w-[530px] [&_td:first-child]:pl-4 [&_th:first-child]:pl-4">
                <TableHeader>
                  <TableRow className="border-white/10">
                    {["Time", "Side", "USD", "Tokens", "Wallet"].map((t) => (
                      <TableHead key={t} className="text-xs text-zinc-500">
                        {t}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedTrades
                    .filter((t) =>
                      t.wallet.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((t) => (
                      <TableRow key={t._id} className="border-white/10">
                        <TableCell className="text-xs text-zinc-500">
                          {new Date(t.createdAt).toLocaleTimeString("en-MY", {
                            timeZone: "Asia/Kuala_Lumpur",
                          })}
                        </TableCell>
                        <TableCell
                          className={
                            t.side === "buy"
                              ? "text-emerald-400"
                              : "text-red-400"
                          }
                        >
                          {t.side}
                        </TableCell>
                        <TableCell>
                          {formatSol(
                            t.side === "buy" ? t.amountIn : t.amountOut,
                          )}
                        </TableCell>
                        <TableCell>
                          {(
                            Number(
                              t.side === "buy" ? t.amountOut : t.amountIn,
                            ) / 1e6
                          ).toLocaleString(undefined, {
                            maximumFractionDigits: 1,
                          })}
                        </TableCell>
                        <TableCell className="font-sans tabular-nums text-xs">
                          <a
                            href={
                              onChain
                                ? `https://solscan.io/tx/${t._id}?cluster=devnet`
                                : explorer(t.wallet)
                            }
                            target="_blank"
                            rel="noreferrer"
                          >
                            {short(t.wallet)}{" "}
                            <ExternalLink className="inline size-3" />
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              {!displayedTrades.length && (
                <p className="p-10 text-center text-xs text-zinc-600">
                  No recorded trades yet.
                </p>
              )}
              <p className="p-3 text-[10px] text-zinc-600">
                Recent confirmed pool transactions · SOL wallet changes may
                include rent · UTC+8
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-3">
              {episodes.map((e) => (
                <article
                  key={e._id}
                  className="overflow-hidden rounded-lg border border-white/10"
                >
                  <video
                    src={e.videoUrl}
                    poster={e.posterUrl}
                    controls
                    playsInline
                    preload="none"
                    className="aspect-[9/16] w-full bg-black object-cover"
                  />
                  <div className="p-2">
                    <p className="truncate text-xs text-white">{e.title}</p>
                    <p className="mt-1 text-[10px] text-zinc-500">
                      {e.source} · episode {e.index + 1}
                    </p>
                  </div>
                </article>
              ))}
              {!episodes.length && (
                <p className="col-span-full p-8 text-center text-xs text-zinc-600">
                  No videos posted yet.
                </p>
              )}
            </div>
          )}
        </section>
        <aside
          className={`${mobilePanel === "trade" ? "flex" : "hidden"} market-sidebar-text min-h-0 flex-col overflow-hidden border-l border-white/10 lg:flex`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <TradeTicket token={token} />
          {(token.network === "paper" || token.state === "pending") &&
            !token.dbcPool &&
            publicKey?.toBase58() === character.ownerWallet && (
              <div className="border-b border-white/10 p-4">
                <p className="mb-3 text-xs text-zinc-400">
                  This coin is a database preview. Mint it on the configured
                  network to create a real token and trade from your wallet.
                </p>
                <LiveDbcLaunch
                  characterId={characterId}
                  options={DEFAULT_DBC}
                  onComplete={() =>
                    window.dispatchEvent(new Event("solcameo:trade-confirmed"))
                  }
                />
              </div>
            )}
          {token.network === "mainnet" && token.mint && !token.dbcPool && (
            <PumpFeePayout
              characterId={characterId}
              ownerWallet={character.ownerWallet}
              mint={token.mint}
            />
          )}
          {token.network === "devnet" && (
            <p className="border-b border-white/10 px-4 py-2 text-[10px] text-zinc-500">
              Devnet USD values use the SOL spot rate for testing. Test tokens
              have no monetary value.
            </p>
          )}
          {token.dbcPool && (
            <div className="space-y-3 border-b border-white/10 bg-[#202326] p-4">
              <h2 className="text-sm font-semibold text-[#d7ff00]">
                Meteora DBC · {token.network}
              </h2>
              {dbc?.available ? (
                <>
                  <p className="text-xs text-zinc-400">
                    {dbc.migrated
                      ? "Graduated to DAMM v2"
                      : `${dbc.reserveSol.toFixed(3)} / ${dbc.targetSol.toFixed(3)} SOL reserve`}
                  </p>
                  <div className="h-1.5 overflow-hidden bg-white/10 [mask-image:repeating-linear-gradient(to_right,black_0px,black_5px,transparent_5px,transparent_8px)]">
                    <div
                      className="h-full bg-[#d7ff00]/80 transition-[width] duration-500 motion-reduce:transition-none"
                      style={{ width: `${dbc.progress * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-zinc-500">
                    {poolError
                      ? "RPC reconnecting · showing last confirmed state"
                      : `Confirmed pool state${poolCheckedAt ? ` · ${new Date(poolCheckedAt).toLocaleTimeString("en-MY", { hour12: false })}` : ""}`}
                  </p>
                </>
              ) : (
                <p className="text-xs text-zinc-500">
                  Waiting for confirmed pool data…
                </p>
              )}
              <a
                href={explorer(token.dbcPool)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-xs text-[#d7ff00]"
              >
                View pool on Solana <ExternalLink className="size-3" />
              </a>
            </div>
          )}
          </div>
          <MarketInfoCarousel labels={[...(token.dbcPool ? ["Creator fees"] : []), "Pool activity", "Developer", "Token data"]}>
          {token.dbcPool && <FlywheelPanel characterId={characterId} />}
          <div className="space-y-3 border-b border-white/10 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-white">
                Recent pool activity
              </h2>
              <span className="font-sans tabular-nums text-[10px] text-zinc-500">
                {chain?.trades
                  ? `${recentTrades.length} transactions`
                  : "Loading…"}
              </span>
            </div>
            <BalanceBar
              left={chain?.trades ? `${buys} buys` : "— buys"}
              right={chain?.trades ? `${sells} sells` : "— sells"}
              ratio={buys + sells ? buys / (buys + sells) : null}
            />
            <p className="flex justify-between text-[11px] text-zinc-500">
              Recorded app volume · 24h
              <span className="font-sans tabular-nums text-zinc-200">
                {dbc?.appVolume24hLamports
                  ? formatCompactSol(dbc.appVolume24hLamports)
                  : "—"}
              </span>
            </p>
            <p className="text-[10px] leading-4 text-zinc-600">
              Recent confirmed pool transactions. App volume covers swaps
              recorded through SolCameo.
            </p>
          </div>
          <div className="space-y-4 border-b border-white/10 p-4 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-500">Developer wallet</span>
              <a href={explorer(character.ownerWallet)} target="_blank" rel="noreferrer" className="font-sans text-zinc-200 hover:text-[#d7ff00]" title={character.ownerWallet}>{short(character.ownerWallet)} <ExternalLink className="inline size-3" /></a>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Observed high cap · USD</span>
              <span>
                {dbc?.points?.length
                  ? formatCompactSol(
                      String(
                        Math.round(
                          Math.max(...dbc.points.map((p) => p.price)) * 1e9,
                        ),
                      ),
                    )
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Content funded · USD</span>
              <span className="text-emerald-300">
                {formatSol(budget.funded)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Content spent · USD</span>
              <span>{formatSol(budget.spent)}</span>
            </div>
            <Link
              href={`/market/${characterId}?tab=videos`}
              onClick={() => setTab("videos")}
              className="flex items-center justify-center gap-2 rounded-lg bg-white/5 p-3"
            >
              <Video className="size-4" />
              View posted videos
            </Link>
          </div>
          <div className="p-4">
            <h2 className="mb-3 text-sm text-white">Solana token data</h2>
            {!onChain ? (
              <p className="text-xs leading-relaxed text-zinc-600">
                This character has a paper token. No SPL mint, on-chain holders,
                or RPC trades exist for it yet.
              </p>
            ) : (
              <>
                <p className="mb-3 text-[10px] text-zinc-500">
                  Confirmed · {token.network} · refreshes every 5s
                </p>
                {chainError && (
                  <p role="alert" className="text-xs text-amber-300">
                    {chainError}
                  </p>
                )}
                {chain?.available ? (
                  <>
                    <p className="mb-3 text-xs text-zinc-400">
                      Supply: {chain.supply?.uiAmountString}
                      <br />
                      Slot: {chain.slot}
                    </p>
                    <h3 className="mb-2 text-xs text-zinc-500">
                      Largest token accounts (up to 20)
                    </h3>
                    {chain.accounts?.map((a) => (
                      <a
                        key={a.address}
                        href={explorer(a.address)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex justify-between border-t border-white/5 py-2 text-[10px]"
                      >
                        <span className="font-sans tabular-nums">{short(a.address)}</span>
                        <span>{a.uiAmountString}</span>
                      </a>
                    ))}
                  </>
                ) : (
                  !chainError && (
                    <Loader2 className="size-4 animate-spin text-zinc-600" />
                  )
                )}
              </>
            )}
          </div>
          </MarketInfoCarousel>
        </aside>
      </div>
    </main>
  );
}
function Metric({
  label,
  value,
  big = false,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] text-zinc-500">{label}</p>
      <p
        className={`market-sidebar-text ${big ? "text-xl font-semibold" : "text-sm font-medium"} text-white`}
      >
        {value}
      </p>
    </div>
  );
}
function BalanceBar({
  left,
  right,
  ratio,
}: {
  left: string;
  right: string;
  ratio: number | null;
}) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[11px]">
        <span className="text-emerald-400">{left}</span>
        <span className="text-red-400">{right}</span>
      </div>
      <div className="flex h-1 overflow-hidden rounded-full bg-white/5">
        <span
          style={{ width: `${Math.max(0, Math.min(1, ratio ?? 0)) * 100}%` }}
          className={ratio == null ? "bg-transparent" : "bg-emerald-400"}
        />
        <span className={`flex-1 ${ratio == null ? "bg-transparent" : "bg-red-400"}`} />
      </div>
    </div>
  );
}
