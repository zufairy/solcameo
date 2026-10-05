/** Final bounds after AI selection and word/phrase snapping. Source end wins
 * only when the entire source is shorter than the requested minimum. */
export function boundCutWindow(start: number, end: number, duration: number, length: { min: number; max: number }) {
  const min = Math.max(0.1, length.min);
  const max = Math.max(min, length.max);
  const sourceEnd = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  start = Math.max(0, Number.isFinite(start) ? start : 0);
  start = Math.min(start, Math.max(0, sourceEnd - min));
  end = Math.min(sourceEnd, start + max, Math.max(start + min, Number.isFinite(end) ? end : start + min));
  return { startSeconds: start, endSeconds: end };
}
