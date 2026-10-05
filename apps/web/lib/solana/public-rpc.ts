const DEVNET_RPC_URL = "https://api.devnet.solana.com";

/**
 * Shared Solana JSON-RPC endpoint used across browser and server-side Vello flows.
 * Default to devnet so campaign funding, balances, and builder testing all land on
 * the same test cluster unless a dedicated public RPC URL is configured.
 */
export function getPublicSolanaRpcUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (fromEnv) return fromEnv;
  return DEVNET_RPC_URL;
}

export function getPublicSolanaClusterLabel(): string {
  const rpcUrl = getPublicSolanaRpcUrl().toLowerCase();
  if (rpcUrl.includes("devnet")) return "Solana Devnet";
  if (rpcUrl.includes("testnet")) return "Solana Testnet";
  if (rpcUrl.includes("mainnet")) return "Solana Mainnet";
  return "Custom Solana RPC";
}
