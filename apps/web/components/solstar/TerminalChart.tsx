"use client";
import { useEffect, useMemo, useRef } from "react";
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
      height: 430,
      layout: {
        background: { type: ColorType.Solid, color: "#09090b" },
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
        precision: mcap ? 4 : 9,
        minMove: mcap ? 0.0001 : 0.000000001,
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
    return () => {
      histogram.current = null;
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, [mcap]);
  useEffect(() => {
    series.current?.setData(
      candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })),
    );
    histogram.current?.setData(volumes);
    const view = `${minutes}:${mcap}`;
    if (candles.length && fitted.current !== view) {
      chart.current?.timeScale().fitContent();
      fitted.current = view;
    }
  }, [candles, mcap, volumes, minutes]);
  return (
    <div className="relative">
      <div ref={container} className="h-[430px] w-full" />
      {!candles.length && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-zinc-500">
          <span className="text-zinc-400">
            Waiting for the first recorded trade
          </span>
          <span className="text-xs text-zinc-600">
            Price candles and volume appear as trades execute.
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
