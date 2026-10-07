"use client";
import { useEffect, useState } from "react";
import type { LiveTokenomics } from "@/app/api/tokenomics/live/route";

type Reply = LiveTokenomics & { ok: boolean; error?: string; stale?: boolean };

/**
 * The on-chain tokenomics read (pools, configs, mints), refreshed every few seconds while the tab is visible.
 * The server answers every viewer from one shared read, so any number of components can use this hook cheaply.
 */
export function useLiveTokenomics(everyMs = 5000) {
  const [state, setState] = useState<{ data: LiveTokenomics | null; error: string; stale: boolean }>({ data: null, error: "", stale: false });
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const pull = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/tokenomics/live", { signal: ctrl.signal, cache: "no-store" });
        const json = (await res.json()) as Reply;
        if (!alive) return;
        if (!json.ok) { setState((s) => ({ ...s, error: json.error ?? "RPC unavailable" })); return; }
        setState({ data: json, error: "", stale: !!json.stale });
      } catch { if (alive && !ctrl.signal.aborted) setState((s) => ({ ...s, error: "RPC unavailable. Retrying…" })); }
    };
    void pull();
    const t = setInterval(pull, everyMs);
    return () => { alive = false; ctrl.abort(); clearInterval(t); };
  }, [everyMs]);
  return state;
}
