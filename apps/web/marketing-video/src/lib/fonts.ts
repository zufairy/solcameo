/**
 * fonts.ts — load brand fonts once and export ready-to-use family names.
 *
 * Display: Space Grotesk (geometric, confident) for big kinetic headlines.
 * UI/heavy: Inter for tight supporting copy + chips.
 * Mono: JetBrains Mono for labels, tickers, tx hashes (the "infra" texture).
 * Serif: Instrument Serif (italic) for the tagline accent.
 */
import { loadFont as loadDisplay } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";

export const display = loadDisplay().fontFamily;
export const ui = loadInter().fontFamily;
export const mono = loadMono().fontFamily;
export const serif = loadSerif().fontFamily;
