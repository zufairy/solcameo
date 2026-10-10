"use client";

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Loader2, Radio, Search, Zap } from "lucide-react";
import type { FeedGraduation, FeedLaunch, FeedLiquidity, FeedSurge, FeedSwap, PulseWindow } from "@/lib/solami/pulseAggregate";
import type { StreamHealth } from "@/lib/solami/pulseHub";
import { usePoll } from "./usePoll";

type PulseData = {
  configured: boolean; now: number; stream: StreamHealth; window: PulseWindow;
  feeds: { launches: FeedLaunch[]; bigSwaps: (FeedSwap & { name?: string; symbol?: string })[]; surges: (FeedSurge & { symbol?: string })[]; graduations: (FeedGraduation & { symbol?: string })[]; liquidity: (FeedLiquidity & { symbol?: string })[] };
};
type Stat = { trades: number; buys: number; sells: number; traders: number; volumeUsd: number; priceUsd: number; changePct: number; buyPressure: number } | null;
type CoinsData = { configured: boolean; coins: { mint: string; ticker: string; name: string; m5: Stat; h1: Stat; h24: Stat }[] };
type Health = { active: string; providers: { provider: string; configured: boolean; ok: boolean; latencyMs: number | null; slot: number | null }[] };
type Landing = { error?: string; seenByBeam?: boolean; landing?: { is_landed: boolean; landed_via_jito: boolean; region: string | null; tip_lamports: number | null } | null };

const usd = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;
const price = (n: number) => !n ? "–" : n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toPrecision(3)}`;
const short = (s: string) => (s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s);
const ago = (ms: number, now: number) => { if (!now) return ""; const s = Math.max(0, Math.round((now - ms) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`; };
const tone = (n: number) => (n >= 0 ? "text-emerald-300" : "text-rose-300");
const solscan = (kind: "token" | "tx" | "account", v: string) => `https://solscan.io/${kind}/${v}`;

const Card = ({ title, aside, children, className = "" }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={`rounded-[22px] border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.05),rgba(255,255,255,0.012))] p-4 sm:p-5 ${className}`}>
    <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-white/55">{title}</h2>{aside}</div>
    {children}
  </section>
);
const Empty = ({ text }: { text: string }) => <p className="py-6 text-center text-[13px] text-white/40">{text}</p>;

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[12px] text-white/50">{label}</p>
      <p className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[32px]">{value}</p>
      {note && <p className="mt-2 text-[12px] text-white/45">{note}</p>}
    </div>
  );
}

function Bars({ rows }: { rows: { volumeUsd: number }[] }) {
  const peak = Math.max(1, ...rows.map((r) => r.volumeUsd));
  return (
    <div className="flex h-16 items-end gap-[3px]" role="img" aria-label="Volume per minute">
      {rows.map((r, i) => <span key={i} className="flex-1 rounded-[2px] bg-[#d7ff00]" style={{ height: `${Math.max(4, (r.volumeUsd / peak) * 100)}%`, opacity: 0.35 + 0.65 * (i / Math.max(1, rows.length - 1)) }} />)}
    </div>
  );
}

function StreamChip({ s, error }: { s: StreamHealth | undefined; error: boolean }) {
  const live = s?.state === "live";
  const label = error ? "Offline" : !s ? "Connecting" : s.state === "paused" ? "Paused" : live ? "Live" : "Connecting";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/80">
      <span className={`size-2 rounded-full ${live ? "animate-pulse bg-emerald-400" : "bg-amber-400"}`} />{label}
      {live && s && <span className="tabular-nums text-white/50">{s.messagesPerSecond}/s · {s.lagSeconds != null ? `${s.lagSeconds.toFixed(1)}s behind chain` : ""}</span>}
    </span>
  );
}

function LandingCheck() {
  const [sig, setSig] = useState(""); const [busy, setBusy] = useState(false); const [res, setRes] = useState<Landing | null>(null);
  const run = async () => {
    setBusy(true); setRes(null);
    try { setRes(await (await fetch(`/api/pulse/landing?signature=${encodeURIComponent(sig.trim())}`)).json()); } catch { setRes({ error: "lookup_failed" }); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="flex gap-2">
        <input value={sig} onChange={(e) => setSig(e.target.value)} placeholder="Paste a transaction signature" aria-label="Transaction signature" className="min-w-0 flex-1 rounded-full border border-white/12 bg-black/30 px-4 py-2 text-[13px] outline-none focus:border-[#d7ff00]/60" />
        <button type="button" onClick={run} disabled={busy || sig.trim().length < 64} className="inline-flex items-center gap-2 rounded-full bg-[#d7ff00] px-4 py-2 text-[13px] font-semibold text-[#10140a] disabled:opacity-40">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}Check
        </button>
      </div>
      {res && (
        <p className="mt-3 text-[13px] text-white/70">
          {res.error ? "Enter a valid signature." : !res.seenByBeam ? "Beam has no record of this signature. It was sent another way, so there is no Beam landing data." :
            `${res.landing?.is_landed ? "Landed" : "Not landed yet"}${res.landing?.landed_via_jito ? " via Jito" : ""}${res.landing?.region ? ` · region ${res.landing.region}` : ""}${res.landing?.tip_lamports ? ` · tip ${res.landing.tip_lamports.toLocaleString()} lamports` : ""}`}
        </p>
      )}
    </div>
  );
}

export function PulseDashboard() {
  const { data, error } = usePoll<PulseData>("/api/pulse", 2000);
  const { data: coins } = usePoll<CoinsData>("/api/pulse/coins", 20_000);
  const { data: health } = usePoll<Health>("/api/rpc-health", 15_000);
  const w = data?.window; const now = data?.now ?? 0; const f = data?.feeds;
  const netLiq = (w?.liquidityAddUsd ?? 0) - (w?.liquidityRemoveUsd ?? 0);
  const sym = (r: { symbol?: string; mint: string }) => r.symbol || short(r.mint);

  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 pb-24 pt-8 text-white sm:px-6 sm:pt-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.18em] text-[#d7ff00]"><Radio className="size-3.5" />Solana mainnet · real time</p>
          <h1 className="mt-2 text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[1.02] tracking-[-0.04em]">Solana pulse</h1>
          <p className="mt-2 max-w-xl text-[14px] leading-[1.55] text-white/55">Every trade, launch and liquidity move on Solana, decoded and aggregated live. Powered by Solami Blur, with Solami RPC underneath the whole app.</p>
        </div>
        <StreamChip s={data?.stream} error={error} />
      </header>

      {data && !data.configured && <p className="mt-6 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">Set SOLAMI_DATA_API_KEY on the server to turn the live stream on.</p>}
      {data?.stream.state === "paused" && <p className="mt-6 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">{data.stream.note}</p>}

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile label="Volume · 15 min" value={w ? usd(w.volumeUsd) : "–"} />
        <Tile label="Trades" value={w ? w.swaps.toLocaleString() : "–"} />
        <Tile label="Unique wallets" value={w ? w.uniqueWallets.toLocaleString() : "–"} />
        <Tile label="New tokens" value={w ? w.launches.toLocaleString() : "–"} note={w ? `${w.pools} new pools` : undefined} />
        <Tile label="Liquidity in" value={w ? usd(w.liquidityAddUsd) : "–"} />
        <Tile label="Liquidity out" value={w ? usd(w.liquidityRemoveUsd) : "–"} note={w ? `net ${netLiq >= 0 ? "+" : "-"}${usd(Math.abs(netLiq))}` : undefined} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Volume per minute" aside={<span className="text-[12px] text-white/40">last 15 min</span>}>
          {w && w.perMinute.length ? <Bars rows={w.perMinute} /> : <Empty text="Waiting for the first minute of trades" />}
          <div className="mt-4">
            <div className="flex justify-between text-[12px] text-white/55"><span>Buys {w ? Math.round(w.buyPressure * 100) : 50}%</span><span>Sells {w ? Math.round((1 - w.buyPressure) * 100) : 50}%</span></div>
            <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-rose-400/70"><span className="bg-emerald-400/80 transition-[width] duration-700" style={{ width: `${(w?.buyPressure ?? 0.5) * 100}%` }} /></div>
          </div>
        </Card>
        <Card title="Where the volume trades">
          {w?.dexes.length ? (
            <ul className="space-y-2">{w.dexes.map((d) => (
              <li key={d.dex} className="text-[13px]"><div className="flex justify-between"><span className="text-white/80">{d.dex}</span><span className="tabular-nums text-white/55">{usd(d.volumeUsd)}</span></div>
                <div className="mt-1 h-1 rounded-full bg-white/8"><div className="h-1 rounded-full bg-[#d7ff00]/80" style={{ width: `${(d.volumeUsd / w.dexes[0].volumeUsd) * 100}%` }} /></div></li>))}</ul>
          ) : <Empty text="No trades yet" />}
        </Card>
      </div>

      <Card title="Solcameo coins" className="mt-3" aside={<span className="text-[12px] text-white/40">5 min · 1 hour · 24 hours, from Blur</span>}>
        {!coins ? <Empty text="Loading coins" /> : coins.coins.length === 0 ? <Empty text="No live Solcameo coins on mainnet yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-[0.1em] text-white/40"><tr><th className="py-2 pr-3 font-medium">Coin</th><th className="pr-3 font-medium">Price</th><th className="pr-3 font-medium">5m</th><th className="pr-3 font-medium">1h</th><th className="pr-3 font-medium">24h</th><th className="pr-3 font-medium">24h volume</th><th className="pr-3 font-medium">Traders</th><th className="font-medium">Buy pressure</th></tr></thead>
              <tbody>{coins.coins.map((c) => (
                <tr key={c.mint} className="border-t border-white/8">
                  <td className="py-2.5 pr-3"><a href={`/market/${c.ticker.toLowerCase()}`} className="font-semibold hover:text-[#d7ff00]">${c.ticker}</a></td>
                  <td className="pr-3 tabular-nums">{price(c.h24?.priceUsd ?? 0)}</td>
                  {[c.m5, c.h1, c.h24].map((s, i) => <td key={i} className={`pr-3 tabular-nums ${s ? tone(s.changePct) : "text-white/30"}`}>{s ? `${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(1)}%` : "–"}</td>)}
                  <td className="pr-3 tabular-nums">{c.h24 ? usd(c.h24.volumeUsd) : "–"}</td>
                  <td className="pr-3 tabular-nums">{c.h24?.traders ?? "–"}</td>
                  <td className="tabular-nums">{c.h24 ? `${Math.round(c.h24.buyPressure * 100)}% buys` : "–"}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="New token launches" aside={<span className="text-[12px] text-white/40">as they mint</span>}>
          {f?.launches.length ? <ul className="divide-y divide-white/8">{f.launches.slice(0, 8).map((l) => (
            <li key={l.signature} className="flex items-center justify-between gap-3 py-2 text-[13px]">
              <div className="min-w-0"><p className="truncate font-semibold">{l.name || "Unnamed"} <span className="font-normal text-white/45">${l.symbol}</span></p><p className="text-[12px] text-white/40">{l.dex} · creator {short(l.creator)}</p></div>
              <a href={solscan("token", l.mint)} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-[12px] text-white/50 hover:text-white">{ago(l.at, now)}<ExternalLink className="size-3" /></a>
            </li>))}</ul> : <Empty text="Waiting for launches" />}
        </Card>
        <Card title="Surges and graduations" aside={<span className="text-[12px] text-white/40">breakouts vs 1h baseline</span>}>
          {f && (f.surges.length || f.graduations.length) ? <ul className="divide-y divide-white/8">
            {f.surges.slice(0, 5).map((s) => <li key={`s${s.mint}${s.at}`} className="flex items-center justify-between gap-3 py-2 text-[13px]"><span className="inline-flex items-center gap-2"><Zap className="size-4 text-[#d7ff00]" /><a href={solscan("token", s.mint)} target="_blank" rel="noreferrer" className="font-semibold hover:text-[#d7ff00]">{sym(s)}</a><span className="tabular-nums text-white/55">{s.multiple.toFixed(1)}x · {usd(s.volumeUsd)}</span></span><span className="text-[12px] text-white/40">{ago(s.at, now)}</span></li>)}
            {f.graduations.slice(0, 3).map((g) => <li key={`g${g.mint}${g.at}`} className="flex items-center justify-between gap-3 py-2 text-[13px]"><span>Graduated <a href={solscan("token", g.mint)} target="_blank" rel="noreferrer" className="font-semibold hover:text-[#d7ff00]">{sym(g)}</a> <span className="text-white/45">{g.from} to {g.to}</span></span><span className="text-[12px] text-white/40">{ago(g.at, now)}</span></li>)}
          </ul> : <Empty text="No breakouts in this window" />}
        </Card>
        <Card title="Top tokens by volume" aside={<span className="text-[12px] text-white/40">15 min</span>}>
          {w?.topTokens.length ? <ul className="divide-y divide-white/8">{w.topTokens.map((t) => (
            <li key={t.mint} className="flex items-center justify-between gap-3 py-2 text-[13px]">
              <a href={solscan("token", t.mint)} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold hover:text-[#d7ff00]">{t.symbol || short(t.mint)}</a>
              <span className="flex shrink-0 items-center gap-3 tabular-nums"><span className="text-white/55">{price(t.priceUsd)}</span><span>{usd(t.volumeUsd)}</span><span className={`inline-flex items-center ${tone(t.buyPressure - 0.5)}`}>{t.buyPressure >= 0.5 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{Math.round(t.buyPressure * 100)}%</span></span>
            </li>))}</ul> : <Empty text="No trades yet" />}
        </Card>
        <Card title="Large swaps and liquidity moves" aside={<span className="text-[12px] text-white/40">$5K+ swaps, $2K+ liquidity</span>}>
          {f && (f.bigSwaps.length || f.liquidity.length) ? <ul className="divide-y divide-white/8">
            {f.bigSwaps.slice(0, 5).map((s) => <li key={s.signature} className="flex items-center justify-between gap-3 py-2 text-[13px]"><span className={s.side === "buy" ? "text-emerald-300" : "text-rose-300"}>{s.side} <span className="text-white">{sym(s)}</span></span><a href={solscan("tx", s.signature)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 tabular-nums text-white/70 hover:text-white">{usd(s.usd)} · {ago(s.at, now)}<ExternalLink className="size-3" /></a></li>)}
            {f.liquidity.slice(0, 4).map((l) => <li key={l.signature} className="flex items-center justify-between gap-3 py-2 text-[13px]"><span className={l.kind === "add" ? "text-emerald-300" : "text-rose-300"}>liquidity {l.kind} <span className="text-white/70">{sym(l)}</span></span><a href={solscan("tx", l.signature)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 tabular-nums text-white/70 hover:text-white">{usd(l.usd)} · {ago(l.at, now)}<ExternalLink className="size-3" /></a></li>)}
          </ul> : <Empty text="No large moves yet" />}
        </Card>
      </div>

      <Card title="Infrastructure health" className="mt-3" aside={<span className="text-[12px] text-white/40">stream, RPC and transaction landing</span>}>
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <p className="text-[12px] text-white/45">Blur stream</p>
            <p className="mt-1 text-[15px] font-semibold">{data?.stream.state === "live" ? `Live · ${data.stream.region}` : (data?.stream.state ?? "connecting")}</p>
            <p className="mt-1 text-[12px] tabular-nums text-white/50">{data ? `${data.stream.messagesPerSecond} events/s · ${data.stream.totalMessages.toLocaleString()} received · ${data.stream.reconnects} reconnects` : ""}</p>
          </div>
          <div>
            <p className="text-[12px] text-white/45">RPC providers</p>
            <ul className="mt-1 space-y-1 text-[13px]">{health?.providers.map((p) => (
              <li key={p.provider} className="flex items-center justify-between"><span className="capitalize">{p.provider}{health.active === p.provider && <span className="ml-2 rounded-full bg-[#d7ff00] px-1.5 py-0.5 text-[10px] font-semibold text-[#10140a]">active</span>}</span><span className="tabular-nums text-white/55">{!p.configured ? "not set" : p.ok ? `${p.latencyMs} ms` : "down"}</span></li>)) ?? <li className="text-white/40">Checking</li>}</ul>
          </div>
          <div>
            <p className="mb-2 text-[12px] text-white/45">Did my transaction land? (Beam)</p>
            <LandingCheck />
          </div>
        </div>
      </Card>

      <p className="mt-6 text-[12px] leading-[1.6] text-white/40">Figures cover the stream since this server started watching, capped to the last 15 minutes. Solami products used: RPC and WebSocket, Blur realtime stream, Blur REST token stats, Beam landing lookup.</p>
    </main>
  );
}
