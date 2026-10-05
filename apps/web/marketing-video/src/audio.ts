/**
 * audio.ts — music wiring + beat map.
 *
 * The film is cut to a 124 BPM grid. At 60fps one beat = 60 / (124/60) ≈
 * 29.03 frames. Major motions land on the bar lines below. Drop a licensed
 * track at `public/audio/track.mp3`, flip HAS_AUDIO to true, and it lines up.
 *
 * If your track's BPM differs, set BPM here and (optionally) nudge AUDIO_OFFSET
 * so beat 1 lands on the hook's first word (~frame 6). The visuals don't move.
 */
export const HAS_AUDIO = false; // ← set true once public/audio/track.mp3 exists
export const AUDIO_SRC = "audio/track.mp3";

export const BPM = 124;
export const FPS = 60;
/** frames per beat */
export const FRAMES_PER_BEAT = (FPS * 60) / BPM; // ≈ 29.03
/** shift the whole track so beat 1 hits the first headline word */
export const AUDIO_OFFSET_FRAMES = 0;

/**
 * Beat map — frame at each major motion the score should accent.
 * (For reference / when re-cutting music; visuals already hit these.)
 */
export const BEATS = {
  hookFirstWord: 6,
  hookGlowPulse: 150,
  problemLine1: 200, // ~scene start 180 + 20
  problemLine2: 272,
  revealCardLands: 204, // ~scene start 480 - overlaps + 24
  step1: 480 + 360 - 360, // start of how-it-works steps region (approx)
  platformRow: 1100,
  cloudAgent: 1240,
  earnGrid: 1560,
  visionTitle: 1820,
  ctaChip: 2010,
} as const;
