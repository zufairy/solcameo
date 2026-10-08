import { expect, it } from "vitest";
import { planFunding } from "./fundingPlan";
const base = { needUsd: 1, solUsd: 100, mine: { sol: 0, usdc: 0 }, agent: { sol: 0, usdc: 0 } };
it("does nothing when the agent already has the USDC", () => expect(planFunding({ ...base, agent: { sol: 0, usdc: 2 } })).toEqual({ kind: "funded" }));
it("prefers swapping the agent's own SOL", () => expect(planFunding({ ...base, agent: { sol: 0.1, usdc: 0 }, mine: { sol: 5, usdc: 5 } })).toMatchObject({ kind: "agent_swap" }));
it("sends USDC you hold before swapping your SOL", () => expect(planFunding({ ...base, mine: { sol: 5, usdc: 5 } })).toMatchObject({ kind: "send_usdc", usd: 1 }));
it("swaps your SOL when it covers the job", () => expect(planFunding({ ...base, mine: { sol: 0.1, usdc: 0 } })).toMatchObject({ kind: "swap_mine" }));
it("offers the most your SOL can swap when it cannot cover the job", () => {
  const p = planFunding({ ...base, needUsd: 5, mine: { sol: 0.0124 - 0.0044 + 0.0055, usdc: 0 } });
  expect(p).toMatchObject({ kind: "partial_swap" });
});
it("says exactly what to send when nothing covers it", () => expect(planFunding({ ...base, mine: { sol: 0.0011, usdc: 0 } })).toMatchObject({ kind: "deposit", shortUsd: 1 }));
it("needs an agent balance to plan", () => expect(planFunding({ ...base, agent: null })).toBeNull());
