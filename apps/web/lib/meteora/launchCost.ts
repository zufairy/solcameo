/**
 * SOL a creator's wallet must hold to launch a coin. The wallet pays on-chain rent for every account the launch
 * creates (curve config, pool, two vaults, the token mint and its metadata) plus network fees; none of it is a fee
 * to Solcameo. Figures are conservative so a launch never stalls between its two transactions.
 */
export const LAUNCH_MIN_LAMPORTS = {
  /** Before anything is signed: both transactions still to come. */
  total: 50_000_000,
  /** Second transaction only (pool + mint + metadata), once the curve config exists. */
  pool: 40_000_000,
} as const;

/** Meteora launch intake recommendation: keep a buffer beyond estimated rent. */
export const PLATFORM_RECOMMENDED_LAMPORTS = 100_000_000;

export const lamportsToSol = (lamports: number) => lamports / 1e9;
export const formatSol = (lamports: number) => lamportsToSol(lamports).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
