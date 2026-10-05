import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";


/** Best-effort metering of a paid agent service. NEVER throws — a metering
 *  failure (no account, transient error) must not break the agent's work.
 *  Returns the recordUsage result, or { ok: true, skipped: true } when there's
 *  no economic account / metering couldn't run. Spec §6.1. */
export async function meterAgentService(
  mintAddress: string,
  service: string,
  qty = 1,
  idemKey?: string,
): Promise<{ ok: boolean; skipped?: boolean; reason?: string; costUsdc?: number; unsettledTabUsdc?: number; duplicate?: boolean }> {
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  if (!mintAddress) return { ok: true, skipped: true };
  try {
    return await convex.mutation(api.usage.recordUsage, {
      mintAddress, service, qty, ...(idemKey ? { idemKey } : {}),
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
  } catch {
    return { ok: true, skipped: true };
  }
}
