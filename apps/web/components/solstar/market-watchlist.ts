"use client";
import { useSyncExternalStore } from "react";
const KEY = "vello.market.watchlist";
const subscribe = (fn: () => void) => {
  window.addEventListener("storage", fn);
  window.addEventListener("vello-watchlist", fn);
  return () => {
    window.removeEventListener("storage", fn);
    window.removeEventListener("vello-watchlist", fn);
  };
};
const snapshot = () => {
  try {
    return localStorage.getItem(KEY) || "[]";
  } catch {
    return "[]";
  }
};
export function useMarketWatchlist() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed))
      ids = parsed.filter((v) => typeof v === "string");
  } catch {}
  return {
    ids,
    toggle: (id: string) => {
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify(
            ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id],
          ),
        );
        window.dispatchEvent(new Event("vello-watchlist"));
      } catch {}
    },
  };
}
