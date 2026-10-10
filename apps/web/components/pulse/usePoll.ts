"use client";
import { useEffect, useRef, useState } from "react";

/** Polls a JSON endpoint on an interval, pausing while the tab is hidden so a background tab never keeps the stream open. */
export function usePoll<T>(url: string, everyMs: number): { data: T | null; error: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!alive.current) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) throw new Error(String(res.status));
          const json = (await res.json()) as T;
          if (alive.current) { setData(json); setError(false); }
        } catch { if (alive.current) setError(true); }
      }
      if (alive.current) timer = setTimeout(tick, everyMs);
    };
    void tick();
    return () => { alive.current = false; clearTimeout(timer); };
  }, [url, everyMs]);
  return { data, error };
}
