// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  route: undefined as unknown, terminal: undefined as unknown,
  chain: { market: undefined as unknown, swaps: undefined as unknown },
}));
vi.mock("convex/react", () => ({ useQuery: (ref: { _name?: string }, args: unknown) => (args === "skip" ? undefined : String(ref?._name).includes("characterForRoute") ? m.route : m.terminal) }));
vi.mock("@/convex/_generated/api", () => ({ api: { solstarMarket: { characterForRoute: { _name: "characterForRoute" }, terminal: { _name: "terminal" } } } }));
vi.mock("@/lib/client/useSolUsd", () => ({ useSolUsd: () => 100 }));
vi.mock("@/components/solstar/useChainMarket", () => ({ useChainMarket: () => m.chain }));
vi.mock("next/link", () => ({ default: ({ children, href, ...p }: { children: React.ReactNode; href: string }) => <a href={href} {...p}>{children}</a> }));
import { AgentMarketCard } from "./AgentMarketCard";

let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); m.route = undefined; m.terminal = undefined; m.chain = { market: undefined, swaps: undefined }; });
const render = () => act(async () => root.render(<AgentMarketCard mint="agent1" />));

it("renders nothing for an agent with no coin", async () => {
  m.route = null; await render();
  expect(host.innerHTML).toBe("");
});
it("shows live market cap in dollars with a chart line built from recent swaps", async () => {
  m.route = { characterId: "char1" };
  m.terminal = { character: { name: "Nova", referenceImageUrl: "https://x/i.png" }, token: { ticker: "NOVA", network: "mainnet", mint: "mint", dbcPool: "pool", solReserve: "0", tokenReserve: "0" }, stats: null };
  m.chain = {
    market: { state: { priceSol: 0.00002, supplyRaw: "1000000000000000", decimals: 6, slot: 1, syncedAt: Date.now() }, holders: [{ wallet: "W1", units: "1", supplyPct: 1, isPool: false }], positions: [] },
    swaps: [{ signature: "a", wallet: "W1", side: "buy", units: 1, sol: 2, priceSol: 0.00001, time: Date.now() - 1000 }, { signature: "b", wallet: "W1", side: "buy", units: 1, sol: 2, priceSol: 0.000015, time: Date.now() - 500 }],
  };
  await render();
  // price 0.00002 SOL × 1B supply = 20,000 SOL × $100 = $2M
  await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
  expect(host.textContent).toContain("$NOVA");
  expect(host.textContent).toContain("Market cap");
  expect(host.textContent).toMatch(/\$2(\.00)?M/);
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/market/char1");
  expect(host.querySelectorAll("svg path").length).toBeGreaterThanOrEqual(2);
  expect(host.textContent).toContain("+100.00%"); // 0.00001 → 0.00002 across the window
});
