/**
 * swarm/theme.ts — visual language for the SWARM film (the new direction).
 *
 * Volt world: near-black with a green-charged atmosphere. VOLT is the hero —
 * the lo.png glyph green. White does the talking, volt does the shouting.
 * Violet survives only as a deep secondary so the world still feels Vello.
 */
export const SW = {
  bg: "#070A07", // near-black, green-leaning
  bg2: "#0B0F0A",
  card: "#10140E",
  cardHi: "#161B12",
  border: "#252B20",
  borderHi: "#39422C",

  white: "#F7F8F4",
  sub: "#9AA694",
  faint: "#5E685A",

  volt: "#C6F222", // hero — lo.png glyph green
  voltDeep: "#9BD400",
  voltSoft: "#DDFB6A",
  emerald: "#10B981",
  cyan: "#22D3EE",
  violet: "#8B5CF6", // secondary flavor only
  pink: "#EC4899",
  amber: "#F59E0B",
  red: "#F4506A",
} as const;

export const swGlow = (color: string, blur = 60, alpha = "66") =>
  `0 0 ${blur}px ${color}${alpha}`;

export const swTextGlow = (color: string, blur = 50) =>
  `0 0 ${blur}px ${color}55, 0 2px 24px rgba(0,0,0,0.55)`;

/** Per-agent flavor tints so the swarm never reads as one template. */
export const AGENT_TINTS = [
  SW.volt,
  SW.cyan,
  SW.violet,
  SW.pink,
  SW.amber,
  SW.emerald,
] as const;
