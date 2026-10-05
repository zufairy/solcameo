"use client";

import { useEffect, useRef } from "react";

type Item = { id: string; status?: string; createdAt: number };

/**
 * Keeps a tab's settled results in the agent's own R2 library (so every image / video the
 * agent makes is saved to it and follows it across devices). localStorage stays as the instant
 * cache; the server copy is merged in on load and rewritten (debounced) when results change.
 */
export function useAgentLibrary<T extends Item>(
  kind: "photo" | "video" | "carousel" | "motion",
  mintAddress: string | undefined,
  items: T[],
  setItems: (fn: (prev: T[]) => T[]) => void,
) {
  const loaded = useRef(false);
  const lastSynced = useRef("");

  useEffect(() => {
    loaded.current = false;
    if (!mintAddress) return;
    let live = true;
    fetch(`/api/agents/library?mint=${encodeURIComponent(mintAddress)}&kind=${kind}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: T[] } | null) => {
        if (!live) return;
        const remote = (d?.items ?? []).filter((i) => i && typeof i.id === "string");
        lastSynced.current = JSON.stringify(remote);
        if (remote.length) {
          setItems((prev) => {
            const have = new Set(prev.map((p) => p.id));
            const add = remote.filter((r) => !have.has(r.id));
            return add.length ? [...prev, ...add].sort((a, b) => b.createdAt - a.createdAt) : prev;
          });
        }
      })
      .catch(() => { /* offline / not signed in: local cache only */ })
      .finally(() => { if (live) loaded.current = true; });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintAddress, kind]);

  useEffect(() => {
    if (!mintAddress) return;
    const t = setTimeout(() => {
      if (!loaded.current) return;
      const settled = items.filter((i) => !i.status).slice(0, 200);
      const json = JSON.stringify(settled);
      if (json === lastSynced.current) return;
      lastSynced.current = json;
      void fetch("/api/agents/library", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, kind, items: settled }),
      }).catch(() => { lastSynced.current = ""; });
    }, 1500);
    return () => clearTimeout(t);
  }, [items, mintAddress, kind]);
}
