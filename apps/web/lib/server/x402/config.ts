import { PublicKey } from "@solana/web3.js";
import type { Network, PaymentRequirements } from "@x402/core/types";

export const SOLANA_MAINNET: Network = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOLANA_DEVNET: Network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const REPORT_PRICE_MICROS = 10_000; // $0.01; separate from Vello reasoning credits.
export function x402Config() {
  if (process.env.X402_ENABLED !== "true") throw new Error("x402 is disabled");
  const network = process.env.X402_NETWORK;
  if (network !== SOLANA_MAINNET && network !== SOLANA_DEVNET) throw new Error("Set a supported X402_NETWORK");
  const payTo = new PublicKey(process.env.X402_PAY_TO ?? "").toBase58();
  const facilitator = new URL(process.env.X402_FACILITATOR_URL ?? "");
  if (facilitator.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && facilitator.hostname === "127.0.0.1")) {
    throw new Error("Facilitator must use HTTPS");
  }
  return { network, payTo, facilitatorUrl: facilitator.toString(), asset: network === SOLANA_MAINNET ? MAINNET_USDC : DEVNET_USDC };
}
export function permittedRequirement(r: PaymentRequirements, config: ReturnType<typeof x402Config>, maxMicros: number) {
  return r.scheme === "exact" && r.network === config.network && r.asset === config.asset && r.payTo === config.payTo &&
    /^\d+$/.test(r.amount) && BigInt(r.amount) === BigInt(REPORT_PRICE_MICROS) &&
    Number.isSafeInteger(maxMicros) && maxMicros >= REPORT_PRICE_MICROS && r.maxTimeoutSeconds > 0 && r.maxTimeoutSeconds <= 120;
}
export function reportResource(origin: string, mint: string) {
  const address = new PublicKey(mint).toBase58();
  return `${new URL(origin).origin}/api/intelligence/solana?mint=${address}`;
}
