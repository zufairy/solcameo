// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OpenTrades, countOpen } from "./OpenTrades";

type Props = React.ComponentProps<typeof OpenTrades>;
type Market = NonNullable<Props["market"]>;
const market = (): Market => ({
  state: { priceSol: 0.001, supplyRaw: "1000000000000000", decimals: 6, slot: 1, syncedAt: Date.now(), error: undefined },
  holders: [
    { wallet: "POOLVAULT1111111111", units: "600000000000000", supplyPct: 60, isPool: true },
    { wallet: "WHALE22222222222222", units: "100000000000000", supplyPct: 10, isPool: false },
    { wallet: "YOU333333333333333", units: "5000000000", supplyPct: 0.5, isPool: false },
  ],
  positions: [
    { wallet: "WHALE22222222222222", openTokens: 100_000_000, costBasisSol: 50_000, spentSol: 50_000, receivedSol: 0, realizedSol: 0, trades: 1, firstAt: 1, lastAt: Date.now() - 5000 },
    { wallet: "YOU333333333333333", openTokens: 5_000, costBasisSol: 10, realizedSol: 2, spentSol: 12, receivedSol: 4, trades: 3, firstAt: 1, lastAt: Date.now() - 90_000 },
  ],
});
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (props: Partial<Props>) => act(async () => root.render(<OpenTrades market={market()} you="YOU333333333333333" dev="DEV" usd={100} search="" ticker="TEST" identity={(w) => <span>{w.slice(0, 4)}</span>} explorer={(w) => `https://x/${w}`} {...props} />));

it("lists open positions without pool vaults, pins you first and flags profit and loss", async () => {
  await render({});
  const rows = [...host.querySelectorAll("tbody tr")];
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain("YOU3");
  expect(rows[0].textContent).toContain("You");
  expect(host.textContent).not.toContain("synced");
  expect(host.textContent).not.toContain("Held value");
  expect(host.textContent).not.toContain("POOL");
  // whale: 100M tokens × 0.001 = 100,000 SOL value vs 50,000 cost → profitable
  expect(rows[1].textContent).toContain("+");
});
it("counts the same wallets the table shows", () => { expect(countOpen(market())).toBe(2); expect(countOpen(undefined)).toBe(0); });
it("filters by wallet and explains an empty result", async () => {
  await render({ search: "nomatch" });
  expect(host.querySelectorAll("tbody tr")).toHaveLength(0);
  expect(host.textContent).toContain("No open trades match");
});
it("shows a loading state until the first sync lands", async () => {
  await render({ market: undefined });
  expect(host.querySelector('[aria-busy="true"]')).toBeTruthy();
  await render({ market: { ...market(), state: null } });
  expect(host.textContent).toContain("Syncing this market");
});
