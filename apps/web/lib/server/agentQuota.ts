import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { AuthUser } from "./requireAuth";
import { subscriptionAgentLimit } from "./subscriptionStatus";

export async function getAgentQuotaIdentity(convex: ConvexHttpClient, user: AuthUser, provenWallet?: string) {
  const identity = await convex.query(api.mintFee.accountIdentity, {
    authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    userId: user.id,
    wallets: [...new Set([...(user.walletAddresses ?? []), user.walletAddress, provenWallet].filter((w): w is string => !!w))],
  });
  const paidLimit = Math.max(0, ...(await Promise.all(identity.wallets.map(wallet => subscriptionAgentLimit(wallet)))));
  return {
    creatorWallets: identity.wallets,
    creatorDid: user.id,
    agentLimit: paidLimit > 0 ? (identity.agentLimitOverride ?? paidLimit) : 1,
    agents: identity.agents,
  };
}
