/**
 * Number formatting in the style of Apple's Stocks and Wallet: as many digits as the size of the number deserves,
 * no trailing zeros, thousands separators, a real minus sign, and never "-0" or "+0" for a value that rounds to zero.
 */
export function formatAmount(n: number, opts: { signed?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const decimals = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.1 ? 3 : abs >= 0.01 ? 4 : abs >= 0.001 ? 5 : abs >= 0.0001 ? 6 : 7;
  const rounded = Number(abs.toFixed(decimals));
  if (rounded === 0) return "0";
  const text = rounded.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  return `${n < 0 ? "−" : opts.signed ? "+" : ""}${text}`;
}

/** Percent with one decimal and a real sign: +1.8%, −0.4%, 0%. */
export function formatPercent(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = Number(Math.abs(n).toFixed(1));
  return rounded === 0 ? "0%" : `${n < 0 ? "−" : "+"}${rounded.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

/** Large token counts: 1.2K, 3.4M, 5.6B. */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${+(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return formatAmount(n);
}

export const APPLE_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Helvetica Neue", Arial, sans-serif';
