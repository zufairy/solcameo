import type { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { unsignedPumpTransaction } from "./pumpLaunch";
import { boundedPrice, priorityFeeMicroLamports } from "./priorityFee";

/**
 * Build a swap the wallet can land quickly and cheaply: market-rate priority fee, and a compute limit sized from a
 * simulation instead of a blanket 500k. A swap that would fail right now is refused here, before the wallet is asked
 * to sign anything. If simulation or the fee estimator is unavailable it falls back to the previous fixed settings.
 */
export async function tunedSwapTransaction(connection: Connection, payer: PublicKey, instructions: TransactionInstruction[], opts: { network: "mainnet" | "devnet"; accountKeys: string[] }) {
  const fee = await priorityFeeMicroLamports(opts.network, opts.accountKeys);
  const first = await unsignedPumpTransaction(connection, payer, instructions, { priorityMicroLamports: boundedPrice(fee, 500_000), computeUnitLimit: 500_000 });
  let units: number | undefined;
  try {
    const sim = await connection.simulateTransaction(first.tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
    if (sim.value.err) {
      const logs = (sim.value.logs ?? []).join(" ");
      const why = /slippage|ExceededSlippage|0x1773/i.test(logs) ? "the price moved past your slippage" : /insufficient|0x1\b/i.test(logs + JSON.stringify(sim.value.err)) ? "your wallet does not have enough funds for this amount plus fees" : "the pool rejected it";
      throw new Error(`This swap would fail right now: ${why}. Nothing was sent. Refresh the quote and try again.`);
    }
    units = sim.value.unitsConsumed;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("This swap would fail")) throw e;
  }
  if (!units) return first;
  const limit = Math.min(600_000, Math.max(50_000, Math.ceil(units * 1.3)));
  return unsignedPumpTransaction(connection, payer, instructions, { priorityMicroLamports: boundedPrice(fee, limit), computeUnitLimit: limit });
}
