import { describe, it, expect } from "vitest";
import { tokenBadgeLabel } from "./tokenBadge";
import type { Network, TokenState } from "./types";

const states: TokenState[] = ["paper", "pending", "live", "graduated", "migrated", "failed"];
const networks: Network[] = ["paper", "devnet", "mainnet"];
const byState: Record<TokenState, string> = {
  paper: "Paper (simulated)",
  pending: "Pending",
  live: "Live on-chain",
  graduated: "Graduated",
  migrated: "Migrated",
  failed: "Failed",
};

describe("tokenBadgeLabel", () => {
  for (const network of networks) {
    for (const state of states) {
      it(`${state} on ${network}`, () => {
        const expected = network === "paper" ? "Paper (simulated)" : byState[state];
        expect(tokenBadgeLabel(state, network)).toBe(expected);
      });
    }
  }
  it("never says Live on-chain for paper network", () => {
    for (const s of states) expect(tokenBadgeLabel(s, "paper")).not.toMatch(/on-chain/i);
  });
});
