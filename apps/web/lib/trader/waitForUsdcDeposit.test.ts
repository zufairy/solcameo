import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ calls: 0, reply: (): unknown => null }));
vi.mock("@solana/web3.js", () => ({ Connection: class { getParsedTransaction = async () => { m.calls++; return m.reply(); } } }));
vi.mock("./usdcTransfer", () => ({ getRpcConnection: () => ({}) }));
vi.mock("@/lib/solana/rpc", () => ({ rpcCandidates: () => ["https://a.test", "https://b.test"] }));
vi.mock("@/lib/solana/network", () => ({ getNetwork: () => "mainnet-beta" }));
import { waitForUsdcDeposit } from "./verifyUsdcDeposit";

const MINT = "USDC", TREASURY = "TREASURY", PAYER = "PAYER";
const tx = (credited: number, err: unknown = null) => ({ meta: { err, preTokenBalances: [{ owner: TREASURY, mint: MINT, uiTokenAmount: { uiAmount: 0 } }, { owner: PAYER, mint: MINT, uiTokenAmount: { uiAmount: 5 } }], postTokenBalances: [{ owner: TREASURY, mint: MINT, uiTokenAmount: { uiAmount: credited } }, { owner: PAYER, mint: MINT, uiTokenAmount: { uiAmount: 5 - credited } }] } });
const opts = { txSignature: "sig", escrowOwner: TREASURY, usdcMint: MINT, minAmountUsdc: 0.1, expectedSender: PAYER };
beforeEach(() => { m.calls = 0; m.reply = () => null; });

it("keeps polling until a just-sent payment shows up, then accepts it", async () => {
  m.reply = () => (m.calls > 6 ? tx(0.1) : null);
  await expect(waitForUsdcDeposit(opts, { maxMs: 5000 })).resolves.toEqual({ creditedUsdc: 0.1 });
  expect(m.calls).toBeGreaterThan(6);
});
it("rejects a payment that is on-chain but too small straight away, without waiting", async () => {
  m.reply = () => tx(0.05);
  const started = Date.now();
  await expect(waitForUsdcDeposit(opts, { maxMs: 20_000 })).rejects.toThrow(/credited/);
  expect(Date.now() - started).toBeLessThan(1000);
});
it("gives up with a not-found error when the transaction never appears", async () => {
  await expect(waitForUsdcDeposit(opts, { maxMs: 600 })).rejects.toThrow(/not found/);
});
