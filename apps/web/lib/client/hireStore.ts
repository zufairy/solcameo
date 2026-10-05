"use client";

import { useSyncExternalStore } from "react";

/**
 * Client-side store for the "hire an agent → generate a creative" demo flow.
 * Persists to localStorage and is reactive across the app via useSyncExternalStore.
 *
 * This is intentionally client-only: it models a prepaid "credits" balance the
 * client spends on generations, plus the list of hired agents and the creatives
 * they've produced. On-chain settlement is out of scope for this flow.
 */

export type HiredAgent = {
  mint: string;
  name: string;
  avatarUrl: string;
  niche: string;
  agentType: string;
  hiredAt: number;
};

export type GenerationStatus = "generating" | "done" | "failed";

export type Generation = {
  id: string;
  mint: string;
  agentName: string;
  agentAvatar: string;
  productUrl: string;
  description: string;
  type: "image" | "video";
  mediaUrl: string;
  posterUrl?: string;
  /** create_video task id — present for real video renders, polled until done. */
  taskId?: string;
  cost: number;
  status: GenerationStatus;
  error?: string;
  createdAt: number;
};

type StoreState = {
  credits: number;
  hired: HiredAgent[];
  generations: Generation[];
};

const STARTING_CREDITS = 500;
const KEY = "vello_hire_store_v1";

const EMPTY: StoreState = { credits: STARTING_CREDITS, hired: [], generations: [] };

let state: StoreState = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load(): StoreState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<StoreState>;
    return {
      credits: typeof parsed.credits === "number" ? parsed.credits : STARTING_CREDITS,
      hired: Array.isArray(parsed.hired) ? parsed.hired : [],
      generations: Array.isArray(parsed.generations) ? parsed.generations : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

function ensureLoaded() {
  if (!loaded && typeof window !== "undefined") {
    state = load();
    loaded = true;
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode — keep in-memory state */
  }
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  ensureLoaded();
  listeners.add(cb);
  // Sync changes made in other tabs.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      state = load();
      cb();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): StoreState {
  ensureLoaded();
  return state;
}

const SERVER_SNAPSHOT: StoreState = EMPTY;
function getServerSnapshot(): StoreState {
  return SERVER_SNAPSHOT;
}

/* ── mutations ─────────────────────────────────────────────────────────── */

export function hireAgent(agent: HiredAgent) {
  ensureLoaded();
  if (state.hired.some((h) => h.mint === agent.mint)) return;
  state = { ...state, hired: [agent, ...state.hired] };
  emit();
}

export function isHired(mint: string): boolean {
  ensureLoaded();
  return state.hired.some((h) => h.mint === mint);
}

/** Deduct credits. Returns false (and changes nothing) when the balance is short. */
export function spendCredits(amount: number): boolean {
  ensureLoaded();
  if (state.credits < amount) return false;
  state = { ...state, credits: Math.max(0, state.credits - amount) };
  emit();
  return true;
}

export function addCredits(amount: number) {
  ensureLoaded();
  state = { ...state, credits: state.credits + amount };
  emit();
}

export function addGeneration(gen: Generation) {
  ensureLoaded();
  state = { ...state, generations: [gen, ...state.generations] };
  emit();
}

export function updateGeneration(id: string, patch: Partial<Generation>) {
  ensureLoaded();
  state = {
    ...state,
    generations: state.generations.map((g) => (g.id === id ? { ...g, ...patch } : g)),
  };
  emit();
}

/* ── hooks ─────────────────────────────────────────────────────────────── */

export function useHireStore(): StoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
