"use client";
import { useCallback, useSyncExternalStore } from "react";

/**
 * One sound setting for every video on the page. Turn sound on for one clip and it is on for all of them, until the
 * viewer turns it off; the choice is remembered for next visit. Sound is ON by default.
 *
 * Browsers refuse to start a video with sound before the viewer has touched the page, so until that first tap/key
 * press (or if the browser already counts the page as interacted with) clips play silently instead of freezing, and
 * the sound switches on at that first interaction without restarting anything.
 */
const KEY = "solcameo:sound";
const listeners = new Set<() => void>();
let wantsSound = true;
let unlocked = false;
let started = false;

const emit = () => listeners.forEach((l) => l());

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  try { wantsSound = window.localStorage.getItem(KEY) !== "off"; } catch { /* storage blocked: keep the default */ }
  unlocked = !!(navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive;
  if (!unlocked) {
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    const unlock = () => { unlocked = true; emit(); for (const e of events) window.removeEventListener(e, unlock, true); };
    for (const e of events) window.addEventListener(e, unlock, { capture: true, passive: true });
  }
}

const subscribe = (l: () => void) => { start(); listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => (wantsSound ? (unlocked ? 2 : 1) : 0); // 0 off, 1 on but waiting for the first touch, 2 audible
const server = () => 0;

/** `muted` is what to put on a <video muted>; `soundOn` is the viewer's choice (what a toggle button should show). */
export function useSoundPreference() {
  const state = useSyncExternalStore(subscribe, snapshot, server);
  const setSound = useCallback((on: boolean) => {
    wantsSound = on;
    // A click on a sound button is itself a gesture, so sound can start right away.
    if (on) unlocked = true;
    try { window.localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* the choice still holds for this visit */ }
    emit();
  }, []);
  return { muted: state !== 2, soundOn: state !== 0, setSound };
}
