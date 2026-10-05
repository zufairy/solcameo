/**
 * layout.ts — responsive helpers so every scene works in both the
 * 1920×1080 master and the 1080×1920 vertical cut without forking code.
 *
 * `u` is a scale unit pinned to the SHORT side / 1080. Both formats share a
 * 1080 short side, so `u === 1` in each — type stays large and readable —
 * while `portrait` lets scenes flip rows→columns and re-stack hero content.
 */
import { useVideoConfig } from "remotion";

export const useLayout = () => {
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  const u = Math.min(width, height) / 1080;
  return { width, height, portrait, u };
};
