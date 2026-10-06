"use client";
import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * The coin's on-chain market as Convex live queries: open positions, holders, price and recent swaps. Convex pushes
 * every change to the page, so nothing here polls RPC. A background sync keeps the tables fresh by asking our server
 * to copy new swaps in whenever the pool moves; it never feeds the UI directly.
 */
const MIN_GAP_MS = 10_000, STALE_MS = 20_000;

export function useChainMarket(characterId: Id<"ssCharacters">, enabled: boolean) {
  const market = useQuery(api.solstarChain.openTrades, enabled ? { characterId } : "skip");
  const swaps = useQuery(api.solstarChain.recentSwaps, enabled ? { characterId, limit: 60 } : "skip");
  const syncedAt = useRef(0);
  const known = market?.state?.syncedAt;
  useEffect(() => { syncedAt.current = known ?? 0; }, [known]);

  useEffect(() => {
    if (!enabled) return;
    let requesting = false;
    let last = 0, retry: ReturnType<typeof setTimeout> | undefined, stopped = false;
    const sync = () => {
      if (stopped || requesting || document.hidden || Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      requesting = true;
      fetch("/api/solstar/market-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterId }), cache: "no-store" }).catch(() => undefined).finally(() => { requesting = false; });
    };
    const afterTrade = () => { if (retry) clearTimeout(retry); retry = setTimeout(sync, 700); };
    const idle = () => { if (Date.now() - syncedAt.current > STALE_MS) sync(); };
    sync();
    const timer = setInterval(idle, STALE_MS / 2);
    window.addEventListener("solcameo:trade-confirmed", afterTrade);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      stopped = true; clearInterval(timer); if (retry) clearTimeout(retry);
      window.removeEventListener("solcameo:trade-confirmed", afterTrade);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [characterId, enabled]);

  return { market, swaps };
}
