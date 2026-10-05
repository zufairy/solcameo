// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ create: vi.fn(), setData: vi.fn(), update: vi.fn(), fit: vi.fn(), remove: vi.fn() }));
vi.mock("lightweight-charts", () => ({
  CandlestickSeries: "candles", HistogramSeries: "volume", ColorType: { Solid: "solid" },
  createChart: m.create,
}));
import { TerminalChart } from "./TerminalChart";
it("updates live candles without rebuilding the chart or resetting the user's time range", async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  m.create.mockReturnValue({
    addSeries: (kind: string) => ({ setData: kind === "candles" ? m.setData : vi.fn(), update: kind === "candles" ? m.update : vi.fn(), applyOptions: vi.fn() }),
    priceScale: () => ({ applyOptions: vi.fn() }),
    timeScale: () => ({ subscribeVisibleLogicalRangeChange: vi.fn(), getVisibleLogicalRange: () => null, fitContent: m.fit }),
    remove: m.remove,
  });
  const root = createRoot(document.createElement("div"));
  const points = [{ time: 60000, price: 10 }, { time: 120000, price: 12 }];
  try {
    await act(async () => root.render(<TerminalChart points={points} minutes={1} mcap />));
    await act(async () => root.render(<TerminalChart points={[...points, { time: 150000, price: 13 }]} minutes={1} mcap />));
    expect(m.create).toHaveBeenCalledOnce(); expect(m.setData).toHaveBeenCalledOnce(); expect(m.fit).toHaveBeenCalledOnce();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ time: 120, close: 13 }));
    await act(async () => root.render(<TerminalChart points={points} minutes={1} mcap={false} />));
    expect(m.create).toHaveBeenCalledOnce(); expect(m.setData).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
  expect(m.remove).toHaveBeenCalledOnce();
});
