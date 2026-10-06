import { getRpcUrl } from "./network";

/** Shared provider and cluster for legacy wallet and campaign callers. */
export function getPublicSolanaRpcUrl(): string {
  return getRpcUrl();
}

export function getPublicSolanaClusterLabel(): string {
  const rpcUrl = getPublicSolanaRpcUrl().toLowerCase();
  if (rpcUrl.includes("devnet")) return "Solana Devnet";
  if (rpcUrl.includes("testnet")) return "Solana Testnet";
  if (rpcUrl.includes("mainnet")) return "Solana Mainnet";
  return "Custom Solana RPC";
}
