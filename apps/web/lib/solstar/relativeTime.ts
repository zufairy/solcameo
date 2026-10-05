/** "just now" (<5s), "12s ago", "3m ago", "2h ago", "5d ago". Future/NaN inputs read "just now". */
export function formatRelativeTime(nowMs: number, thenMs: number): string {
  if (!Number.isFinite(nowMs) || !Number.isFinite(thenMs)) return "just now";
  const s = Math.floor((nowMs - thenMs) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
