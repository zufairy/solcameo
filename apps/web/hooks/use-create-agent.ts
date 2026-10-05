"use client";

import { useCallback, useRef } from "react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

/** Legacy Studio creation uses the same authenticated, quota-gated server as Builder. */
export function useCreateAgent() {
  const { getFreshToken } = useSupabaseAuth();
  const session = useRef<string | null>(null);
  return useCallback(async (agent: {
    mintAddress: string; creatorWallet: string; name: string; handle: string;
    avatarUrl: string; niche: string; language: string; archetype: string;
    description: string; personality: { warmth: number; humor: number; authority: number; boldness: number };
  }) => {
    session.current ??= `studio_${crypto.randomUUID()}`;
    const token = await getFreshToken();
    if (!token) throw new Error("Sign in to create an agent.");
    const res = await fetch("/api/nft/mint", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        sessionId: session.current, txSignature: `free_promo_${session.current}`,
        creatorWallet: agent.creatorWallet, avatarUrls: [agent.avatarUrl],
        agentBlueprint: { agentType: "influencer", persona: {
          name: agent.name, handle: agent.handle, niche: agent.niche,
          language: agent.language, voiceArchetype: agent.archetype, backstory: agent.description,
        } },
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.mintAddress) throw new Error(data.error || "Could not create agent.");
    window.dispatchEvent(new Event("agents-changed"));
    return data.mintAddress as string;
  }, [getFreshToken]);
}
