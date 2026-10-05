import type { Network, TokenState } from "./types";

const LABELS: Record<TokenState, string> = {
  paper: "Paper (simulated)",
  pending: "Pending",
  live: "Live on-chain",
  graduated: "Graduated",
  migrated: "Migrated",
  failed: "Failed",
};

/** Badge text. Paper network is always labelled simulated, whatever the state. */
export function tokenBadgeLabel(state: TokenState, network: Network): string {
  if (network === "paper") return LABELS.paper;
  return LABELS[state];
}
