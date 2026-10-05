import { describe, it, expect } from "vitest";
import {
  type TxHistoryRow,
  type OnchainUsdcTransfer,
  type RewardSubmission,
  sortTxHistoryDesc,
  dedupeTxBySignature,
  onchainTransfersToDepositRows,
  submissionToRewardRow,
  buildTransactionHistory,
} from "./transactionHistory";
import { buildInflight } from "./settlementSentinel";

const row = (over: Partial<TxHistoryRow>): TxHistoryRow => ({
  id: over.id ?? "x",
  ts: over.ts ?? 0,
  kind: over.kind ?? "spend",
  label: over.label ?? "Spent · x",
  amountUsdc: over.amountUsdc ?? -1,
  token: "USDC",
  ...(over.txSignature ? { txSignature: over.txSignature } : {}),
  ...(over.status ? { status: over.status } : {}),
});

describe("sortTxHistoryDesc", () => {
  it("orders newest-first and does not mutate the input", () => {
    const input = [row({ id: "a", ts: 100 }), row({ id: "b", ts: 300 }), row({ id: "c", ts: 200 })];
    const out = sortTxHistoryDesc(input);
    expect(out.map((r) => r.id)).toEqual(["b", "c", "a"]);
    // original untouched (frozen-result safety)
    expect(input.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("tolerates a frozen input array", () => {
    const frozen = Object.freeze([row({ id: "a", ts: 1 }), row({ id: "b", ts: 2 })]) as TxHistoryRow[];
    expect(() => sortTxHistoryDesc(frozen)).not.toThrow();
    expect(sortTxHistoryDesc(frozen).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("dedupeTxBySignature", () => {
  it("keeps the FIRST occurrence of a signature (internal wins over on-chain)", () => {
    const internal = row({ id: "internal", kind: "withdraw", txSignature: "SIG1" });
    const onchain = row({ id: "deposit:SIG1", kind: "deposit", txSignature: "SIG1" });
    const out = dedupeTxBySignature([internal, onchain]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("internal");
  });

  it("keeps every row without a signature", () => {
    const out = dedupeTxBySignature([
      row({ id: "s1", kind: "spend" }),
      row({ id: "s2", kind: "spend" }),
      row({ id: "p", kind: "sweep", status: "pending" }),
    ]);
    expect(out).toHaveLength(3);
  });

  it("dedupes across three rows sharing one sig, keeps distinct sigs", () => {
    const out = dedupeTxBySignature([
      row({ id: "a", txSignature: "SIG1" }),
      row({ id: "b", txSignature: "SIG2" }),
      row({ id: "c", txSignature: "SIG1" }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("onchainTransfersToDepositRows", () => {
  const t = (over: Partial<OnchainUsdcTransfer>): OnchainUsdcTransfer => ({
    signature: over.signature ?? "SIG",
    amountUsdc: over.amountUsdc ?? 5,
    ...(over.from ? { from: over.from } : {}),
    ...(over.to ? { to: over.to } : {}),
    ...("blockTime" in over ? { blockTime: over.blockTime } : {}),
    ...(over.direction ? { direction: over.direction } : {}),
  });

  it("keeps only INCOMING transfers via the direction flag", () => {
    const out = onchainTransfersToDepositRows([
      t({ signature: "IN", direction: "in", amountUsdc: 10 }),
      t({ signature: "OUT", direction: "out", amountUsdc: 3 }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["deposit:IN"]);
    expect(out[0].amountUsdc).toBe(10); // signed positive (credit)
    expect(out[0].kind).toBe("deposit");
    expect(out[0].label).toBe("Deposit");
    expect(out[0].txSignature).toBe("IN");
  });

  it("falls back to `to === agentWallet` when direction is absent", () => {
    const out = onchainTransfersToDepositRows(
      [
        t({ signature: "TOME", to: "WALLET", amountUsdc: 2 }),
        t({ signature: "TOOTHER", to: "SOMEONE", amountUsdc: 2 }),
      ],
      "WALLET",
    );
    expect(out.map((r) => r.id)).toEqual(["deposit:TOME"]);
  });

  it("converts second-based blockTime to epoch ms", () => {
    const [r] = onchainTransfersToDepositRows([t({ signature: "S", direction: "in", blockTime: 1_700_000_000 })]);
    expect(r.ts).toBe(1_700_000_000_000);
  });

  it("passes through already-ms blockTime unchanged", () => {
    const [r] = onchainTransfersToDepositRows([t({ signature: "S", direction: "in", blockTime: 1_700_000_000_000 })]);
    expect(r.ts).toBe(1_700_000_000_000);
  });

  it("drops zero/negative/non-finite amounts and sig-less rows", () => {
    const out = onchainTransfersToDepositRows([
      t({ signature: "Z", direction: "in", amountUsdc: 0 }),
      t({ signature: "N", direction: "in", amountUsdc: -5 }),
      t({ signature: "", direction: "in", amountUsdc: 5 }),
    ]);
    expect(out).toHaveLength(0);
  });
});

describe("submissionToRewardRow", () => {
  const sub = (over: Partial<RewardSubmission>): RewardSubmission => ({
    _id: over._id ?? "sub1",
    ...(over.paidUsdc !== undefined ? { paidUsdc: over.paidUsdc } : {}),
    ...(over.payoutTxSignature ? { payoutTxSignature: over.payoutTxSignature } : {}),
    ...(over.campaignName ? { campaignName: over.campaignName } : {}),
    ...(over.postUrl ? { postUrl: over.postUrl } : {}),
    ...(over.verifiedAt !== undefined ? { verifiedAt: over.verifiedAt } : {}),
    ...(over.postedAt !== undefined ? { postedAt: over.postedAt } : {}),
    ...(over._creationTime !== undefined ? { _creationTime: over._creationTime } : {}),
  });

  it("maps a paid submission to the agent NET reward (after the 10% protocol fee)", () => {
    // paidUsdc is the GROSS accrued; the row shows the agent's 90% net share —
    // what actually credits the wallet.
    const row = submissionToRewardRow(sub({ _id: "s", paidUsdc: 0.0005, verifiedAt: 123 }));
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("reward");
    expect(row!.amountUsdc).toBeCloseTo(0.00045, 9); // 0.0005 gross × 90% = net to agent
    expect(row!.label).toBe("Campaign reward");
    expect(row!.ts).toBe(123);
    expect(row!.token).toBe("USDC");
    expect(row!.status).toBe("paid");
  });

  it("returns null when nothing has been paid on-chain yet", () => {
    expect(submissionToRewardRow(sub({ paidUsdc: 0 }))).toBeNull();
    expect(submissionToRewardRow(sub({}))).toBeNull(); // paidUsdc absent
    expect(submissionToRewardRow(sub({ paidUsdc: -1 }))).toBeNull();
  });

  it("attaches a real payout signature (deep-link + dedupe key)", () => {
    const row = submissionToRewardRow(sub({ paidUsdc: 2, payoutTxSignature: "REALSIG123" }));
    expect(row!.txSignature).toBe("REALSIG123");
  });

  it("never surfaces an INFLIGHT sentinel as a signature", () => {
    const inflight = buildInflight("tok", Date.now() + 60_000);
    const row = submissionToRewardRow(sub({ paidUsdc: 2, payoutTxSignature: inflight }));
    expect(row!.txSignature).toBeUndefined();
  });

  it("uses the campaign name in the label when provided", () => {
    const row = submissionToRewardRow(sub({ paidUsdc: 1, campaignName: "Summer Clips" }));
    expect(row!.label).toBe("Campaign reward · Summer Clips");
  });

  it("carries the post URL when the submission has one (so the UI can deep-link)", () => {
    const row = submissionToRewardRow(
      sub({ paidUsdc: 1, postUrl: "https://instagram.com/p/abc123" }),
    );
    expect(row!.postUrl).toBe("https://instagram.com/p/abc123");
  });

  it("omits postUrl when the submission has none", () => {
    const row = submissionToRewardRow(sub({ paidUsdc: 1 }));
    expect(row!.postUrl).toBeUndefined();
  });

  it("falls back postedAt → _creationTime for the timestamp", () => {
    expect(submissionToRewardRow(sub({ paidUsdc: 1, postedAt: 55 }))!.ts).toBe(55);
    expect(submissionToRewardRow(sub({ paidUsdc: 1, _creationTime: 77 }))!.ts).toBe(77);
  });

  it("dedupes against an on-chain deposit sharing the payout signature", () => {
    // The claim_payout transfer also shows up as an incoming on-chain deposit;
    // the reward row (internal, richer) must win and the deposit copy drop.
    const reward = submissionToRewardRow(sub({ _id: "s", paidUsdc: 5, payoutTxSignature: "PAYSIG", verifiedAt: 10 }))!;
    const deposit = onchainTransfersToDepositRows([
      { signature: "PAYSIG", direction: "in", amountUsdc: 5, blockTime: 10 },
    ]);
    const out = buildTransactionHistory([reward], deposit);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("s");
    expect(out[0].kind).toBe("reward");
  });
});

describe("buildTransactionHistory", () => {
  it("merges internal + on-chain, dedupes by sig (internal wins), sorts desc", () => {
    const internal = [
      row({ id: "spend", kind: "spend", ts: 50, amountUsdc: -2 }),
      row({ id: "withdraw", kind: "withdraw", ts: 200, amountUsdc: -10, txSignature: "SIGW" }),
    ];
    const onchain = onchainTransfersToDepositRows([
      { signature: "SIGD", direction: "in", amountUsdc: 25, blockTime: 100 }, // ts=100_000
      { signature: "SIGW", direction: "in", amountUsdc: 10, blockTime: 200 }, // dup of the withdraw sig — dropped
    ]);
    const out = buildTransactionHistory(internal, onchain);
    // SIGW dedup drops the on-chain copy → 3 rows
    expect(out).toHaveLength(3);
    // newest-first: deposit(100_000) > withdraw(200) > spend(50)
    expect(out.map((r) => r.id)).toEqual(["deposit:SIGD", "withdraw", "spend"]);
    // the surviving SIGW row is the internal withdraw (negative), not the deposit
    const sigw = out.find((r) => r.txSignature === "SIGW");
    expect(sigw?.id).toBe("withdraw");
    expect(sigw?.amountUsdc).toBe(-10);
  });

  it("caps the result length", () => {
    const many = Array.from({ length: 250 }, (_, i) => row({ id: `r${i}`, ts: i }));
    expect(buildTransactionHistory(many, [], 100)).toHaveLength(100);
    expect(buildTransactionHistory(many, [], 0)).toHaveLength(250); // no cap
  });

  it("returns the internal list unchanged when there are no on-chain rows", () => {
    const internal = [row({ id: "a", ts: 2 }), row({ id: "b", ts: 1 })];
    expect(buildTransactionHistory(internal).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
