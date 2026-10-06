/**
 * SOL a creator's wallet must hold to launch a coin. The wallet pays on-chain rent for every account the launch
 * creates (curve config, pool, two vaults, the token mint and its metadata) plus network fees. None of it is a
 * Solcameo fee. Figures were measured from a real mainnet launch: the pool step moved 20,591,640 lamports.
 */
export const LAUNCH_MIN_LAMPORTS = {
  /** Before anything is signed: both transactions still to come (about 26.6M measured, plus headroom). */
  total: 30_000_000,
  /** Second transaction only (pool + mint + vaults + metadata, about 20.6M measured, plus headroom). */
  pool: 22_500_000,
} as const;

/** Meteora launch intake recommendation for the platform token: keep a buffer beyond estimated rent. */
export const PLATFORM_RECOMMENDED_LAMPORTS = 100_000_000;

/** Account sizes in bytes, used to price rent from the live network. */
export const ACCOUNT_SIZES = { config: 1048, pool: 424, mint: 82, vault: 165 } as const;
/** Metadata account rent observed on mainnet for a DBC launch (Metaplex v3 account created by the pool program). */
export const METADATA_RENT_LAMPORTS = 13_733_800;
export const NETWORK_FEE_LAMPORTS = 20_000;

export type CostItem = { id: string; label: string; note: string; lamports: number };

/** Itemised launch cost. `rent` prices an account of the given byte size on the live network. */
export function buildCostBreakdown(rent: (bytes: number) => number): { items: CostItem[]; subtotalLamports: number; recommendedLamports: number } {
  const items: CostItem[] = [
    { id: "config", label: "Curve configuration", note: "Holds your price curve and fee rules", lamports: rent(ACCOUNT_SIZES.config) },
    { id: "pool", label: "Trading pool", note: "The bonding-curve pool for your coin", lamports: rent(ACCOUNT_SIZES.pool) },
    { id: "mint", label: "Token mint", note: "Creates the coin itself", lamports: rent(ACCOUNT_SIZES.mint) },
    { id: "vaults", label: "Token vaults (2)", note: "Hold the coin and SOL inside the pool", lamports: rent(ACCOUNT_SIZES.vault) * 2 },
    { id: "metadata", label: "Token metadata", note: "Name, ticker and image on Solana", lamports: METADATA_RENT_LAMPORTS },
    { id: "fees", label: "Network fees", note: "Two transactions", lamports: NETWORK_FEE_LAMPORTS },
  ];
  const subtotalLamports = items.reduce((n, i) => n + i.lamports, 0);
  return { items, subtotalLamports, recommendedLamports: Math.max(LAUNCH_MIN_LAMPORTS.total, Math.ceil((subtotalLamports * 1.1) / 1_000_000) * 1_000_000) };
}

export const lamportsToSol = (lamports: number) => lamports / 1e9;
export const formatSol = (lamports: number) => lamportsToSol(lamports).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
