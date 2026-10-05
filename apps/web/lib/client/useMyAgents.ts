"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { resolvePersistedAgentType } from "@/lib/builder/resolve-agent-type";

export type MyAgent = {
  mintAddress: string;
  name: string;
  avatarUrl: string;
  niche: string;
  handle: string;
  type: ReturnType<typeof resolvePersistedAgentType>;
};

/** The signed-in account's agents (all linked wallets), with a resolved type.
 *  `agents` is undefined while loading, [] once known to be empty. */
export function useMyAgents(): { agents: MyAgent[] | undefined; signedIn: boolean } {
  const { profile } = useSupabaseAuth();
  const signedIn = !!profile;
  const wallets = useMemo(() => (profile?.walletAddresses ?? []).filter(Boolean), [profile?.walletAddresses]);
  const rows = useQuery(api.influencers.listByCreators, signedIn && wallets.length ? { creatorWallets: wallets } : "skip") as
    | Array<{ mintAddress: string; name: string; avatarUrl?: string; niche?: string; handle?: string; agentType?: string; clipConfig?: unknown }>
    | undefined;
  const agents = useMemo(
    () => rows?.map((r) => ({
      mintAddress: r.mintAddress,
      name: r.name,
      avatarUrl: r.avatarUrl ?? "",
      niche: r.niche ?? "",
      handle: r.handle ?? "",
      type: resolvePersistedAgentType({ agentType: r.agentType, clipConfig: r.clipConfig, niche: r.niche }),
    })),
    [rows],
  );
  return { agents, signedIn };
}
