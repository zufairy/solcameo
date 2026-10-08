"use client";
import { useEffect, useState } from "react";
import type { PlatformTokenState } from "@/app/api/tokenomics/platform/route";

export type PlatformData = PlatformTokenState & { stale?: boolean };
const POLL_MS = 6000;

/** One shared poller for every tokenomics block on the page, so the chain is read once per tick however many blocks show it. */
let current: { data: PlatformData | null; error: string } = { data: null, error: "" };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let ctrl: AbortController | undefined;

async function pull() {
  if (typeof document !== "undefined" && document.hidden) return;
  ctrl?.abort();
  ctrl = new AbortController();
  try {
    const res = await fetch("/api/tokenomics/platform", { signal: ctrl.signal, cache: "no-store" });
    const json = await res.json();
    current = json.ok ? { data: json, error: "" } : { ...current, error: json.error ?? "RPC unavailable" };
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return;
    current = { ...current, error: "RPC unavailable. Retrying…" };
  }
  listeners.forEach((l) => l());
}

/** Live read of the SOLCAMEO platform token (supply, burns, revenue wallet, epochs), refreshed every few seconds. */
export function usePlatformToken() {
  const [state, setState] = useState(current);
  useEffect(() => {
    const on = () => setState(current);
    listeners.add(on);
    if (listeners.size === 1) { void pull(); timer = setInterval(() => void pull(), POLL_MS); } else on();
    return () => {
      listeners.delete(on);
      if (!listeners.size) { if (timer) clearInterval(timer); timer = undefined; ctrl?.abort(); }
    };
  }, []);
  return state;
}
