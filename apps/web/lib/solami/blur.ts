/**
 * Server-side client for Solami's Blur data API (decoded trades, launches, liquidity, candles) and its public Beam landing lookup.
 * The data key (SOLAMI_DATA_API_KEY, a key whose role grants only DataApi) never leaves the server: browsers talk to our own
 * /api/pulse routes. Every fractional value Blur returns is a decimal string, so parse before doing arithmetic.
 */
export const SOLAMI_API = "https://api.solami.dev";
export const SOLAMI_BLUR_WS = "wss://ws.solami.dev/data/subscribe";

export const solamiDataKey = () => (process.env.SOLAMI_DATA_API_KEY || process.env.SOLAMI_API_KEY || "").trim();

export class BlurError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function blurGet<T>(path: string, params: Record<string, string | number | undefined> = {}, timeoutMs = 6000): Promise<T> {
  const key = solamiDataKey();
  if (!key) throw new BlurError("Solami data key is not configured", 503);
  const url = new URL(path, SOLAMI_API);
  url.searchParams.set("chain", "solana");
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  url.searchParams.set("api_key", key);
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new BlurError(`Blur ${path} failed (${res.status})`, res.status);
  return (await res.json()) as T;
}

export type TokenWindowStats = {
  trades: number; buys: number; sells: number; traders: number;
  volume_usd: string; fees_usd: string; open: string; high: string; low: string; close: string; price_change_pct: string;
};
export type TokenStats = { mint: string; primary_pool: string; windows: Record<string, TokenWindowStats> };

/** Activity and price movement for one token over several lookback windows (seconds), in one call. */
export const fetchTokenStats = (mint: string, windows: number[]) =>
  blurGet<TokenStats>("/data/token/stats", { address: mint, windows: windows.join(",") });

export type LandingStatus = {
  signature: string; is_landed: boolean; landed_via_jito: boolean; rebroadcasted: boolean; region: string | null;
  tip_lamports: number | null; tip_address: string | null; bundle_uuid: string | null;
  first_seen_ms: number | null; forwarded_ms: number | null; timestamp: number | null;
};

/** Beam's public "did it land" lookup. Needs no key. Returns null for a signature Beam never saw. */
export async function fetchLanding(signature: string): Promise<LandingStatus | null> {
  const res = await fetch(`${SOLAMI_API}/swqos/tx/${signature}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new BlurError(`Beam lookup failed (${res.status})`, res.status);
  return (await res.json()) as LandingStatus;
}

export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
