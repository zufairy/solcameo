"use client";
import { useEffect, useState } from "react";
import type { CalloutTrade } from "@/lib/solstar/calloutTrade";
export function useCalloutTrades(wallet: string | undefined, enabled: boolean) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ wallet: string; coins: CalloutTrade[]; error: string }>();
  useEffect(() => {
    if (!wallet || !enabled) return;
    const ctrl = new AbortController();
    void fetch(`/api/solstar/callouts/trades?wallet=${encodeURIComponent(wallet)}${version ? "&refresh=1" : ""}`, { signal: ctrl.signal }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not read trades. Please retry.");
      if (!ctrl.signal.aborted) setState({ wallet, coins: data.coins, error: data.errors?.length ? "Some coins could not be verified. Only coins with complete trade history are available." : "" });
    }).catch(e => { if (!ctrl.signal.aborted) setState({ wallet, coins: [], error: e instanceof Error ? e.message : "Could not read trades." }); });
    return () => ctrl.abort();
  }, [wallet, enabled, version]);
  const current = state?.wallet === wallet ? state : undefined;
  return { coins: current?.coins ?? [], loading: !!wallet && enabled && !current, error: current?.error || "", refresh: () => { setState(undefined); setVersion(v => v + 1); } };
}
