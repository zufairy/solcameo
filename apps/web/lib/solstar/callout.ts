/** The five card themes. Each has its own three.js animation (components/solstar/calloutThemes3d.ts). */
export const CALLOUT_THEMES = {
  solana: { name: "Solana", accent: "#14f195", background: "#0d0b1a" },
  lambo: { name: "Lambo", accent: "#facc15", background: "#13110a" },
  pepe: { name: "Frog", accent: "#7be35a", background: "#0a140b" },
  bullrun: { name: "Bull run", accent: "#34d399", background: "#06120f" },
  diamond: { name: "Diamond hands", accent: "#7dd3fc", background: "#07111c" },
} as const;
export type CalloutTheme = keyof typeof CALLOUT_THEMES;
export const DEFAULT_CALLOUT_THEME: CalloutTheme = "solana";
/** Callouts posted before the theme cut keep working: each old theme maps to the closest current one. */
const LEGACY_THEMES: Record<string, CalloutTheme> = { colosseum: "solana", neon: "solana", ferrari: "lambo", vault: "diamond", aurora: "diamond" };
export const resolveCalloutTheme = (theme?: string): CalloutTheme => (theme && theme in CALLOUT_THEMES ? theme as CalloutTheme : theme ? LEGACY_THEMES[theme] : undefined) ?? DEFAULT_CALLOUT_THEME;
export type CalloutMetric = "earnings" | "views" | "trade";
export function calloutTheme(theme?: string) {
  const key = resolveCalloutTheme(theme);
  return { key, ...CALLOUT_THEMES[key] };
}
export function formatCalloutMoney(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, notation: Math.abs(value) >= 1000 ? "compact" : "standard" }).format(value);
}
