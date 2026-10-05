"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { candlesFromPoints } from "@/lib/solstar/terminal";
export function TerminalChart({
  points,
  minutes,
  mcap,
  supplyTokens = 1e9,
}: {
  points: Array<{
    time: number;
    price: number;
    volume?: number;
    side?: "buy" | "sell";
  }>;
  supplyTokens?: number;
  minutes: number;
  mcap: boolean;
}) {
  const [following, setFollowing] = useState(true);
  const previous = useRef<{
    view: string;
    candles: ReturnType<typeof candlesFromPoints>;
  } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fitted = useRef("");
  const histogram = useRef<ISeriesApi<"Histogram"> | null>(null);
  const volumes = useMemo(() => {
    const grouped = new Map<
      number,
      { time: UTCTimestamp; value: number; color: string }
    >();
    for (const p of points) {
      const time = Math.floor(p.time / (minutes * 60000)) * minutes * 60;
      const prior = grouped.get(time);
      grouped.set(time, {
        time: time as UTCTimestamp,
        value: (prior?.value ?? 0) + (p.volume ?? 0),
        color: p.side === "sell" ? "#f8717144" : "#5de39a44",
      });
    }
    return [...grouped.values()].sort((a, b) => a.time - b.time);
  }, [points, minutes]);
  const candles = useMemo(
    () => candlesFromPoints(points, minutes, mcap ? 1 : 1 / supplyTokens),
    [points, minutes, mcap, supplyTokens],
  );
  useEffect(() => {
    if (!container.current) return;
    const c = createChart(container.current, {
      autoSize: true,

      layout: {
        background: { type: ColorType.Solid, color: "#181a1c" },
        textColor: "#71717a",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#19191e" },
        horzLines: { color: "#19191e" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#242429",
      },
      rightPriceScale: { borderColor: "#242429" },
    });
    chart.current = c;
    series.current = c.addSeries(CandlestickSeries, {
      upColor: "#5de39a",
      downColor: "#f87171",
      wickUpColor: "#5de39a",
      wickDownColor: "#f87171",
      borderVisible: false,
      priceFormat: {
        type: "price",
        precision: 4,
        minMove: 0.0001,
      },
    });
    histogram.current = c.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    c.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
    });
    c.priceScale("right").applyOptions({
      scaleMargins: { top: 0.05, bottom: 0.2 },
    });
    c.timeScale().subscribeVisibleLogicalRangeChange(() => {
      const range = c.timeScale().getVisibleLogicalRange();
      const last = previous.current?.candles.length ?? 0;
      if (range && last) setFollowing(range.to >= last - 2);
    });
    return () => {
      previous.current = null;
      fitted.current = "";
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
      priceFormat: {
        type: "price",
        precision: mcap ? 4 : 9,
        minMove: mcap ? 0.0001 : 0.000000001,
      },
    });
    // Update the current candle without rebuilding the series or moving a panned chart.
    const appendOnly =
      prior?.view === view &&
      candles.length >= prior.candles.length &&
      prior.candles.length > 0 &&
      prior.candles
        .slice(0, -1)
        .every((c, i) => JSON.stringify(c) === JSON.stringify(candles[i]));
    if (appendOnly && prior) {
      for (const candle of candles.slice(prior.candles.length - 1))
        series.current?.update({
          ...candle,
          time: candle.time as UTCTimestamp,
        });
      for (const volume of volumes.filter(
        (v) => v.time >= prior.candles[prior.candles.length - 1].time,
      ))
        histogram.current?.update(volume);
    } else {
      series.current?.setData(
        candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })),
      );
      histogram.current?.setData(volumes);
    }
    previous.current = { view, candles };
    if (candles.length && fitted.current !== view) {
      chart.current?.timeScale().fitContent();
      fitted.current = view;
    }
  }, [candles, mcap, volumes, minutes, supplyTokens]);
  return (
    <div className="relative">
      <div ref={container} className="h-[clamp(240px,42dvh,430px)] w-full" />
      {!!candles.length && (
        <button
          type="button"
          onClick={() => {
            chart.current?.timeScale().scrollToRealTime();
            setFollowing(true);
          }}
          className={`absolute right-16 top-3 rounded border px-2 py-1 text-[10px] ${following ? "border-emerald-300/20 bg-[#181a1c] text-emerald-300" : "border-white/15 bg-[#202326] text-zinc-200"}`}
        >
          {following ? "Latest" : "Back to latest"}
        </button>
      )}
      {!candles.length && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-zinc-500">
          <span className="text-zinc-400">
            Waiting for confirmed price data
          </span>
          <span className="text-xs text-zinc-600">
            Candles follow pool prices. Volume reflects recorded app trades.
          </span>
        </div>
      )}
      <a
        href="https://www.tradingview.com/"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-1 left-3 text-[9px] text-zinc-600"
      >
        Charts by TradingView
      </a>
    </div>
  );
}
