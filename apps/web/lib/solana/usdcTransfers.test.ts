import { describe, it, expect } from "vitest";
import {
  normalizeHeliusTransfers,
  normalizeParsedTransfers,
  dedupeTransfers,
  type HeliusEnrichedTx,
  type ParsedTxLike,
  type UsdcTransfer,
} from "./usdcTransfers";

const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // devnet USDC
const OTHER_MINT = "So11111111111111111111111111111111111111112"; // wSOL (must be filtered out)
const ME = "MEwaLLet1111111111111111111111111111111111";
const PEER = "PEeR2222222222222222222222222222222222222222";

describe("normalizeHeliusTransfers", () => {
  it("marks a transfer FROM the wallet as direction:out", () => {
    const txs: HeliusEnrichedTx[] = [
      { signature: "sigA", timestamp: 1000, tokenTransfers: [
        { fromUserAccount: ME, toUserAccount: PEER, mint: USDC, tokenAmount: 12.5 },
      ] },
    ];
    const rows = normalizeHeliusTransfers(txs, ME, USDC);
    expect(rows).toEqual<UsdcTransfer[]>([
      { signature: "sigA", from: ME, to: PEER, amountUsdc: 12.5, blockTime: 1000, direction: "out" },
    ]);
  });

  it("marks a transfer TO the wallet as direction:in", () => {
    const txs: HeliusEnrichedTx[] = [
      { signature: "sigB", timestamp: 2000, tokenTransfers: [
        { fromUserAccount: PEER, toUserAccount: ME, mint: USDC, tokenAmount: "7.25" },
      ] },
    ];
    const rows = normalizeHeliusTransfers(txs, ME, USDC);
    expect(rows).toEqual<UsdcTransfer[]>([
      { signature: "sigB", from: PEER, to: ME, amountUsdc: 7.25, blockTime: 2000, direction: "in" },
    ]);
  });

  it("filters out non-USDC token transfers", () => {
    const txs: HeliusEnrichedTx[] = [
      { signature: "sigC", timestamp: 3000, tokenTransfers: [
        { fromUserAccount: ME, toUserAccount: PEER, mint: OTHER_MINT, tokenAmount: 5 },
      ] },
    ];
    expect(normalizeHeliusTransfers(txs, ME, USDC)).toEqual([]);
  });

  it("ignores transfers the wallet is not a party to, and zero-amount legs", () => {
    const txs: HeliusEnrichedTx[] = [
      { signature: "sigD", timestamp: 4000, tokenTransfers: [
        { fromUserAccount: "AAA", toUserAccount: "BBB", mint: USDC, tokenAmount: 3 }, // not our wallet
        { fromUserAccount: ME, toUserAccount: PEER, mint: USDC, tokenAmount: 0 },     // zero
      ] },
    ];
    expect(normalizeHeliusTransfers(txs, ME, USDC)).toEqual([]);
  });

  it("keeps both distinct USDC legs of one multi-transfer tx", () => {
    const txs: HeliusEnrichedTx[] = [
      { signature: "sigE", timestamp: 5000, tokenTransfers: [
        { fromUserAccount: ME, toUserAccount: PEER, mint: USDC, tokenAmount: 1 },
        { fromUserAccount: ME, toUserAccount: "CCC", mint: USDC, tokenAmount: 2 },
      ] },
    ];
    const rows = normalizeHeliusTransfers(txs, ME, USDC);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.to)).toEqual([PEER, "CCC"]);
  });
});

describe("normalizeParsedTransfers (balance-diff)", () => {
  it("recovers an outgoing transfer + counterparty from balance deltas", () => {
    const txs: ParsedTxLike[] = [
      {
        signature: "sigX",
        blockTime: 9000,
        preTokenBalances: [
          { owner: ME, mint: USDC, uiAmount: 100 },
          { owner: PEER, mint: USDC, uiAmount: 0 },
        ],
        postTokenBalances: [
          { owner: ME, mint: USDC, uiAmount: 90 },
          { owner: PEER, mint: USDC, uiAmount: 10 },
        ],
      },
    ];
    expect(normalizeParsedTransfers(txs, ME, USDC)).toEqual<UsdcTransfer[]>([
      { signature: "sigX", from: ME, to: PEER, amountUsdc: 10, blockTime: 9000, direction: "out" },
    ]);
  });

  it("recovers an incoming transfer (direction flips, from = counterparty)", () => {
    const txs: ParsedTxLike[] = [
      {
        signature: "sigY",
        blockTime: 9100,
        preTokenBalances: [
          { owner: ME, mint: USDC, uiAmount: 5 },
          { owner: PEER, mint: USDC, uiAmount: 20 },
        ],
        postTokenBalances: [
          { owner: ME, mint: USDC, uiAmount: 12.5 },
          { owner: PEER, mint: USDC, uiAmount: 12.5 },
        ],
      },
    ];
    expect(normalizeParsedTransfers(txs, ME, USDC)).toEqual<UsdcTransfer[]>([
      { signature: "sigY", from: PEER, to: ME, amountUsdc: 7.5, blockTime: 9100, direction: "in" },
    ]);
  });

  it("ignores non-USDC mints when diffing", () => {
    const txs: ParsedTxLike[] = [
      {
        signature: "sigZ",
        blockTime: 9200,
        preTokenBalances: [{ owner: ME, mint: OTHER_MINT, uiAmount: 100 }],
        postTokenBalances: [{ owner: ME, mint: OTHER_MINT, uiAmount: 90 }],
      },
    ];
    expect(normalizeParsedTransfers(txs, ME, USDC)).toEqual([]);
  });

  it("skips a tx that did not change the wallet's USDC balance", () => {
    const txs: ParsedTxLike[] = [
      {
        signature: "sigW",
        blockTime: 9300,
        preTokenBalances: [
          { owner: "AAA", mint: USDC, uiAmount: 50 },
          { owner: "BBB", mint: USDC, uiAmount: 0 },
        ],
        postTokenBalances: [
          { owner: "AAA", mint: USDC, uiAmount: 40 },
          { owner: "BBB", mint: USDC, uiAmount: 10 },
        ],
      },
    ];
    expect(normalizeParsedTransfers(txs, ME, USDC)).toEqual([]);
  });

  it("leaves counterparty null when no opposite-sign owner is present (e.g. mint/airdrop)", () => {
    const txs: ParsedTxLike[] = [
      {
        signature: "sigM",
        blockTime: 9400,
        preTokenBalances: [],
        postTokenBalances: [{ owner: ME, mint: USDC, uiAmount: 25 }],
      },
    ];
    expect(normalizeParsedTransfers(txs, ME, USDC)).toEqual<UsdcTransfer[]>([
      { signature: "sigM", from: null, to: ME, amountUsdc: 25, blockTime: 9400, direction: "in" },
    ]);
  });
});

describe("dedupeTransfers", () => {
  it("collapses the same transfer seen from both the sender and receiver query", () => {
    const senderView: UsdcTransfer = { signature: "s1", from: ME, to: PEER, amountUsdc: 10, blockTime: 1, direction: "out" };
    const receiverView: UsdcTransfer = { signature: "s1", from: ME, to: PEER, amountUsdc: 10, blockTime: 1, direction: "in" };
    const deduped = dedupeTransfers([senderView, receiverView]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].signature).toBe("s1");
  });

  it("keeps two distinct legs of one signature (different recipients)", () => {
    const a: UsdcTransfer = { signature: "s2", from: ME, to: PEER, amountUsdc: 1, blockTime: 1, direction: "out" };
    const b: UsdcTransfer = { signature: "s2", from: ME, to: "CCC", amountUsdc: 2, blockTime: 1, direction: "out" };
    expect(dedupeTransfers([a, b])).toHaveLength(2);
  });
});
