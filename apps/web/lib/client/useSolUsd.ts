"use client";
import { useEffect, useState } from "react";
export function useSolUsd() {
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const res = await fetch("/api/market/sol-usd");
        const data = await res.json();
        if (live && res.ok && Number.isFinite(data.rate) && data.rate > 0) setRate(data.rate);
      } catch { /* Keep the most recent successful quote. */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  return rate;
}
