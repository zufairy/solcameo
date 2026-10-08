import { beforeEach, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";

const m = vi.hoisted(() => ({ sendUsdc: vi.fn(), balances: vi.fn() }));
vi.mock("./usdcClient", () => ({ sendUsdc: m.sendUsdc }));
vi.mock("@/lib/solana/fundWallet", () => ({ fetchWalletBalances: m.balances, sendAndLand: vi.fn() }));
vi.mock("@/lib/solana/failoverConnection", () => ({ failoverConnection: () => ({}) }));
import { payAndPost } from "./walletPaid";

const key = Keypair.generate().publicKey;
const reply = (status: number, body: Record<string, unknown>) => ({ ok: status < 400, status, json: async () => body }) as Response;
const pay = (pending = { current: undefined as string | undefined }) => payAndPost<{ taskId?: string }>({ url: "/x", payload: {}, publicKey: key, signTransaction: (async (t: unknown) => t) as never, pending });
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers({ shouldAdvanceTime: true }); m.balances.mockResolvedValue({ sol: 1, usdc: 50 }); });

it("keeps going when the payment is sent but not yet confirmed, and starts the video", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(reply(402, { code: "payment_required", owedUsd: 1, treasury: "T" }))
    .mockResolvedValueOnce(reply(402, { code: "payment_unconfirmed", error: "We could not confirm your payment yet." }))
    .mockResolvedValueOnce(reply(200, { taskId: "task1" }));
  vi.stubGlobal("fetch", fetchMock);
  m.sendUsdc.mockResolvedValue({ ok: false, unconfirmed: true, signature: "SIG", error: "Payment sent. Confirming it on-chain…" });
  const pending = { current: undefined as string | undefined };
  await expect(pay(pending)).resolves.toEqual({ taskId: "task1" });
  expect(m.sendUsdc).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetchMock.mock.calls[2][1].body))).toMatchObject({ paymentSignature: "SIG", payMethod: "usdc" });
});

it("retries a transient start failure with the same signature instead of asking to pay again", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(reply(402, { code: "payment_required", owedUsd: 1, treasury: "T" }))
    .mockResolvedValueOnce(reply(502, { code: "start_failed", error: "could not start" }))
    .mockResolvedValueOnce(reply(200, { taskId: "task2" }));
  vi.stubGlobal("fetch", fetchMock);
  m.sendUsdc.mockResolvedValue({ ok: true, signature: "SIG2" });
  await expect(pay()).resolves.toEqual({ taskId: "task2" });
  expect(m.sendUsdc).toHaveBeenCalledTimes(1);
});

it("reuses a remembered payment without sending USDC again", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(reply(200, { taskId: "task3" }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(pay({ current: "swap:SIG3" })).resolves.toEqual({ taskId: "task3" });
  expect(m.sendUsdc).not.toHaveBeenCalled();
  expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ paymentSignature: "SIG3", payMethod: "swap" });
});

it("stops and tells the user when the wallet refuses to pay", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(402, { code: "payment_required", owedUsd: 1, treasury: "T" })));
  m.sendUsdc.mockResolvedValue({ ok: false, error: "Insufficient USDC." });
  await expect(pay()).rejects.toThrow("Insufficient USDC.");
});

it("opens the sign-in popup instead of failing silently when no wallet is connected", async () => {
  const onAuthNeeded = vi.fn();
  vi.stubGlobal("fetch", vi.fn());
  await expect(payAndPost({ url: "/x", payload: {}, publicKey: null, signTransaction: undefined, pending: { current: undefined }, onAuthNeeded })).rejects.toThrow(/sign in or connect a wallet/i);
  expect(onAuthNeeded).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
it("opens the sign-in popup when the session has expired (401)", async () => {
  const onAuthNeeded = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(401, { error: "Unauthorized" })));
  await expect(payAndPost({ url: "/x", payload: {}, publicKey: key, signTransaction: (async (t: unknown) => t) as never, pending: { current: undefined }, onAuthNeeded })).rejects.toThrow(/session expired/i);
  expect(onAuthNeeded).toHaveBeenCalledTimes(1);
  expect(m.sendUsdc).not.toHaveBeenCalled();
});
