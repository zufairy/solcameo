// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  PublicKey,
  Keypair,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from "@solana/web3.js";
const m = vi.hoisted(() => ({
  prep: vi.fn(),
  query: vi.fn(),
  mutation: vi.fn(),
  pool: vi.fn(),
  rpc: {
    getLatestBlockhash: vi.fn(),
    getBlockHeight: vi.fn(),
    getBalance: vi.fn(),
    getGenesisHash: vi.fn().mockResolvedValue("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"),
    sendRawTransaction: vi.fn(),
    getTransaction: vi.fn(),
    getTokenSupply: vi.fn(),
    isBlockhashValid: vi.fn(),
    getSignatureStatuses: vi.fn(),
  },
}));
vi.mock("@/lib/server/solstarRoute", () => ({
  prepareAuthedJson: m.prep,
  convexClient: () => ({ query: m.query, mutation: m.mutation }),
  isConvexIdString: (v: unknown) => typeof v === "string" && v.length > 10,
}));
vi.mock("@/lib/server/imageStorage", () => ({
  putImage: async () => ({ url: "https://example.com/metadata" }),
}));
vi.mock("@/lib/server/meteoraLaunch", async (original) => ({
  ...(await original<typeof import("@/lib/server/meteoraLaunch")>()),
  dbcReadiness: () => ({ ready: true }),
  dbcConnection: () => m.rpc,
}));
vi.mock("@meteora-ag/dynamic-bonding-curve-sdk", async (original) => {
  const actual =
    await original<typeof import("@meteora-ag/dynamic-bonding-curve-sdk")>();
  return {
    ...actual,
    DynamicBondingCurveClient: class {
      partner = { createConfig: async () => new Transaction() };
      creator = { createPool: async () => new Transaction() };
      state = { getPool: m.pool };
    },
  };
});
import { POST } from "./route";
import { signDbcReceipt, type DbcReceipt } from "@/lib/server/meteoraLaunch";
import { DEFAULT_DBC } from "@/lib/meteora/options";
import { pumpMessageHash } from "@/lib/server/pumpLaunch";
const owner = Keypair.generate(),
  wallet = owner.publicKey.toBase58(),
  characterId = "sn7a6k41hx3j36h47xykvrdqcn8fn03f",
  blockhash = Keypair.generate().publicKey.toBase58();
function transaction(altered = false) {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: owner.publicKey,
      recentBlockhash: blockhash,
      instructions: altered
        ? [
            SystemProgram.transfer({
              fromPubkey: owner.publicKey,
              toPubkey: Keypair.generate().publicKey,
              lamports: 1,
            }),
          ]
        : [],
    }).compileToV0Message(),
  );
}
function receipt(
  tx: VersionedTransaction,
  stage: "config" | "pool" = "config",
): DbcReceipt {
  return {
    protocol: "meteora-dbc",
    wallet,
    characterId,
    mint: Keypair.generate().publicKey.toBase58(),
    config: Keypair.generate().publicKey.toBase58(),
    uri: "https://example.com/metadata",
    options: DEFAULT_DBC,
    network: "devnet",
    stage,
    messageHash: pumpMessageHash(tx),
    expires: Date.now() + 60000,
  };
}
async function request(body: unknown) {
  m.prep.mockResolvedValue({ ok: true, body, wallet, secret: "test" });
  return POST(
    new NextRequest("http://localhost/api/meteora/launch", { method: "POST" }),
  );
}
beforeEach(() => {
  m.rpc.getGenesisHash.mockResolvedValue("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  vi.clearAllMocks();
  vi.stubEnv("INTERNAL_CRON_SECRET", "test");
  vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "devnet");
  m.query.mockResolvedValue({
    character: { referenceImageUrl: "https://example.com/image" },
    token: { name: "Test", ticker: "TEST", description: "" },
  });
  m.rpc.getLatestBlockhash.mockResolvedValue({ blockhash });
  m.rpc.isBlockhashValid.mockResolvedValue({ value: true });
  m.rpc.getBalance.mockResolvedValue(1_000_000_000);
  vi.stubEnv("SOLCAMEO_DBC_TREASURY_SECRET", JSON.stringify([...Keypair.generate().secretKey]));
});
afterEach(() => vi.unstubAllEnvs());
describe("Meteora wallet launch", () => {
  it("requires authenticated wallet proof", async () => {
    m.prep.mockResolvedValue({
      ok: false,
      res: NextResponse.json({ error: "unauthorized" }, { status: 403 }),
    });
    expect((await POST(new NextRequest("http://localhost"))).status).toBe(403);
    expect(m.query).not.toHaveBeenCalled();
  });
  it("refuses to build a transaction when the wallet cannot cover the on-chain rent", async () => {
    m.rpc.getBalance.mockResolvedValue(171_067);
    const res = await request({
      action: "prepare",
      characterId,
      mint: Keypair.generate().publicKey.toBase58(),
      config: Keypair.generate().publicKey.toBase58(),
      options: DEFAULT_DBC,
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("INSUFFICIENT_SOL");
    expect(body.requiredLamports).toBeGreaterThan(171_067);
  });
  it("prepares config without sending a transaction", async () => {
    const res = await request({
      action: "prepare",
      characterId,
      mint: Keypair.generate().publicKey.toBase58(),
      config: Keypair.generate().publicKey.toBase58(),
      options: DEFAULT_DBC,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).stage).toBe("config");
    expect(m.rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(m.mutation).not.toHaveBeenCalled();
  });
  it("submits with the same confirmed commitment used to obtain the blockhash", async () => {
    const tx = transaction(); tx.sign([owner]);
    m.rpc.sendRawTransaction.mockResolvedValue("signature");
    const res = await request({action: "submit", receipt: signDbcReceipt(receipt(tx)), transaction: Buffer.from(tx.serialize()).toString("base64")});
    expect(res.status).toBe(200);
    expect(m.rpc.sendRawTransaction).toHaveBeenCalledWith(expect.any(Uint8Array), expect.objectContaining({preflightCommitment: "confirmed"}));
  });
  it("returns a recoverable expiry without broadcasting stale approvals", async () => {
    const tx = transaction(); tx.sign([owner]);
    m.rpc.isBlockhashValid.mockResolvedValue({value: false});
    const res = await request({action: "submit", receipt: signDbcReceipt(receipt(tx)), transaction: Buffer.from(tx.serialize()).toString("base64")});
    expect(m.rpc.isBlockhashValid).toHaveBeenCalledWith(blockhash, {commitment: "confirmed"});
    expect(res.status).toBe(409); expect((await res.json()).code).toBe("BLOCKHASH_EXPIRED");
    expect(m.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("keeps a not-yet-expired approval intact when an RPC is behind", async () => {
    const tx=transaction(); tx.sign([owner]);
    m.rpc.getSignatureStatuses.mockResolvedValue({value:[null]});
    m.rpc.isBlockhashValid.mockResolvedValue({value:false});
    m.rpc.getBlockHeight.mockResolvedValue(100);
    const r={...receipt(tx),lastValidBlockHeight:150};
    const res=await request({action:"submit",receipt:signDbcReceipt(r),transaction:Buffer.from(tx.serialize()).toString("base64")});
    expect((await res.json()).code).toBe("RPC_RETRY");expect(m.rpc.sendRawTransaction).not.toHaveBeenCalled();
    const refresh=await request({action:"refresh",receipt:signDbcReceipt(r),transaction:Buffer.from(tx.serialize()).toString("base64")});
    expect((await refresh.json()).code).toBe("RPC_RETRY");expect(m.rpc.getLatestBlockhash).not.toHaveBeenCalled();
  });
  it("rejects a transaction altered after review", async () => {
    const tx = transaction();
    const res = await request({
      action: "submit",
      receipt: signDbcReceipt(receipt(tx)),
      transaction: Buffer.from(transaction(true).serialize()).toString(
        "base64",
      ),
    });
    expect(res.status).toBe(400);
    expect(m.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("does not finalize an unconfirmed pool", async () => {
    const tx = transaction();
    m.rpc.getTransaction.mockResolvedValue(null);
    expect(
      (
        await request({
          action: "confirm",
          receipt: signDbcReceipt(receipt(tx, "pool")),
          signature: "1".repeat(88),
        })
      ).status,
    ).toBe(400);
    expect(m.mutation).not.toHaveBeenCalled();
  });
  it("advances from confirmed config to reviewed pool", async () => {
    const tx = transaction();
    m.rpc.getTransaction.mockResolvedValue({
      transaction: { message: tx.message },
      meta: { err: null },
    });
    const res = await request({
      action: "confirm",
      receipt: signDbcReceipt(receipt(tx)),
      signature: "1".repeat(88),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).stage).toBe("pool");
    expect(m.mutation).not.toHaveBeenCalled();
  });
  it("rejects a pool whose on-chain creator differs", async () => {
    const tx = transaction();
    m.rpc.getTransaction.mockResolvedValue({
      transaction: { message: tx.message },
      meta: { err: null },
    });
    m.pool.mockResolvedValue({
      poolState: { creator: Keypair.generate().publicKey },
    });
    expect(
      (
        await request({
          action: "confirm",
          receipt: signDbcReceipt(receipt(tx, "pool")),
          signature: "1".repeat(88),
        })
      ).status,
    ).toBe(400);
    expect(m.mutation).not.toHaveBeenCalled();
  });
  it("only finalizes after verifying the actual mint and nonzero supply", async () => {
    const tx = transaction();
    const r = receipt(tx, "pool");
    m.rpc.getTransaction.mockResolvedValue({ transaction: { message: tx.message }, meta: { err: null, fee: 5000 } });
    m.pool.mockResolvedValue({ poolState: { creator: owner.publicKey, baseMint: new PublicKey(r.mint) } });
    m.rpc.getTokenSupply.mockResolvedValue({ value: { amount: "1000000000000000", decimals: 6 } });
    const res = await request({ action: "confirm", receipt: signDbcReceipt(r), signature: "1".repeat(88) });
    expect(res.status).toBe(200); expect((await res.json()).complete).toBe(true); expect(m.mutation).toHaveBeenCalledTimes(2); // finalize, then the autopilot (heartbeat) switch that defaults on
    expect(m.mutation.mock.calls[1][1]).toMatchObject({ heartbeatEnabled: true, heartbeatCron: "every_12h" });
    m.mutation.mockClear();
    m.rpc.getTokenSupply.mockResolvedValue({ value: { amount: "0", decimals: 6 } });
    expect((await request({ action: "confirm", receipt: signDbcReceipt(r), signature: "1".repeat(88) })).status).toBe(400);
    expect(m.mutation).not.toHaveBeenCalled();
  });
  it("recovers a signature that landed before an interrupted response", async () => {
    const tx = transaction();
    tx.sign([owner]);
    m.rpc.getSignatureStatuses.mockResolvedValue({ value: [{ err: null }] });
    const res = await request({
      action: "refresh",
      receipt: signDbcReceipt(receipt(tx)),
      transaction: Buffer.from(tx.serialize()).toString("base64"),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).signature).toBeTruthy();
    expect(m.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("rebuilds an expired unsigned transaction without sending it", async () => {
    const tx = transaction();
    m.rpc.isBlockhashValid.mockResolvedValue({ value: false });
    const res = await request({
      action: "refresh",
      receipt: signDbcReceipt(receipt(tx)),
      transaction: Buffer.from(tx.serialize()).toString("base64"),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).stage).toBe("config");
    expect(m.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
});
