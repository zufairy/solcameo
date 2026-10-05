// Shared ASS (Advanced SubStation) helpers used by both the caption renderer and
// the hook renderer. Extracted verbatim so the two burns format time + colour
// identically.

/** Seconds → ASS timestamp `H:MM:SS.cc`. */
export function toAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const secs = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${secs}`;
}

// ASS colour in &H00BBGGRR order. Colours may arrive from an LLM/client with only
// a string check — a non-hex value ("red") or a brace/colon-bearing one ("}{bad")
// would otherwise produce a garbage colour or break the {\c...} override block.
// Validate strictly: accept #?RGB or #?RRGGBB hex only, expand 3-digit shorthand,
// else fall back to opaque white.
export function toAssColor(hex: string, fallback = "&H00FFFFFF"): string {
  const h = (typeof hex === "string" ? hex : "").replace(/^#/, "");
  let six: string | null = null;
  if (/^[0-9a-fA-F]{6}$/.test(h)) six = h;
  else if (/^[0-9a-fA-F]{3}$/.test(h)) six = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!six) return fallback.toUpperCase();
  const r = six.slice(0, 2), g = six.slice(2, 4), b = six.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}
