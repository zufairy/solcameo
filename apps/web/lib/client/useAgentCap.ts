"use client";
import { useEffect, useState } from "react";

export type AgentCap = { capSol: number | null; changePct: number | null };
const TTL = 30_000;
const cache = new Map<string, { at: number; value: AgentCap }>();
const inflight = new Map<string, Promise<AgentCap>>();
// Many cards mount at once; keep the pool endpoint from being hit by dozens of parallel requests.
let active = 0;
const queue: Array<() => void> = [];
const slot = async () => {
  if (active >= 4) await new Promise<void>((resolve) => queue.push(resolve));
  active++;
};
const release = () => {
  active--;
  queue.shift()?.();
};

async function load(characterId: string): Promise<AgentCap> {
  const hit = cache.get(characterId);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const pending = inflight.get(characterId);
  if (pending) return pending;
  const run = (async () => {
    await slot();
    try {
      const res = await fetch(`/api/meteora/pool?characterId=${encodeURIComponent(characterId)}`, { cache: "no-store" });
      const data = await res.json();
      const value: AgentCap =
        res.ok && data.available
          ? { capSol: typeof data.capSol === "number" ? data.capSol : null, changePct: typeof data.changeSinceLaunchPct === "number" ? data.changeSinceLaunchPct : null }
          : { capSol: null, changePct: null };
      cache.set(characterId, { at: Date.now(), value });
      return value;
    } catch {
      return hit?.value ?? { capSol: null, changePct: null };
    } finally {
      release();
      inflight.delete(characterId);
    }
  })();
  inflight.set(characterId, run);
  return run;
}

/** Live market cap (in SOL) and change since launch for an agent's coin. Null until a pool exists. */
export function useAgentCap(characterId?: string): AgentCap | null {
  const [cap, setCap] = useState<AgentCap | null>(null);
  useEffect(() => {
    if (!characterId) return;
    let live = true;
    const refresh = () => {
      if (document.hidden) return;
      void load(characterId).then((value) => live && setCap(value));
    };
    refresh();
    const timer = setInterval(refresh, TTL);
    window.addEventListener("solcameo:trade-confirmed", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("solcameo:trade-confirmed", refresh);
    };
  }, [characterId]);
  return characterId ? cap : null;
}
