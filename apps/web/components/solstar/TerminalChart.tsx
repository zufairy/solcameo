"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { candlesFromPoints } from "@/lib/solstar/terminal";

type Candle = { time: number; open: number; high: number; low: number; close: number };
const UP = "#26d98a";
const DOWN = "#f6525f";
/** Bars shown on first paint. Keeps a young coin from being zoomed into two fat candles. */
const WINDOW_BARS = 90;
const RIGHT_PAD_BARS = 6;
const MAX_FILL = 600;

/** Compact USD-style axis labels for market cap; full precision for per-token prices. */
function formatValue(value: number, mcap: boolean) {
  if (!Number.isFinite(value)) return "";
  if (mcap) {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
  }
  const abs = Math.abs(value);
  const digits = abs >= 1 ? 4 : abs >= 0.01 ? 6 : abs >= 0.0001 ? 8 : 10;
  return `$${value.toFixed(digits)}`;
}

/**
 * Makes the series read like a real DEX chart: every interval up to now has a candle
 * (quiet periods are flat at the last price) and each candle opens where the last one closed.
 * Gaps wider than MAX_FILL bars are left alone so a dead coin cannot create a huge series.
 */
function continuous(candles: Candle[], seconds: number, nowSeconds: number): Candle[] {
  if (!candles.length) return candles;
  const out: Candle[] = [];
  const push = (c: Candle) => out.push(c);
  for (let i = 0; i < candles.length; i++) {
    const current = { ...candles[i] };
    const prev = out[out.length - 1];
    if (prev) {
      const gap = (current.time - prev.time) / seconds - 1;
      if (gap > 0 && gap <= MAX_FILL)
        for (let g = 1; g <= gap; g++) push({ time: prev.time + g * seconds, open: prev.close, high: prev.close, low: prev.close, close: prev.close });
      const before = out[out.length - 1];
      current.open = before.close;
      current.high = Math.max(current.high, current.open);
      current.low = Math.min(current.low, current.open);
    }
    push(current);
  }
  const last = out[out.length - 1];
  const nowBar = Math.floor(nowSeconds / seconds) * seconds;
  const trailing = (nowBar - last.time) / seconds;
  if (trailing > 0 && trailing <= MAX_FILL)
    for (let g = 1; g <= trailing; g++) push({ time: last.time + g * seconds, open: last.close, high: last.close, low: last.close, close: last.close });
  return out;
}

export function TerminalChart({
  points,
  minutes,
  mcap,
  supplyTokens = 1e9,
  symbol,
}: {
  points: Array<{ time: number; price: number; volume?: number; side?: "buy" | "sell" }>;
  supplyTokens?: number;
  minutes: number;
  mcap: boolean;
  /** Shown in the chart legend, e.g. the coin ticker. */
  symbol?: string;
}) {
  const [following, setFollowing] = useState(true);
  const [legend, setLegend] = useState<Candle | null>(null);
  const [bucket, setBucket] = useState(() => Math.floor(Date.now() / (minutes * 60000)));
  const previous = useRef<{ view: string; candles: Candle[] } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const histogram = useRef<ISeriesApi<"Histogram"> | null>(null);
  const framed = useRef("");
  const mcapRef = useRef(mcap);
  const lastRef = useRef<Candle | null>(null);

  // Roll the live candle forward as time passes even when nobody trades.
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      setBucket((b) => {
        const next = Math.floor(Date.now() / (minutes * 60000));
        return next === b ? b : next;
      });
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [minutes]);

  const volumes = useMemo(() => {
    const grouped = new Map<number, { time: UTCTimestamp; value: number; color: string }>();
    for (const p of points) {
      const time = Math.floor(p.time / (minutes * 60000)) * minutes * 60;
      const prior = grouped.get(time);
      grouped.set(time, {
        time: time as UTCTimestamp,
        value: (prior?.value ?? 0) + (p.volume ?? 0),
        color: p.side === "sell" ? "#f6525f55" : "#26d98a55",
      });
    }
    return [...grouped.values()].sort((a, b) => a.time - b.time);
  }, [points, minutes]);

  const candles = useMemo(
    () => continuous(candlesFromPoints(points, minutes, mcap ? 1 : 1 / supplyTokens), minutes * 60, bucket * minutes * 60),
    // `bucket` re-runs this when a new interval begins so the live candle keeps advancing.
    [points, minutes, mcap, supplyTokens, bucket],
  );

  useEffect(() => {
    mcapRef.current = mcap;
  }, [mcap]);

  useEffect(() => {
    if (!container.current) return;
    const c = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#13151a" },
        textColor: "#8b8f98",
        fontSize: 11,
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.035)" },
        horzLines: { color: "rgba(255,255,255,0.045)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(255,255,255,0.28)", style: LineStyle.Dashed, labelBackgroundColor: "#2a2d35" },
        horzLine: { color: "rgba(255,255,255,0.28)", style: LineStyle.Dashed, labelBackgroundColor: "#2a2d35" },
      },
      localization: { priceFormatter: (v: number) => formatValue(v, mcapRef.current) },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "rgba(255,255,255,0.08)",
        rightOffset: RIGHT_PAD_BARS,
        barSpacing: 9,
        minBarSpacing: 3,
        fixLeftEdge: false,
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)", minimumWidth: 74 },
    });
    chart.current = c;
    series.current = c.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      priceLineStyle: LineStyle.Dotted,
      priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
      // Never let a flat young market autoscale into a hair-thin range: keep at least a 12% span.
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } | null; margins?: { above: number; below: number } } | null) => {
        const r = original();
        if (!r?.priceRange) return r;
        const { minValue, maxValue } = r.priceRange;
        const mid = (minValue + maxValue) / 2;
        const span = Math.max(maxValue - minValue, Math.abs(mid) * 0.12);
        return { ...r, priceRange: { minValue: mid - span / 2, maxValue: mid + span / 2 } };
      },
    });
    histogram.current = c.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    c.priceScale("volume").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    c.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.22 } });
    c.timeScale().subscribeVisibleLogicalRangeChange(() => {
      const range = c.timeScale().getVisibleLogicalRange();
      const last = previous.current?.candles.length ?? 0;
      if (range && last) setFollowing(range.to >= last - 2);
    });
    c.subscribeCrosshairMove((param) => {
      const data = param.seriesData.get(series.current as ISeriesApi<"Candlestick">) as Candle | undefined;
      setLegend(data && typeof data.open === "number" ? { time: Number(param.time), open: data.open, high: data.high, low: data.low, close: data.close } : null);
    });
    return () => {
      previous.current = null;
      framed.current = "";
      histogram.current = null;
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  useEffect(() => {
    const view = `${minutes}:${mcap}:${supplyTokens}`;
    const prior = previous.current;
    series.current?.applyOptions({
      priceFormat: { type: "price", precision: mcap ? 2 : 9, minMove: mcap ? 0.01 : 0.000000001 },
    });
    // Update the live candle in place so a panned or zoomed chart never jumps.
    const appendOnly =
      prior?.view === view &&
      candles.length >= prior.candles.length &&
      prior.candles.length > 0 &&
      prior.candles.slice(0, -1).every((c, i) => JSON.stringify(c) === JSON.stringify(candles[i]));
    if (appendOnly && prior) {
      for (const candle of candles.slice(prior.candles.length - 1))
        series.current?.update({ ...candle, time: candle.time as UTCTimestamp });
      for (const volume of volumes.filter((v) => v.time >= prior.candles[prior.candles.length - 1].time))
        histogram.current?.update(volume);
    } else {
      series.current?.setData(candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
      histogram.current?.setData(volumes);
    }
    previous.current = { view, candles };
    lastRef.current = candles[candles.length - 1] ?? null;
    if (candles.length && framed.current !== view) {
      // Frame a fixed window ending at the live edge, like a DEX, instead of fitting every bar.
      const n = candles.length;
      chart.current?.timeScale().setVisibleLogicalRange({ from: n - WINDOW_BARS, to: n - 1 + RIGHT_PAD_BARS });
      framed.current = view;
    }
  }, [candles, mcap, volumes, minutes, supplyTokens]);

  const shown = legend ?? lastRef.current ?? candles[candles.length - 1] ?? null;
  const delta = shown ? ((shown.close - shown.open) / (shown.open || 1)) * 100 : 0;
  const tone = delta >= 0 ? "text-[#26d98a]" : "text-[#f6525f]";
  const stat = (label: string, value: number) => (
    <span className="flex items-center gap-1">
      <span className="text-zinc-500">{label}</span>
      <span className={tone}>{formatValue(value, mcap)}</span>
    </span>
  );

  return (
    <div className="relative bg-[#13151a]">
      <div ref={container} className="h-[clamp(300px,48dvh,520px)] w-full" />
      {shown && (
        <div className="pointer-events-none absolute left-3 top-2.5 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums">
          <Badge variant="outline" className="h-5 rounded-[4px] border-white/10 bg-white/[0.04] px-1.5 text-[10px] font-semibold text-zinc-200">
            {symbol ? `${symbol} · ` : ""}
            {mcap ? "MCap" : "Price"} · {minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${minutes / 60}h` : "1D"}
          </Badge>
          {stat("O", shown.open)}
          {stat("H", shown.high)}
          {stat("L", shown.low)}
          {stat("C", shown.close)}
          <span className={tone}>
            {delta >= 0 ? "+" : ""}
            {delta.toFixed(2)}%
          </span>
        </div>
      )}
      <div className="absolute right-[88px] top-2 z-10 flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-[4px] bg-white/[0.04] px-1.5 py-1 text-[10px] font-medium text-zinc-300">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#26d98a] opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-1.5 rounded-full bg-[#26d98a]" />
          </span>
          Live
        </span>
        {!!candles.length && !following && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              chart.current?.timeScale().scrollToRealTime();
              setFollowing(true);
            }}
            className="h-6 gap-1 rounded-[4px] border-white/15 bg-[#1b1e25] px-2 text-[10px] text-zinc-200"
          >
            Latest <ArrowRight className="size-3" />
          </Button>
        )}
      </div>
      {!candles.length && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-zinc-500">
          <span className="text-zinc-400">Waiting for confirmed price data</span>
          <span className="text-xs text-zinc-600">Candles follow on-chain pool prices. Volume reflects recorded app trades.</span>
        </div>
      )}
    </div>
  );
}
