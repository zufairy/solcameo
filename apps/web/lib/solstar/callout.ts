export const CALLOUT_THEMES = {
  colosseum: { name: "Colosseum", accent: "#c8f02a", background: "#0b1008" },
  solana: { name: "Solana", accent: "#14f195", background: "#111020" },
  lambo: { name: "Lambo", accent: "#facc15", background: "#171406" },
  bullrun: { name: "Bullrun", accent: "#7de2b2", background: "#06120f" },
  neon: { name: "Neon", accent: "#e879f9", background: "#190b20" },
  ferrari: { name: "Ferrari", accent: "#ff4b43", background: "#140b0c" },
  vault: { name: "Vault", accent: "#e2c58a", background: "#16130d" },
  aurora: { name: "Aurora", accent: "#a8dffb", background: "#0a0e1e" },
} as const;
export type CalloutTheme = keyof typeof CALLOUT_THEMES;
export type CalloutMetric = "earnings" | "views" | "trade";
export function calloutTheme(theme?: string) {
  return CALLOUT_THEMES[theme as CalloutTheme] ?? CALLOUT_THEMES.colosseum;
}
export function formatCalloutMoney(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, notation: Math.abs(value) >= 1000 ? "compact" : "standard" }).format(value);
}
