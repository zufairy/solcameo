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
  const raw = (process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "mainnet-beta").toLowerCase();
  if (raw === "mainnet" || raw === "mainnet-beta") return "mainnet-beta";
  if (raw === "testnet") return "testnet";
  if (raw === "devnet") return "devnet";
  return "mainnet-beta";
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
 * Influencer/platform DBC launches use Meteora's existing mainnet program.
 * Set NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta and SOLCAMEO_DBC_LIVE_ENABLED=true,
 * use a mainnet Helius RPC, then rebuild Next.js so client network constants match.
 * Campaign escrow and custom agent-vault programs belong to the legacy product;
 * they are not dependencies of the current DBC + funded agent-wallet launch flow.
 * USDC is selected by getUsdcMint() for the configured network.
 */

/** Helius RPC for the selected cluster, when configured. */
export function getHeliusRpcUrl(network?: SolanaNetwork): string {
  const n = network ?? getNetwork();
  const key = process.env.HELIUS_API_KEY || process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  if (!key) return "";
  if (n === "mainnet-beta") return `https://mainnet.helius-rpc.com/?api-key=${key}`;
  if (n === "devnet") return `https://devnet.helius-rpc.com/?api-key=${key}`;
  return "";
}

/**
 * QuickNode RPC for the selected cluster, when configured: the full endpoint URL (its token is part of the path).
 * The server prefers the private variable; the browser can only see the NEXT_PUBLIC one, so lock that endpoint to
 * your own domains in the QuickNode dashboard (Security, referrer allowlist).
 */
export function getQuickNodeRpcUrl(network?: SolanaNetwork): string {
  const n = network ?? getNetwork();
  const clean = (v: string | undefined) => (v && /^https:\/\//.test(v.trim()) ? v.trim() : "");
  if (n === "mainnet-beta") return clean(process.env.QUICKNODE_SOLANA_RPC_URL) || clean(process.env.NEXT_PUBLIC_QUICKNODE_SOLANA_RPC_URL);
  if (n === "devnet") return clean(process.env.QUICKNODE_SOLANA_DEVNET_RPC_URL) || clean(process.env.NEXT_PUBLIC_QUICKNODE_SOLANA_DEVNET_RPC_URL);
  return "";
}

/** Shared primary RPC: QuickNode first, then Helius, then the public cluster endpoint. */
export function getRpcUrl(network?: SolanaNetwork): string {
  const n = network ?? getNetwork();
  const quick = getQuickNodeRpcUrl(n);
  if (quick) return quick;
  const helius = getHeliusRpcUrl(n);
  if (helius) return helius;
  if (n === "mainnet-beta") return "https://api.mainnet-beta.solana.com";
  if (n === "testnet") return "https://api.testnet.solana.com";
  return "https://api.devnet.solana.com";
}

/**
 * RPC for Meteora launch and pool work. A dedicated provider (QuickNode, then Helius) always wins, so a stale
 * SOLCAMEO_DBC_RPC_URL left in the environment can never route these calls around it; that override only applies
 * when neither is configured.
 */
export function getDbcRpcUrl(network?: SolanaNetwork): string {
  const n = network ?? getNetwork();
  const quick = getQuickNodeRpcUrl(n);
  if (quick) return quick;
  if (getHeliusRpcUrl(n)) return getRpcUrl(n);
  return process.env.SOLCAMEO_DBC_RPC_URL?.trim() || getRpcUrl(n);
}

/** Read-only calls use the same cluster and primary provider. */
export function getReadRpcUrl(network?: SolanaNetwork): string {
  return getRpcUrl(network);
}

/** Ordered RPC candidates for failover: QuickNode first, Helius as the backup. The shared public endpoint is only
 *  used when neither is configured. */
export function getRpcCandidates(network?: SolanaNetwork): string[] {
  const n = network ?? getNetwork();
  const quick = getQuickNodeRpcUrl(n);
  const helius = getHeliusRpcUrl(n);
  const pub =
    n === "mainnet-beta" ? "https://api.mainnet-beta.solana.com"
    : n === "testnet" ? "https://api.testnet.solana.com"
    : "https://api.devnet.solana.com";
  // Avoid falling back to the shared public RPC when a dedicated provider is configured.
  const dedicated = [quick, helius].filter(Boolean);
  const ordered = dedicated.length ? dedicated : [pub];
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
  // The live network is just "Solana" to people; only a test network is named.
  if (n === "mainnet-beta") return "Solana";
  if (n === "devnet")       return "Devnet";
  return "Testnet";
}

/** Faucet URL for getting test USDC. Only meaningful on devnet/testnet. */
export function getUsdcFaucetUrl(): string | null {
  const n = getNetwork();
  if (n === "devnet" || n === "testnet") return "https://faucet.circle.com";
  return null;
}
