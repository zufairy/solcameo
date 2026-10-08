/** SOL an agent wallet keeps after a swap: the swap's own fee, a possible USDC account rent and headroom (mirrors the server). */
export const SOL_KEEP = 0.005;
/** Extra USDC asked for so slippage and pool fees never leave a charge a few cents short (mirrors the server). */
const SWAP_BUFFER = 1.05;

export type Readiness =
  | { state: "ready" }
  | { state: "swap"; sol: number; usd: number }
  | { state: "short"; needUsd: number; swappableUsd: number };

/**
 * How an agent wallet will pay for a job: straight from USDC, by swapping just the shortfall from SOL at checkout, or
 * not at all (and how much is missing). Pure, so the dialog can show it before anyone presses Generate.
 */
export function fundingReadiness(a: { priceUsd: number; usdc: number; sol: number; solUsd: number | null }): Readiness {
  const short = a.priceUsd - a.usdc;
  if (short <= 1e-9) return { state: "ready" };
  const swappableUsd = a.solUsd ? Math.max(0, a.sol - SOL_KEEP) * a.solUsd : 0;
  const wantUsd = short * SWAP_BUFFER;
  if (a.solUsd && swappableUsd >= wantUsd) return { state: "swap", usd: wantUsd, sol: wantUsd / a.solUsd };
  return { state: "short", needUsd: Math.max(0.01, Math.ceil((short - swappableUsd / SWAP_BUFFER) * 100) / 100), swappableUsd };
}
