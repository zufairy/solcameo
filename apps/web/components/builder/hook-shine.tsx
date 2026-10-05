"use client";

import type { HookMotion } from "@/lib/builder/hookDesigns";
import { HookStreak } from "@/components/builder/hook-fx-preview";

/**
 * CSS mirror of the burned hook "shine" (lib/server/hookFxAss shineEvents): a
 * diagonal, softly blurred light streak with a bright core that glides across
 * the box once per `periodSec`. Drop it inside a `relative overflow-hidden` box.
 */
export function HookShine({ motion, heightPx }: { motion?: HookMotion; heightPx?: number }) {
  return <HookStreak motion={motion} heightPx={heightPx} />;
}
