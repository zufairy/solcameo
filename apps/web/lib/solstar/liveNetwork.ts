import { getNetwork } from "@/lib/solana/network";

/** The only chain this deployment shows real data for. Inlined at build time (NEXT_PUBLIC_SOLANA_NETWORK). */
export const LIVE_NETWORK: "mainnet" | "devnet" = getNetwork() === "mainnet-beta" ? "mainnet" : "devnet";
/** On mainnet the market must never list devnet coins or the simulated "paper" ledger. */
export const MAINNET_ONLY = LIVE_NETWORK === "mainnet";
