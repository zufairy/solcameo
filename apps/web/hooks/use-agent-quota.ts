"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

export type AgentQuota = {
  agents: { mintAddress: string; name: string }[];
  agentCount: number;
  agentLimit: number;
  canCreate: boolean;
};

export function useAgentQuota(scope = "") {
  const { authenticated, loading, profile, getFreshToken } = useSupabaseAuth();
  const identityKey = JSON.stringify([profile?.userId, profile?.walletAddress, profile?.walletAddresses, scope]);
  const sequence = useRef(0);
  const [result, setResult] = useState<{ key: string; quota?: AgentQuota; error?: string } | null>(null);
  const refresh = useCallback(async () => {
    if (!authenticated || loading) return;
    const requestId = ++sequence.current;
    try {
      const token = await getFreshToken();
      if (!token) throw new Error("Please sign in again.");
      const res = await fetch("/api/agents/quota", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not check your agent limit.");
      if (requestId === sequence.current) setResult({ key: identityKey, quota: data });
    } catch (e) {
      if (requestId === sequence.current) setResult({ key: identityKey, error: e instanceof Error ? e.message : "Could not check your agent limit." });
    }
  }, [authenticated, loading, identityKey, getFreshToken]);
  useEffect(() => {
    void refresh();
    const onRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onRefresh);
    window.addEventListener("agents-changed", onRefresh);
    const interval = setInterval(onRefresh, 30_000);
    return () => {
      // Invalidate in-flight requests from the previous account/scope.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++;
      clearInterval(interval);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener("agents-changed", onRefresh);
    };
  }, [refresh]);
  const current = authenticated && result?.key === identityKey ? result : null;
  return { quota: current?.quota, error: current?.error, pending: loading || (authenticated && !current), refresh };
}
