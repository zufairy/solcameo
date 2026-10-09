import { chargeAgentGeneration } from "@/lib/server/agentGenerationBilling";
import { createHash, randomUUID } from "node:crypto";


/** Paid agent services require a confirmed wallet transfer before work starts. */
export async function meterAgentService(
  mintAddress: string,
  service: string,
  qty = 1,
  idemKey?: string,
): Promise<{ ok: boolean; skipped?: boolean; reason?: string; costUsdc?: number; unsettledTabUsdc?: number; duplicate?: boolean }> {
  if (!mintAddress) return { ok: true, skipped: true };
  const runId = idemKey ? `meter:${createHash("sha256").update(idemKey).digest("hex")}` : `meter:${randomUUID()}`;
  return chargeAgentGeneration(mintAddress, runId, service, qty);
}
