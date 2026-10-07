"use client";
/* eslint-disable @next/next/no-img-element -- remote episode media */
import { MarketHolderIdentity } from "./MarketHolderIdentity";
import { MarketInfluencerAbout } from "./MarketInfluencerAbout";
import { SocialLinksForm } from "./SocialLinksForm";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Connection, PublicKey } from "@solana/web3.js";
import { MarketCharacterChat } from "./MarketCharacterChat";
import { MarketLiveCam } from "./MarketLiveCam";
import { MarketInfoCarousel } from "./MarketInfoCarousel";
import { AgentFundSlide } from "./AgentFundSlide";
import { MarketAboutCard } from "./MarketAboutCard";
import { XFeedPanel } from "./XFeedPanel";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Copy,
  Check,
  ExternalLink,
  Loader2,
  Star,
} from "lucide-react";
import { PumpFeePayout } from "@/components/solcameo/PumpFeePayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { getReadRpcUrl, getAccountExplorerUrl, getTxExplorerUrl } from "@/lib/solana/network";
import { TerminalChart } from "./TerminalChart";
import { FlywheelPanel } from "@/components/solcameo/FlywheelPanel";
import { TradeTicket } from "./TradeTicket";
import { OpenTrades, countOpen } from "./OpenTrades";
import { useChainMarket } from "./useChainMarket";
import { dbcFromChain, mergeDbc } from "@/lib/solstar/chainDbc";
import { LiveValue } from "./MarketTable";
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
  const [minutes, setMinutes] = useState(0.25);
  const [mcap, setMcap] = useState(false);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [dbcRpc, setDbc] = useState<{
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
  // Holders, open positions and swaps are Convex live queries: no RPC polling in the browser.
  const { market: chainMarket, swaps: chainSwaps } = useChainMarket(characterId, onChain);
  const chainError = chainMarket?.state?.error ?? "";
  const chain = useMemo<ChainData | null>(() => {
    const state = chainMarket?.state;
    if (!state) return null;
    const scale = 10 ** state.decimals;
    return {
      available: true,
      supply: { amount: state.supplyRaw, decimals: state.decimals, uiAmountString: String(Number(state.supplyRaw) / scale) },
      holders: chainMarket.holders.map((h) => ({ wallet: h.wallet, units: h.units, supplyPct: h.supplyPct })),
      trades: (chainSwaps ?? []).map((t) => ({
        signature: t.signature, wallet: t.wallet, side: t.side,
        units: Math.round(t.units * scale).toString(), lamports: Math.round(t.sol * 1e9).toString(), createdAt: t.time,
      })),
    };
  }, [chainMarket, chainSwaps]);
  // The chart and header paint from Convex the moment the page opens; the pool read (RPC) then refines them and keeps them live.
  const chainPoints = useQuery(api.solstarChain.chartPoints, onChain ? { characterId, limit: 800 } : "skip");
  const dbc = useMemo(() => mergeDbc(dbcRpc, dbcFromChain(chainMarket?.state, chainPoints)) as typeof dbcRpc, [dbcRpc, chainMarket?.state, chainPoints]);
  const holderWallets = useMemo(() => [...new Set([
    ...(chain?.holders ?? []).map(holder => holder.wallet),
    ...(chainMarket?.positions ?? []).filter(p => p.openTokens > 0).map(p => p.wallet),
    ...(data?.stats?.holders ?? []).map(holder => holder.wallet),
  ])].sort().slice(0, 100), [chain?.holders, chainMarket?.positions, data?.stats?.holders]);
  const holderProfiles = useQuery(api.users.leaderboardProfiles, holderWallets.length ? { wallets: holderWallets } : "skip");
  const holderProfile = (wallet: string) => holderProfiles?.find(profile => profile.wallet === wallet);
  const holderIdentity = (wallet: string) => <MarketHolderIdentity wallet={wallet} image={holderProfile(wallet)?.image} name={holderProfile(wallet)?.name} />;
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
          <MarketCharacterChat characterId={characterId} agentName={data.character.name} agentImageUrl={data.character.referenceImageUrl} />
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
  const { character, token, stats, episodes, trades } = data;
  const pool = {
    solReserve: BigInt(token.solReserve),
    tokenReserve: BigInt(token.tokenReserve),
  };
  // A coin with no recorded reserves must not take the whole page down; the live pool numbers fill these in.
  const hasReserves = pool.tokenReserve > 0n;
  const price = hasReserves ? priceLamportsPerToken(pool).toString() : "0";
  const cap = hasReserves ? marketCapLamports(pool, PAPER_VIRTUAL_TOKENS).toString() : "0";
  const volume = stats
    ? (BigInt(stats.buyVolume) + BigInt(stats.sellVolume)).toString()
    : null;
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
      if (!token.mint) return;
      await navigator.clipboard.writeText(token.mint);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <main className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#181a1c] text-zinc-300">
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
            <div className="min-h-0 flex-1 overflow-hidden"><MarketCharacterChat characterId={characterId} agentName={character.name} agentImageUrl={character.referenceImageUrl} /></div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {events.length ? (
                events.map((e) => (
                  <div
                    key={e.id}
                    className="border-b border-white/5 px-3 py-2.5"
                  >
                    <p className="mb-1 font-sans tabular-nums text-[10px] text-white/70">
                      {short(e.wallet || "Solcameo")}
                    </p>
                    <p className="text-xs leading-relaxed text-white">
                      {e.body ? e.body.charAt(0).toUpperCase() + e.body.slice(1) : ""}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2 text-white">
                      {character.referenceImageUrl && (
                        <img
                          src={character.referenceImageUrl}
                          alt=""
                          className="size-5 rounded-full object-cover"
                        />
                      )}
                      <span className="text-xs">${token.ticker}</span>
                      <time dateTime={new Date(e.createdAt).toISOString()} title={new Date(e.createdAt).toLocaleString()} className="ml-auto font-sans text-[10px] tabular-nums text-white/70">
                        {new Date(e.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      </time>
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
          <MarketInfluencerAbout name={character.name} ticker={token.ticker} category={character.category} bio={character.bio} imageUrl={character.referenceImageUrl} />
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
                  className="size-12 rounded-[4px] object-cover"
                />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold text-white">
                    {token.ticker}
                  </h1>
                  {token.mint && <button
                    type="button"
                    onClick={() => void copy()}
                    aria-label="Copy token address"
                    title={token.mint}
                    className="inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <span>…{token.mint.slice(-4)}</span>
                    {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
                    <span role="status" className="sr-only">{copied ? "Token address copied" : ""}</span>
                  </button>}
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
                <div className="mt-1 flex flex-wrap items-center gap-2.5 text-[11px] text-zinc-500">
                  <span>{character.name}</span>
                  {(token.dammPool || token.dbcPool) && (
                    <a
                      href={`https://www.meteora.ag/${token.dammPool ? "dammv2" : "dbc"}/${encodeURIComponent(token.dammPool || token.dbcPool!)}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open token liquidity pool on Meteora"
                      className="inline-flex items-center gap-1.5 transition-colors hover:text-[#d7ff00]"
                    >
                      <img src="/logos/meteora.svg" alt="" className="size-4" />
                      Meteora <ExternalLink className="size-3" />
                    </a>
                  )}
                  {token.mint && (
                    <a
                      href={explorer(token.mint)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open token on Solscan"
                      className="inline-flex items-center gap-1 transition-colors hover:text-white"
                    >
                      Solscan <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-5">
              <Metric
                flash={token.network !== "paper" && dbc?.available && dbc.capSol != null ? String(Math.round(dbc.capSol * 1e9)) : undefined}
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
                flash={token.network !== "paper" && dbc?.appVolume24hLamports ? dbc.appVolume24hLamports : undefined}
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
            <Tabs value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))}>
              <TabsList aria-label="Chart interval" className="h-8 bg-white/[0.04]">
                {[0.25, 1, 5, 15, 60, 240, 1440].map((m) => (
                  <TabsTrigger key={m} value={String(m)} className="px-2.5 text-xs tabular-nums">
                    {m < 1 ? `${Math.round(m * 60)}s` : m < 60 ? `${m}m` : m < 1440 ? `${m / 60}h` : "1D"}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2">
              <Tabs value={mcap ? "mcap" : "price"} onValueChange={(v) => setMcap(v === "mcap")}>
                <TabsList aria-label="Chart metric" className="h-8 bg-white/[0.04]">
                  <TabsTrigger value="price" className="px-3 text-xs">Price</TabsTrigger>
                  <TabsTrigger value="mcap" className="px-3 text-xs">MCap</TabsTrigger>
                </TabsList>
              </Tabs>
              <Badge variant="outline" className="h-6 rounded-[5px] border-white/10 px-2 text-[11px] text-zinc-300">USD</Badge>
            </div>
          </div>
          <div className="border-b border-white/10">
            {poolError && (
              <p role="status" className="px-4 pt-2 text-[10px] text-amber-300">
                {poolError} · showing last confirmed data
              </p>
            )}
            <div className="px-4 pt-4 text-xs text-zinc-500">
              {token.ticker}/USD · {mcap ? "Market cap" : "Price"} · {minutes < 1 ? `${Math.round(minutes * 60)}s` : `${minutes} min`} ·{" "}
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
              symbol={token.ticker}
              updatedAt={poolCheckedAt}
              connectionError={!!poolError}
              source={token.network === "paper" ? "paper" : "chain"}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4">
            <div className="flex gap-4">
              {[...(onChain ? ["open"] : []), "holders", "trades", "videos"].map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`border-b-2 py-4 text-sm capitalize ${tab === t ? "border-emerald-300 text-white" : "border-transparent text-zinc-500"}`}
                >
                  {t === "open" ? "Open trades" : t}
                  {t === "open" && chainMarket?.state ? (
                    <span className="ml-2 rounded bg-white/5 px-1.5 text-xs tabular-nums text-zinc-400">
                      {countOpen(chainMarket)}
                    </span>
                  ) : t === "holders" && (onChain ? chainMarket : stats) ? (
                    <span className="ml-2 rounded bg-white/5 px-1.5 text-xs text-zinc-500">
                      {onChain ? chainMarket?.holders.filter(h => !h.isPool).length : stats?.holders.length}
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
          {tab === "open" && onChain ? (
            <OpenTrades
              market={chainMarket}
              you={publicKey?.toBase58()}
              dev={character.ownerWallet}
              usd={usd}
              search={search}
              ticker={token.ticker}
              identity={holderIdentity}
              explorer={explorer}
            />
          ) : tab === "holders" && onChain ? (
            <div className="overflow-auto">
              <Table className="min-w-[420px] [&_td:first-child]:pl-4 [&_th:first-child]:pl-4">
                <TableHeader><TableRow className="border-white/10">
                  {["Holder", "Tokens held", "% supply"].map(label => <TableHead key={label} className="text-xs text-zinc-500">{label}</TableHead>)}
                </TableRow></TableHeader>
                <TableBody>
                  {chainMarket?.holders.filter(h => !h.isPool && h.wallet.toLowerCase().includes(search.toLowerCase())).map(h => (
                    <TableRow key={h.wallet} className="border-white/10">
                      <TableCell className="text-xs">{holderIdentity(h.wallet)}</TableCell>
                      <TableCell className="font-sans tabular-nums">{(Number(h.units) / 10 ** (chainMarket.state?.decimals ?? 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="font-sans tabular-nums">{h.supplyPct.toFixed(3)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!chainMarket?.state ? <p className="p-6 text-center text-xs text-zinc-500">Loading holders…</p> : !chainMarket.holders.some(h => !h.isPool && h.wallet.toLowerCase().includes(search.toLowerCase())) && <p className="p-6 text-center text-xs text-zinc-500">No matching holders yet.</p>}
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
                        {holderIdentity(h.wallet)}
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
                                ? getTxExplorerUrl(t._id, token.network === "mainnet" ? "mainnet-beta" : "devnet")
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
          {/* The ticket stays pinned so amount, presets and the trade button never scroll away. */}
          <div className="shrink-0"><TradeTicket token={token} /></div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <MarketAboutCard
            name={character.name}
            ticker={token.ticker}
            bio={character.bio}
            xUrl={character.xUrl}
            websiteUrl={character.websiteUrl}
            showLinks={false}
            showAbout={false}
            trades={chain?.trades}
            points={dbc?.points?.map((p) => ({ time: p.time, price: p.price }))}
            formatLamports={formatCompactSol}
          />
          {publicKey?.toBase58() === character.ownerWallet && <SocialLinksForm characterId={characterId} xUrl={character.xUrl} websiteUrl={character.websiteUrl} />}
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
          </div>
          <MarketInfoCarousel labels={[...(token.dbcPool ? ["Graduation", "Creator fees"] : []), "Agent wallet", "Holders", "X feed", "Live Cam"]}>
          {token.dbcPool && (
            <div className="space-y-3 p-4">
              <h2 className="text-[13px] font-semibold text-white">
                Meteora curve <span className="font-normal text-zinc-500">· {token.network}</span>
              </h2>
              {dbc?.available ? (
                <>
                  <p className="font-sans text-[22px] font-semibold tabular-nums text-white">
                    {dbc.migrated ? "Graduated" : `${Math.round(dbc.progress * 100)}%`}
                    <span className="ml-2 text-[12px] font-normal text-zinc-500">
                      {dbc.migrated ? "DAMM v2 pool" : `${dbc.reserveSol.toFixed(2)} / ${dbc.targetSol.toFixed(2)} SOL`}
                    </span>
                  </p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-[#d7ff00] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${dbc.progress * 100}%` }} />
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    {poolError ? "RPC reconnecting, showing last confirmed state" : `Confirmed pool state${poolCheckedAt ? ` · ${new Date(poolCheckedAt).toLocaleTimeString("en-MY", { hour12: false })}` : ""}`}
                  </p>
                </>
              ) : (
                <p className="text-xs text-zinc-500">Waiting for confirmed pool data…</p>
              )}
              <a href={explorer(token.dbcPool)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-[#d7ff00]">
                View pool on Solana <ExternalLink className="size-3" />
              </a>
            </div>
          )}
          {token.dbcPool && <FlywheelPanel characterId={characterId} />}
          <AgentFundSlide characterId={characterId} mint={token.mint} name={character.name} />
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-white">Top holders</h2>
              <a href={explorer(character.ownerWallet)} target="_blank" rel="noreferrer" title={character.ownerWallet} className="font-sans text-[11px] text-zinc-500 hover:text-[#d7ff00]">
                Dev {short(character.ownerWallet)}
              </a>
            </div>
            {!onChain ? (
              <p className="text-xs leading-relaxed text-zinc-600">This character has a paper token. No on-chain holders exist for it yet.</p>
            ) : chainError ? (
              <p role="alert" className="text-xs text-amber-300">{chainError}</p>
            ) : chain?.available ? (
              <div className="divide-y divide-white/[0.06]">
                {chain.holders?.slice(0, 5).map((holder, i) => (
                  <a key={holder.wallet} href={explorer(holder.wallet)} target="_blank" rel="noreferrer" className="flex items-center justify-between py-2 text-[12px] transition-colors hover:text-white">
                    <span className="flex items-center gap-2 font-sans tabular-nums text-zinc-400"><span className="w-4 text-zinc-600">{i + 1}</span>{holderIdentity(holder.wallet)}</span>
                    <span className="font-sans tabular-nums text-zinc-200">{(Number(holder.units) / 10 ** (chain.supply?.decimals ?? 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </a>
                ))}
              </div>
            ) : (
              <Loader2 className="size-4 animate-spin text-zinc-600" />
            )}
          </div>
          <XFeedPanel xUrl={character.xUrl} name={character.name} />
          <MarketLiveCam characterId={characterId} name={character.name} imageUrl={character.referenceImageUrl} />
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
  flash,
}: {
  label: string;
  value: string;
  big?: boolean;
  /** Raw lamports behind `value`: when it moves, the figure flashes green (up) or red (down). */
  flash?: string;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] text-zinc-500">{label}</p>
      <p
        className={`market-sidebar-text ${big ? "text-xl font-semibold" : "text-sm font-medium"} text-white`}
      >
        {flash ? <LiveValue value={flash} display={value} /> : value}
      </p>
    </div>
  );
}
