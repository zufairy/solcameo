// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ data: undefined as unknown, wallet: "WALLET" as string | null, args: undefined as unknown }));
vi.mock("convex/react", () => ({ useQuery: (_fn: unknown, args: unknown) => { m.args = args; return args === "skip" ? undefined : m.data; } }));
vi.mock("@/convex/_generated/api", () => ({ api: { solstarChain: { positionOf: "positionOf" } } }));
vi.mock("@/hooks/use-solana-wallet", () => ({ useUnifiedSolanaWallet: () => ({ publicKey: m.wallet ? { toBase58: () => m.wallet } : null }) }));
vi.mock("@/lib/solana/network", () => ({ getNetwork: () => "mainnet-beta", getTxExplorerUrl: (s: string) => `https://solscan.io/tx/${s}` }));
import { PositionCard } from "./PositionCard";

let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); m.data = undefined; m.wallet = "WALLET"; });
const render = () => act(async () => root.render(<PositionCard characterId={"coin" as never} ticker="NOVA" network="mainnet" />));
const data = (priceSol: number) => ({
  priceSol, decimals: 6, syncedAt: Date.now(), heldUnits: String(5_000 * 1e6),
  position: { openTokens: 5000, costBasisSol: 0.02, realizedSol: 0, spentSol: 0.02, receivedSol: 0, trades: 1 },
  swaps: [{ signature: "sig1", side: "buy", units: 5000, sol: 0.02, priceSol: 0.000004, time: 1 }],
});

it("shows nothing without a wallet and reads Convex only for a connected one", async () => {
  m.wallet = null; await render();
  expect(host.innerHTML).toBe("");
  expect(m.args).toBe("skip");
});
it("never shows '-0': a loss too small to display reads as plain 0 in white", async () => {
  m.data = data(0.000004 - 1e-12); // price a hair under the entry price
  await render();
  expect(host.textContent).not.toContain("-0");
  expect(host.textContent).not.toContain("−0");
  expect(host.textContent).toContain("Your position");
});
it("shows the real P&L, percent and holdings with proper signs", async () => {
  m.data = data(0.0000038); // 5,000 tokens: value 0.019 vs cost 0.02 -> -0.001 SOL, -5%
  await render();
  const text = host.textContent ?? "";
  expect(text).toContain("−0.001");
  expect(text).toContain("−5%");
  expect(text).toContain("5K");
  expect(text).toContain("Close");
});
it("updates the moment Convex pushes a new price, without any fetch", async () => {
  vi.stubGlobal("fetch", vi.fn());
  m.data = data(0.000004);
  await render();
  m.data = data(0.000006);
  await render();
  await act(async () => { await new Promise((r) => setTimeout(r, 900)); }); // the number glides to its new value
  expect(host.textContent).toContain("+0.01");
  expect(fetch).not.toHaveBeenCalled();
});
it("explains an empty position and a market that has not synced yet", async () => {
  m.data = { ...data(0.000004), heldUnits: null, position: null, swaps: [] };
  await render();
  expect(host.textContent).toContain("No position in $NOVA yet");
  m.data = null;
  await render();
  expect(host.textContent).toContain("Syncing this market");
});
