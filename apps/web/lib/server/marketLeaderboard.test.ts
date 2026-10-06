// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { BorshCoder, BN, type Idl } from "@coral-xyz/anchor";
import { DynamicBondingCurveIdl, DYNAMIC_BONDING_CURVE_PROGRAM_ID } from "@meteora-ag/dynamic-bonding-curve-sdk";
import bs58 from "bs58";
import { readMarketSwap, readPoolHistory } from "./marketLeaderboard";
const wallet = new PublicKey("So11111111111111111111111111111111111111112"), pool = PublicKey.unique(), mint = PublicKey.unique();
const coder = new BorshCoder(DynamicBondingCurveIdl as unknown as Idl);
function transaction(cpi = false) {
  const event = { pool, config: PublicKey.unique(), trade_direction: 1, has_referral: false, params: { amount_in: new BN(1000000000), minimum_amount_out: new BN(1) }, swap_result: { actual_input_amount: new BN(990000000), output_amount: new BN(100), next_sqrt_price: new BN(1), trading_fee: new BN(10000000), protocol_fee: new BN(100), referral_fee: new BN(0) }, amount_in: new BN(1000000000), current_timestamp: new BN(100) };
  const encoded = coder.types.encode("EvtSwap", event);
  const discriminator = DynamicBondingCurveIdl.events.find(e => e.name === "EvtSwap")!.discriminator;
  const payload = Buffer.concat([Buffer.from(discriminator), encoded]);
  return { slot: 1, blockTime: 100, transaction: { message: { accountKeys: [{ pubkey: wallet, signer: true, writable: true }], instructions: [] }, signatures: ["signature"] }, meta: { err: null, fee: 5000, preBalances: [2000000000], postBalances: [998000000], preTokenBalances: [], postTokenBalances: [{ accountIndex: 0, mint: mint.toBase58(), owner: wallet.toBase58(), uiTokenAmount: { amount: "100", decimals: 6, uiAmount: 0.0001 } }], innerInstructions: cpi ? [{ index: 0, instructions: [{ programId: DYNAMIC_BONDING_CURVE_PROGRAM_ID, accounts: [], data: bs58.encode(Buffer.concat([Buffer.alloc(8), payload])) }] }] : [], logMessages: cpi ? [] : [`Program ${DYNAMIC_BONDING_CURVE_PROGRAM_ID} invoke [1]`, `Program data: ${payload.toString("base64")}`, `Program ${DYNAMIC_BONDING_CURVE_PROGRAM_ID} success`] } } as unknown as ParsedTransactionWithMeta;
}
describe("Meteora RPC swaps", () => {
  for (const cpi of [false, true]) it(`decodes ${cpi ? "event-CPI" : "log"} swaps and excludes ATA rent from cost`, () => {
    const parsed = readMarketSwap(transaction(cpi), "sig", mint.toBase58(), pool.toBase58());
    expect(parsed?.trade).toMatchObject({ wallet: wallet.toBase58(), side: "buy", sol: 1, units: 100, networkFeeSol: 0.000005, time: 100000 });
    expect(parsed?.fee).toBe(10000000);
  });
  it("counts a swap once when Meteora emits both legacy and v2 events", () => {
    const tx = transaction(true);
    const event = { pool, config: PublicKey.unique(), trade_direction: 1, has_referral: false, swap_parameters: { amount_0: new BN(1000000000), amount_1: new BN(1), swap_mode: 0 }, swap_result: { included_fee_input_amount: new BN(1000000000), excluded_fee_input_amount: new BN(990000000), amount_left: new BN(0), output_amount: new BN(100), next_sqrt_price: new BN(1), trading_fee: new BN(10000000), protocol_fee: new BN(100), referral_fee: new BN(0) }, quote_reserve_amount: new BN(1), migration_threshold: new BN(1), current_timestamp: new BN(100) };
    const encoded = coder.types.encode("EvtSwap2", event);
    const discriminator = DynamicBondingCurveIdl.events.find(e => e.name === "EvtSwap2")!.discriminator;
    tx.meta!.innerInstructions![0].instructions.push({ programId: DYNAMIC_BONDING_CURVE_PROGRAM_ID, accounts: [], data: bs58.encode(Buffer.concat([Buffer.alloc(8), Buffer.from(discriminator), encoded])) });
    const parsed = readMarketSwap(tx, "sig", mint.toBase58(), pool.toBase58());
    expect(parsed?.trade?.sol).toBe(1);
    expect(parsed?.fee).toBe(10000000);
  });
  it("ignores failed transactions and events from a different pool", () => {
    const tx = transaction(); tx.meta!.err = { InstructionError: [0, "InvalidArgument"] };
    expect(readMarketSwap(tx, "sig", mint.toBase58(), pool.toBase58())).toBeNull();
    expect(readMarketSwap(transaction(), "sig", mint.toBase58(), PublicKey.unique().toBase58())).toBeNull();
  });
  it("paginates past recent transactions to recover earlier purchases", async () => {
    const pages: (string | undefined)[] = [];
    const connection = { getSignaturesForAddress: async (_pool: PublicKey, options: { before?: string }) => { pages.push(options.before); return options.before ? [] : Array.from({ length: 100 }, (_, i) => ({ signature: `failed${i}`, err: {} })); } };
    const result = await readPoolHistory(connection as Parameters<typeof readPoolHistory>[0], pool, "devnet");
    expect(result.complete).toBe(true);
    expect(pages).toEqual([undefined, "failed99"]);
  });
  it("only reads newer signatures on refresh and retains cached cost basis", async () => {
    const testPool = PublicKey.unique();
    const calls: { until?: string }[] = [];
    let transactionReads = 0;
    const connection = {
      getSignaturesForAddress: async (_pool: PublicKey, options: { until?: string }) => {
        calls.push(options);
        return options.until ? [] : [{ signature: "incremental-buy", err: null }];
      },
      getParsedTransaction: async () => { transactionReads++; return transaction(); },
    };
    const first = await readPoolHistory(connection as unknown as Parameters<typeof readPoolHistory>[0], testPool, "devnet");
    const second = await readPoolHistory(connection as unknown as Parameters<typeof readPoolHistory>[0], testPool, "devnet");
    expect(second.transactions).toEqual(first.transactions);
    expect(second.complete).toBe(true);
    expect(calls[1].until).toBe("incremental-buy");
    expect(transactionReads).toBe(1);
  });

});
