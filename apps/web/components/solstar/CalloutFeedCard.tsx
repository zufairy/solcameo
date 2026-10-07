"use client";
/* eslint-disable @next/next/no-img-element -- hosted character portraits */
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { CalloutCardData } from "@/lib/client/calloutCard";
import { compact } from "@/lib/client/calloutCard";
import { calloutTheme } from "@/lib/solstar/callout";
import { CalloutThemeCanvas } from "./CalloutThemeCanvas";

/** Eases a number up to its value so a new figure arrives instead of snapping. */
function useCountUp(target: number | undefined, ms = 800) {
  const [value, setValue] = useState<number | undefined>(target);
  const from = useRef(0);
  useEffect(() => {
    if (target == null || !Number.isFinite(target)) { setValue(target); return; } // eslint-disable-line react-hooks/set-state-in-effect
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setValue(target); return; }
    const start = performance.now(), begin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - p) ** 4;
      const next = begin + (target - begin) * eased;
      from.current = next;
      setValue(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

const usd = (v: number, signed: boolean) => {
  const abs = Math.abs(v);
  const text = abs >= 1e6 ? `${(abs / 1e6).toFixed(2)}M` : abs >= 1e4 ? `${(abs / 1e3).toFixed(1)}K` : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? "−" : signed ? "+" : ""}$${text}`;
};

/** What the big figure is, whether the number is in dollars, and the label that goes with it. */
function headline(d: CalloutCardData) {
  const metric = d.metric ?? "earnings";
  if (metric === "views") return { amount: d.views, label: "Tracked views", money: false, signed: false, pending: false };
  if (metric === "trade") {
    const known = d.tradePnlUsd != null;
    return { amount: known ? d.tradePnlUsd : undefined, label: d.onchainTrade ? "Position P&L" : "Net P&L", money: true, signed: true, pending: !known && !!d.onchainTrade };
  }
  return { amount: d.earningsUsd, label: "Lifetime earnings", money: true, signed: false, pending: false };
}

/**
 * The callout card: a living gradient mesh in the theme's colour behind a clean glass layout. Large figure in USD, readable
 * type, no overlay and no pixel effects. `size="large"` is the popup version with the market stats underneath.
 */
export function CalloutFeedCard({ data, bare = false, size = "feed" }: { data: CalloutCardData; bare?: boolean; size?: "feed" | "large" }) {
  const theme = calloutTheme(data.theme);
  const h = headline(data);
  const animated = useCountUp(h.amount);
  const negative = h.money && h.signed && (h.amount ?? 0) < 0;
  const accent = negative ? "#fb7185" : theme.accent;
  const large = size === "large";
  const shown = h.pending ? "···" : animated == null || !Number.isFinite(animated) ? "—" : h.money ? usd(animated, h.signed) : compact(Math.round(animated));
  const hasChange = typeof data.changePct === "number" && Number.isFinite(data.changePct);
  const up = (data.changePct ?? 0) >= 0;
  const sub = (data.metric ?? "earnings") === "views"
    ? `${data.videos ?? "—"} ${data.videos === 1 ? "video" : "videos"}`
    : data.metric === "trade"
      ? data.onchainTrade ? `${data.onchainTrade.side === "buy" ? "Bought" : "Sold"} · ${data.onchainTrade.network}` : data.trader && data.unselectedPreview ? "Select a coin" : "User reported"
      : data.monthlyEarningsUsd != null ? `${usd(data.monthlyEarningsUsd, false)} last 30 days` : "";

  return (
    <div
      aria-label={`${data.name}, ${data.ticker}, ${shown}, ${h.label}`}
      className={`callout-card @container/card group/card relative isolate w-full overflow-hidden text-white ${bare ? "" : "rounded-[4px] border border-white/[0.12]"} ${large ? "min-h-[240px]" : "min-h-[104px]"}`}
      style={{ background: theme.background }}
    >
      {/* Living background: three slow colour fields, then a fine grain. Nothing darkens the card. */}
      <div aria-hidden className="callout-mesh pointer-events-none absolute inset-0 -z-10 opacity-60" style={{ ["--callout-accent" as string]: accent }}>
        <span className="callout-blob callout-blob-a" />
        <span className="callout-blob callout-blob-b" />
        <span className="callout-blob callout-blob-c" />
        <span className="callout-grain" />
      </div>
      {/* The theme's own three.js animation (Solana mark, race car, frog, candles, diamond). */}
      <CalloutThemeCanvas theme={theme.key} accent={theme.accent} className={large ? "-z-[5] opacity-45" : "-z-[5]"} />
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />

      <div className={`flex h-full flex-col ${large ? "gap-6 p-6" : "gap-2 p-3"}`}>
        <div className={`flex min-w-0 items-center justify-between ${large ? "gap-6" : "gap-4"}`}>
          <div className={`flex min-w-0 items-center ${large ? "gap-3.5" : "gap-3"}`}>
            <img src={data.imageUrl || "/brand/solcameo-mark.png"} alt="" loading="lazy"
              className={`shrink-0 rounded-[5px] bg-white/10 object-cover shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)] ring-1 ring-white/25 ${large ? "size-20" : "size-11"}`} />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`truncate font-semibold tracking-tight ${large ? "text-[22px]" : "text-[14.5px]"}`}>{data.name}</span>
                <span className="shrink-0 rounded-[3px] border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tracking-wide text-white/90 backdrop-blur-sm">${data.ticker.replace(/^\$/, "")}</span>
              </div>
              <p className={`mt-1 line-clamp-2 text-white/75 ${large ? "text-[14.5px] leading-6" : "text-[12px] leading-4"} [text-shadow:0_1px_8px_rgba(0,0,0,0.45)]`}>{data.body}</p>
            </div>
          </div>

          <div className="hidden shrink-0 text-right @[340px]/card:block">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-white/60">{h.label}</p>
            <p className={`mt-1 whitespace-nowrap font-semibold leading-none tracking-[-0.035em] tabular-nums ${large ? "text-[44px]" : "text-[26px]"} [text-shadow:0_2px_14px_rgba(0,0,0,0.5)]`} style={{ color: accent }}>{shown}</p>
            {sub && <p className="mt-1 text-[11px] tabular-nums text-white/65">{sub}</p>}
          </div>
        </div>

        {/* Narrow cards put the figure on its own line instead of squeezing it. */}
        <div className="flex items-end justify-between gap-3 @[340px]/card:hidden">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-white/60">{h.label}</p>
            <p className="mt-1 whitespace-nowrap text-[30px] font-semibold leading-none tracking-[-0.035em] tabular-nums" style={{ color: accent }}>{shown}</p>
          </div>
          {sub && <p className="pb-0.5 text-[11.5px] tabular-nums text-white/60">{sub}</p>}
        </div>

        {large && (
          <dl className="mt-auto grid grid-cols-3 gap-px overflow-hidden rounded-[3px] border border-white/[0.14] bg-white/[0.14] text-center">
            {[
              ["Market cap", data.cap || "—", "text-white"],
              [data.label === "SINCE CALL" ? "Since call" : "Since launch", hasChange ? `${up ? "+" : "−"}${Math.abs(data.changePct as number).toFixed(1)}%` : "—", hasChange ? (up ? "text-emerald-300" : "text-rose-300") : "text-white"],
              ["Videos", data.videos != null ? String(data.videos) : "—", "text-white"],
            ].map(([label, value, tone]) => (
              <div key={label} className="bg-white/[0.06] px-3 py-2.5 backdrop-blur-md">
                <dt className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/60">{label}</dt>
                <dd className={`mt-0.5 flex items-center justify-center gap-1 text-[15px] font-semibold tabular-nums ${tone}`}>
                  {label === "Since call" || label === "Since launch" ? (hasChange ? (up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />) : null) : null}{value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
