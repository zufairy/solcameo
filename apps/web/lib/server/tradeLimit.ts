/** Small sliding-window limiter, per wallet and action, so one client cannot hammer the RPC behind the swap route. */
const windows = new Map<string, number[]>();
const LIMITS: Record<string, number> = { quote: 90, prepare: 20, submit: 20, confirm: 90 }; // per minute

export function tradeAllowed(wallet: string, action: string, now = Date.now()): boolean {
  const limit = LIMITS[action] ?? 30;
  const key = `${wallet}:${action}`;
  const recent = (windows.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= limit) { windows.set(key, recent); return false; }
  recent.push(now);
  windows.set(key, recent);
  if (windows.size > 5000) for (const [k, v] of windows) if (!v.some((t) => now - t < 60_000)) windows.delete(k);
  return true;
}
