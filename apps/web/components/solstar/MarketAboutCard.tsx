"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Globe } from "lucide-react";

type Trade = { wallet: string; side: string; lamports: string; createdAt: number };
type Point = { time: number; price: number };

const FRAMES = [
  { id: "5m", label: "5M", ms: 5 * 60_000 },
  { id: "1h", label: "1H", ms: 60 * 60_000 },
  { id: "4h", label: "4H", ms: 4 * 60 * 60_000 },
  { id: "1d", label: "1D", ms: 24 * 60 * 60_000 },
] as const;

/** Change of the latest observed price against the price one timeframe ago. Null with too little history. */
function changeOver(points: Point[], ms: number, now: number): number | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const latest = sorted[sorted.length - 1];
  const cutoff = now - ms;
  const base = [...sorted].reverse().find((p) => p.time <= cutoff) ?? sorted[0];
  if (!base.price || base === latest) return null;
  return ((latest.price - base.price) / base.price) * 100;
}

function Pair({ left, right, leftValue, rightValue }: { left: string; right: string; leftValue: number; rightValue: number }) {
  const total = leftValue + rightValue;
  const l = total ? Math.max(4, (leftValue / total) * 100) : 50;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-semibold tabular-nums text-white">{left}</span>
        <span className="font-semibold tabular-nums text-white">{right}</span>
      </div>
      <div className="mt-1.5 flex h-[3px] gap-1">
        <span className="rounded-full bg-emerald-400" style={{ width: `${total ? l : 50}%` }} />
        <span className="flex-1 rounded-full bg-orange-500" />
      </div>
    </div>
  );
}

/** Phantom-style "About" card: bio, price change per timeframe, buys vs sells, and social links. */
export function MarketAboutCard({ name, ticker, bio, xUrl, websiteUrl, trades, points, formatLamports, showLinks = true, showAbout = true }: {
  name: string; ticker: string; bio: string; xUrl?: string; websiteUrl?: string; showLinks?: boolean; showAbout?: boolean;
  trades: Trade[] | undefined; points: Point[] | undefined; formatLamports: (lamports: string) => string;
}) {
  const [frame, setFrame] = useState<(typeof FRAMES)[number]["id"]>("1h");
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(timer); }, []);
  const safe = (u?: string) => (u && u.startsWith("https://") ? u : undefined);
  const x = safe(xUrl), site = safe(websiteUrl);

  const changes = useMemo(() => FRAMES.map((f) => [f.id, changeOver(points ?? [], f.ms, now)] as const), [points, now]);
  const active = FRAMES.find((f) => f.id === frame)!;
  const stats = useMemo(() => {
    const within = (trades ?? []).filter((t) => now - t.createdAt <= active.ms);
    const side = (s: string) => within.filter((t) => t.side === s);
    const vol = (arr: Trade[]) => arr.reduce((sum, t) => sum + BigInt(t.lamports || "0"), 0n);
    const buys = side("buy"), sells = side("sell");
    return {
      buys: buys.length, sells: sells.length,
      buyVol: vol(buys), sellVol: vol(sells),
      buyers: new Set(buys.map((t) => t.wallet)).size, sellers: new Set(sells.map((t) => t.wallet)).size,
    };
  }, [trades, active.ms, now]);

  const chipCls = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 text-[12px] font-semibold text-zinc-200 transition-colors hover:border-white/25 hover:text-white";
  return (
    <section aria-label={`${showAbout ? "About" : "Market activity for"} ${name}`} className="mb-3 px-4 py-2">
      {showAbout && <>
      <h2 className="text-[17px] font-semibold tracking-tight text-white">About {name}</h2>
      <p className={`mt-1.5 text-[13px] leading-5 text-zinc-400 ${expanded ? "" : "line-clamp-2"}`}>{bio || `${name} is an AI character on Solcameo.`}</p>
      </>}

      <div className="mt-3.5 grid grid-cols-4 gap-1.5" role="tablist" aria-label="Timeframe">
        {FRAMES.map((f, i) => {
          const c = changes[i][1];
          const on = frame === f.id;
          return (
            <button key={f.id} type="button" role="tab" aria-selected={on} onClick={() => setFrame(f.id)}
              className={`px-1 py-2 text-center transition-colors ${on ? "text-white" : "text-zinc-400 hover:text-white"}`}>
              <span className="block text-[12px] text-zinc-400">{f.label}</span>
              <span className={`mt-0.5 inline-flex items-center gap-0.5 text-[13px] font-semibold tabular-nums ${c == null ? "text-zinc-600" : c >= 0 ? "text-emerald-400" : "text-orange-400"}`}>
                {c != null && (c >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />)}
                {c == null ? "—" : `${Math.abs(c).toFixed(2)}%`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-3.5">
        <Pair left={`${stats.buys} buys`} right={`${stats.sells} sells`} leftValue={stats.buys} rightValue={stats.sells} />
        <Pair left={`${formatLamports(stats.buyVol.toString())} vol.`} right={`${formatLamports(stats.sellVol.toString())} vol.`} leftValue={Number(stats.buyVol)} rightValue={Number(stats.sellVol)} />
        <Pair left={`${stats.buyers} buyers`} right={`${stats.sellers} sellers`} leftValue={stats.buyers} rightValue={stats.sellers} />
      </div>
      <p className="mt-2 text-[10px] text-zinc-600">From recent confirmed pool transactions. Price change needs recorded price history.</p>

      {showLinks && <div className="mt-4 flex flex-wrap gap-2">
        {site && <a href={site} target="_blank" rel="noopener noreferrer" className={chipCls}><Globe className="size-3.5" />Website</a>}
        {x && (
          <a href={x} target="_blank" rel="noopener noreferrer" className={chipCls}>
            <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>Twitter
          </a>
        )}
        <a href={`https://x.com/search?q=${encodeURIComponent(`$${ticker}`)}&f=live`} target="_blank" rel="noopener noreferrer" className={chipCls}>
          Search on
          <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
        </a>
      </div>}
      {showAbout && (bio?.length ?? 0) > 90 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mx-auto mt-3 block rounded-lg bg-white/[0.06] px-3.5 py-1.5 text-[12px] font-semibold text-zinc-300 transition-colors hover:text-white">
          {expanded ? "View less" : "View more"}
        </button>
      )}
    </section>
  );
}
