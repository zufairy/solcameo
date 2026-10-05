/**
 * Solana network detection + per-network constants.
 *
 * USDC has a different SPL mint per cluster. Using the wrong one means
 * `getAccount` returns "not found" and the balance reads $0.00 even though
 * the wallet has tokens.
 */

export type SolanaNetwork = "mainnet-beta" | "devnet" | "testnet";

/** Server reads its environment; Next.js inlines this value for clients at build time. */
export function getNetwork(): SolanaNetwork {
  const raw = (process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet").toLowerCase();
  if (raw === "mainnet" || raw === "mainnet-beta") return "mainnet-beta";
  if (raw === "testnet") return "testnet";
  return "devnet";
}

/** Canonical USDC mint per cluster. */
export const USDC_MINT_BY_NETWORK: Record<SolanaNetwork, string> = {
  // Circle's official USDC mint on mainnet
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  // Circle's devnet USDC — usable via https://faucet.circle.com
  "devnet":       "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  // No official testnet USDC — fall back to devnet mint (most wallets allow it)
  "testnet":      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

export function getUsdcMint(network?: SolanaNetwork): string {
  return USDC_MINT_BY_NETWORK[network ?? getNetwork()];
}

/** Mainnet detection — the single source used to gate real-money features. */
export function isMainnet(network?: SolanaNetwork): boolean {
  return (network ?? getNetwork()) === "mainnet-beta";
}

/**
 * MAINNET FLIP — when the time comes, set ALL of the following in every
 * environment (Vercel, Convex bold-ram-39, Railway) and re-run the Phase-7
 * gates before taking live traffic:
 *
 *   NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta
 *   NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID=<mainnet escrow program id>
 *   NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID=<mainnet agent-vault program id>
 *   NEXT_PUBLIC_USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 *
 * With NEXT_PUBLIC_USDC_MINT unset, all code paths (escrow, usdc-balance,
 * solanaVerify, agentVault, usdcTransfer) fall back to getUsdcMint() which
 * reads NEXT_PUBLIC_SOLANA_NETWORK — so flipping that one var is sufficient
 * for the mint. Explicitly setting NEXT_PUBLIC_USDC_MINT in the Convex env
 * is still recommended since Convex's copy of solanaVerify.ts inlines the
 * same table and respects the override.
 *
 * Do NOT flip without: audit, custody multisig, upgrade-authority gate,
 * RPC switch to Helius mainnet, and Phase-7 sign-off (see
 * docs/campaign-treasury/ORACLE-RESULT.md §7).
 */

/** Helius RPC for the selected cluster, when configured. */
export function getHeliusRpcUrl(network?: SolanaNetwork): string {
  const n = network ?? getNetwork();
  const key = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  if (!key) return "";
  if (n === "mainnet-beta") return `https://mainnet.helius-rpc.com/?api-key=${key}`;
  if (n === "devnet") return `https://devnet.helius-rpc.com/?api-key=${key}`;
  return "";
}

/** Shared primary RPC: Helius first, public cluster endpoint otherwise. */
export function getRpcUrl(network?: SolanaNetwork): string {
  const n = network ?? getNetwork();
  const helius = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  if (n === "mainnet-beta") return helius ? `https://mainnet.helius-rpc.com/?api-key=${helius}` : "https://api.mainnet-beta.solana.com";
  if (n === "testnet") return "https://api.testnet.solana.com";
  return helius ? `https://devnet.helius-rpc.com/?api-key=${helius}` : "https://api.devnet.solana.com";
}

/** Read-only calls use the same cluster and primary provider. */
export function getReadRpcUrl(network?: SolanaNetwork): string {
  return getRpcUrl(network);
}

/** Ordered RPC candidates for failover: Helius first when configured,
 *  followed by a public endpoint on the same cluster. */
export function getRpcCandidates(network?: SolanaNetwork): string[] {
  const n = network ?? getNetwork();
  const helius = getHeliusRpcUrl(n);
  const pub =
    n === "mainnet-beta" ? "https://api.mainnet-beta.solana.com"
    : n === "testnet" ? "https://api.testnet.solana.com"
    : "https://api.devnet.solana.com";
  // Keep the public endpoint as fallback on the same cluster.
  const ordered = [helius, pub];
  return [...new Set(ordered.filter(Boolean))];
}

/** WebSocket RPC URL for the active network — derived from the HTTP RPC by
 *  swapping the scheme. Needed by Privy's `@solana/kit` rpcSubscriptions. */
export function getRpcWsUrl(network?: SolanaNetwork): string {
  return getRpcUrl(network).replace(/^http/i, "ws");
}

/** Solscan / explorer base URL per network. */
export function getExplorerUrl(network?: SolanaNetwork): string {
  const n = network ?? getNetwork();
  if (n === "mainnet-beta") return "https://solscan.io";
  if (n === "devnet")       return "https://solscan.io/?cluster=devnet";
  return "https://solscan.io/?cluster=testnet";
}

/** Explorer URL for an account address. */
export function getAccountExplorerUrl(address: string, network?: SolanaNetwork): string {
  const n = network ?? getNetwork();
  const cluster = n === "mainnet-beta" ? "" : `?cluster=${n}`;
  return `https://solscan.io/account/${address}${cluster}`;
}

/** Explorer URL for a transaction signature. */
export function getTxExplorerUrl(sig: string, network?: SolanaNetwork): string {
  const n = network ?? getNetwork();
  const cluster = n === "mainnet-beta" ? "" : `?cluster=${n}`;
  return `https://solscan.io/tx/${sig}${cluster}`;
}

/** Human label for the network (used in UI badges). */
export function getNetworkLabel(network?: SolanaNetwork): string {
  const n = network ?? getNetwork();
  if (n === "mainnet-beta") return "Mainnet";
  if (n === "devnet")       return "Devnet";
  return "Testnet";
}

/** Faucet URL for getting test USDC. Only meaningful on devnet/testnet. */
export function getUsdcFaucetUrl(): string | null {
  const n = getNetwork();
  if (n === "devnet" || n === "testnet") return "https://faucet.circle.com";
  return null;
}
