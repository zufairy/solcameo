import type { ConvexHttpClient } from "convex/browser";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { chargeExploreRun, refundExploreRun } from "./exploreBilling";

/** The payment gate surrounds all video work, including Director sample preparation. */
export async function preparePaidAgentVideo<T>({ convex, mintAddress, taskId, estimatedCost, execute }: {
  convex: Pick<ConvexHttpClient, "mutation">;
  mintAddress: string;
  taskId: Id<"agentTasks">;
  estimatedCost: number;
  execute: () => Promise<T>;
}): Promise<{ ok: true; result: T } | { ok: false; reason: string }> {
  if (!Number.isFinite(estimatedCost) || estimatedCost <= 0) return { ok: false, reason: "invalid_price" };
  const runId = `video:${taskId}`;
  const charge = await chargeExploreRun(mintAddress, runId, estimatedCost, taskId);
  if (!charge.ok) return charge;
  try {
    await convex.mutation(api.agentTasks.markPrepaid, {
      id: taskId, usdc: charge.costUsdc, runId, authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
  } catch (error) {
    await refundExploreRun(mintAddress, runId);
    throw error;
  }
  return { ok: true, result: await execute() };
}
