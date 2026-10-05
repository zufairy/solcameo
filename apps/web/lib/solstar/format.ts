/** Pure display formatters for Solstar money. BigInt math only; no floats on money. */

const DASH = "—";
const LAMPORTS_PER_SOL = 1_000_000_000n;
const SOL_DECIMALS = 9;
const UINT = /^\d+$/;
const INT = /^-?\d+$/;

/** Truncate (never round up) to `decimals` places, trimming trailing zeros. */
function truncated(whole: bigint, frac: bigint, decimals: number): string {
  const f = frac.toString().padStart(SOL_DECIMALS, "0").slice(0, decimals).replace(/0+$/, "");
  return f ? `${whole}.${f}` : `${whole}`;
}

export function formatSol(lamports: string, maxDecimals = 4): string {
  if (!UINT.test(lamports)) return DASH;
  const requested = Number.isFinite(maxDecimals) ? maxDecimals : 4;
  const d = Math.max(0, Math.min(SOL_DECIMALS, Math.floor(requested)));
  const l = BigInt(lamports);
  const out = truncated(l / LAMPORTS_PER_SOL, l % LAMPORTS_PER_SOL, d);
  if (l > 0n && out === "0") {
    return d === 0 ? "<1" : `<0.${"0".repeat(d - 1)}1`;
  }
  return out;
}

/** Truncates toward zero to 0.1% (does not round); |bps| < 10 shows "0.0%". */
export function formatPct(bps: string): string {
  if (!INT.test(bps)) return DASH;
  const v = BigInt(bps);
  const neg = v < 0n;
  const tenths = (neg ? -v : v) / 10n; // truncate toward zero
  if (tenths === 0n) return "0.0%";
  const text = `${tenths / 10n}.${tenths % 10n}%`;
  return neg ? `-${text}` : `+${text}`;
}

const TIERS: ReadonlyArray<readonly [bigint, string]> = [
  [LAMPORTS_PER_SOL * 1_000_000_000n, "B"],
  [LAMPORTS_PER_SOL * 1_000_000n, "M"],
  [LAMPORTS_PER_SOL * 1_000n, "K"],
];

export function formatCompactSol(lamports: string): string {
  if (!UINT.test(lamports)) return DASH;
  const l = BigInt(lamports);
  for (const [unit, suffix] of TIERS) {
    if (l >= unit) {
      const tenth = ((l % unit) * 10n) / unit;
      return `${l / unit}${tenth > 0n ? `.${tenth}` : ""}${suffix}`;
    }
  }
  return formatSol(lamports, 3);
}
