"use client";
import { useEffect, useRef } from "react";
import { playUiTick } from "./uiSound";
import { useSoundPreference } from "./soundPreference";

/** Anything a person can press. Header and nav controls are left to the menu's own tick. */
const PRESSABLE = 'button, a[href], [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="switch"], [role="checkbox"], summary, label:has(input[type="checkbox"], input[type="radio"]), input[type="checkbox"], input[type="radio"], input[type="file"]';
const SKIP = "header, nav, [data-no-click-fx]";

/**
 * Every press on the page gets the same soft tick as the menu and a small press animation (a quick dip and settle), so a whole
 * flow feels alive and consistent. One delegated listener, so popups that render outside the page (dropdowns, dialogs) are
 * covered too. The tick follows the viewer's sound setting; the animation is skipped for reduced motion. Disabled controls stay silent.
 */
export function useClickFeedback() {
  const { soundOn } = useSoundPreference();
  const sound = useRef(soundOn);
  useEffect(() => { sound.current = soundOn; }, [soundOn]);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let last = 0;
    const press = (target: EventTarget | null) => {
      const el = target instanceof Element ? target.closest(PRESSABLE) : null;
      if (!el || el.closest(SKIP) || el.matches(':disabled, [aria-disabled="true"], [data-disabled]')) return;
      // A pointer press and the click that follows it are one action: react once.
      const now = Date.now();
      if (now - last < 120) return;
      last = now;
      if (sound.current) playUiTick();
      if (reduced) return;
      el.classList.remove("ui-pop");
      void (el as HTMLElement).offsetWidth; // restart the animation on a quick second press
      el.classList.add("ui-pop");
      window.setTimeout(() => el.classList.remove("ui-pop"), 300);
    };
    const onPointer = (e: PointerEvent) => { if (e.button === 0) press(e.target); };
    // Keyboard activation (Enter or Space on a focused control) arrives as a click with no pointer.
    const onClick = (e: MouseEvent) => { if (e.detail === 0) press(e.target); };
    document.addEventListener("pointerdown", onPointer, { passive: true, capture: true });
    document.addEventListener("click", onClick, { passive: true, capture: true });
    return () => { document.removeEventListener("pointerdown", onPointer, true); document.removeEventListener("click", onClick, true); };
  }, []);
}
