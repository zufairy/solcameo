// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecoveringBoundary } from "./RecoveringBoundary";

let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console, "error").mockImplementation(() => undefined); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("re-mounts after a crash and shows the page once the data has settled", async () => {
  let crashes = 1;
  const Page = () => { if (crashes-- > 0) throw new Error("fresh coin"); return <p>chart</p>; };
  await act(async () => root.render(<RecoveringBoundary fallback={<p>unavailable</p>} delayMs={100}><Page /></RecoveringBoundary>));
  expect(host.textContent).not.toContain("unavailable");
  await act(async () => { vi.advanceTimersByTime(150); });
  expect(host.textContent).toBe("chart");
});
it("gives up with the fallback after the retries are used", async () => {
  const Page = () => { throw new Error("always"); };
  await act(async () => root.render(<RecoveringBoundary fallback={<p>unavailable</p>} retries={2} delayMs={100}><Page /></RecoveringBoundary>));
  for (let i = 0; i < 3; i++) await act(async () => { vi.advanceTimersByTime(1000); });
  expect(host.textContent).toContain("unavailable");
});
