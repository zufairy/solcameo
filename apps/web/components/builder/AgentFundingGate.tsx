"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AGENT_FUNDING_EVENT, type AgentFundingRequest } from "@/lib/client/agentGenerationFetch";
import { FundAgentDialog } from "./FundAgentDialog";

/**
 * App-wide "this agent needs a deposit" popup. Any generation that is refused for lack of funds (Explore, builder,
 * schedules) raises AGENT_FUNDING_EVENT; the builder header handles it itself, every other page lands here.
 */
export function AgentFundingGate() {
  const [request, setRequest] = useState<AgentFundingRequest | null>(null);
  const [open, setOpen] = useState(false);
  const agent = useQuery(api.influencers.getByMint, request ? { mintAddress: request.mintAddress } : "skip");

  useEffect(() => {
    const listener = (event: Event) => {
      // The builder header opens its own dialog and cancels the event; wait a tick so it can.
      window.setTimeout(() => {
        if (event.defaultPrevented) return;
        setRequest((event as CustomEvent<AgentFundingRequest>).detail);
        setOpen(true);
      }, 0);
    };
    window.addEventListener(AGENT_FUNDING_EVENT, listener);
    return () => window.removeEventListener(AGENT_FUNDING_EVENT, listener);
  }, []);

  if (!request) return null;
  return <FundAgentDialog open={open} onOpenChange={setOpen} mintAddress={request.mintAddress} agentWallet={agent?.agentWallet ?? undefined} agentName={agent?.name} suggestedUsdc={request.required} />;
}
