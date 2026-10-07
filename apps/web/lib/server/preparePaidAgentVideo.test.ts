import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
const m = vi.hoisted(() => ({ charge: vi.fn(), refund: vi.fn(), mutation: vi.fn(), execute: vi.fn() }));
vi.mock("./exploreBilling", () => ({ chargeExploreRun: m.charge, refundExploreRun: m.refund }));
import { preparePaidAgentVideo } from "./preparePaidAgentVideo";
const args = () => ({ convex: { mutation: m.mutation }, mintAddress: "agent", taskId: "task" as Id<"agentTasks">, estimatedCost: 0.4, execute: m.execute });
beforeEach(() => vi.resetAllMocks());
describe("Director and agent video payment gate", () => {
  it("waits for wallet payment and records prepayment before any preparation runs", async () => {
    let confirm!: () => void;
    m.charge.mockImplementation(() => new Promise(resolve => { confirm = () => resolve({ ok: true, costUsdc: 0.4 }); }));
    m.execute.mockResolvedValue("render");
    const run = preparePaidAgentVideo(args());
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.mutation).not.toHaveBeenCalled();
    confirm();
    expect(await run).toEqual({ ok: true, result: "render" });
    expect(m.charge).toHaveBeenCalledWith("agent", "video:task", 0.4, "task");
    expect(m.mutation.mock.invocationCallOrder[0]).toBeLessThan(m.execute.mock.invocationCallOrder[0]);
  });
  it("never prepares a video if the payment fails", async () => {
    m.charge.mockResolvedValue({ ok: false, reason: "payment_failed" });
    expect(await preparePaidAgentVideo(args())).toEqual({ ok: false, reason: "payment_failed" });
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.mutation).not.toHaveBeenCalled();
  });
  it("blocks work when the confirmed payment cannot be recorded", async () => {
    m.charge.mockResolvedValue({ ok: true, costUsdc: 0.4 });
    m.mutation.mockRejectedValue(new Error("database unavailable"));
    await expect(preparePaidAgentVideo(args())).rejects.toThrow("database unavailable");
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.refund).toHaveBeenCalledWith("agent", "video:task");
  });
});
