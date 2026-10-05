/** Display conversion only; settlement amounts remain in their native currency. */
export function formatUsdcEstimate(lamports: string, rate: number | null): string {
  if (rate == null || !Number.isFinite(rate) || rate <= 0 || !/^\d+$/.test(lamports)) return "—";
  const amount = Number(lamports) / 1e9 * rate;
  if (!Number.isFinite(amount)) return "—";
  if (amount > 0 && amount < 0.01) return "<0.01";
  return new Intl.NumberFormat("en-US", { notation: amount >= 1000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(amount);
}

export function activityInUsdc(body: string, rate: number | null): string {
  return body.replace(/(<)?(\d+(?:\.\d+)?) SOL\b/g, (_match, less, amount) => {
    const converted = formatUsdcEstimate(String(Math.round(Number(amount) * 1e9)), rate);
    return `${less && converted !== "—" && !converted.startsWith("<") ? "<" : ""}${converted} USDC`;
  });
}

export function formatUsdEstimate(lamports: string, rate: number | null): string {
  const neg = lamports.startsWith("-");
  const value = formatUsdcEstimate(neg ? lamports.slice(1) : lamports, rate);
  return value === "—" ? value : `${neg ? "−" : ""}$${value}`;
}

export function activityInUsd(body: string, rate: number | null): string {
  return body.replace(/(<)?(\d+(?:\.\d+)?) SOL\b/g, (_match, less, amount) => {
    const converted = formatUsdEstimate(String(Math.round(Number(amount) * 1e9)), rate);
    return `${less && converted !== "—" && !converted.includes("<") ? "<" : ""}${converted} USD`;
  });
}
