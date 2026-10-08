/** SOL an agent wallet keeps after swapping its own SOL (mirrors the server's reserve). */
export const AGENT_SOL_KEEP = 0.005;
/** Slack on the USDC asked for, so slippage and pool fees never leave a charge a few cents short. */
const BUFFER = 1.06;
/** Smallest swap the quote endpoints accept. */
export const MIN_SWAP_USD = 0.5;
/** SOL a wallet needs for the network fee of a swap it signs, plus the rent of the agent's USDC account when it does not exist yet. */
export const swapFeeSol = (agentHasUsdcAccount: boolean) => (agentHasUsdcAccount ? 0.003 : 0.0055);

export type Funds = { sol: number; usdc: number };
export type FundingPlan =
  | { kind: "funded" }
  /** The agent already holds enough SOL: swap it inside the agent wallet, nothing from your wallet. */
  | { kind: "agent_swap"; usd: number; sol: number }
  | { kind: "send_usdc"; usd: number }
  | { kind: "swap_mine"; usd: number; sol: number }
  /** Your SOL cannot cover the whole job, only this much of it. */
  | { kind: "partial_swap"; maxUsd: number; shortUsd: number }
  | { kind: "deposit"; shortUsd: number; sendSol: number | null };

const up2 = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;
const up4 = (n: number) => Math.ceil(n * 1e4 - 1e-9) / 1e4;

/**
 * The one next step that gets this agent paid, in order of least effort: nothing, swap the agent's own SOL, send USDC you
 * already hold, swap your SOL, then (when nothing covers it) exactly what is missing and how to send it. Pure and testable.
 */
export function planFunding(a: { needUsd: number; mine: Funds | null; agent: Funds | null; solUsd: number | null }): FundingPlan | null {
  if (!(a.needUsd > 0) || !a.agent) return null;
  const short = Math.max(0, a.needUsd - a.agent.usdc);
  if (short <= 1e-9) return { kind: "funded" };
  const want = Math.max(short * BUFFER, MIN_SWAP_USD);
  if (a.solUsd) {
    const agentUsd = Math.max(0, a.agent.sol - AGENT_SOL_KEEP) * a.solUsd;
    if (agentUsd >= want) return { kind: "agent_swap", usd: up2(want), sol: up4(want / a.solUsd) };
  }
  if (a.mine && a.mine.usdc >= short) return { kind: "send_usdc", usd: up2(short) };
  if (a.mine && a.solUsd) {
    const affordable = Math.max(0, a.mine.sol - swapFeeSol(a.agent.usdc > 0)) * a.solUsd / 1.01;
    if (affordable >= want) return { kind: "swap_mine", usd: up2(Math.max(short, MIN_SWAP_USD)), sol: up4(want / a.solUsd) };
    if (affordable >= MIN_SWAP_USD) return { kind: "partial_swap", maxUsd: Math.floor(affordable * 100) / 100, shortUsd: up2(short) };
  }
  return { kind: "deposit", shortUsd: up2(short), sendSol: a.solUsd ? up4(want / a.solUsd + AGENT_SOL_KEEP) : null };
}
