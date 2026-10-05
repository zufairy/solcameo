/* Shared helpers for the admin panel. */

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function shortAddr(a?: string | null): string {
  if (!a) return "—";
  if (a === "anonymous") return "anonymous"; // pre-wallet builder sessions
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export function timeAgo(ts?: number | null, now: number = Date.now()): string {
  if (!ts) return "never";
  const diff = now - ts;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** A user counts as "online" if their last heartbeat is within ONLINE_WINDOW_MS.
 *  The client heartbeat fires every 3 min while a tab is visible, so a 5-min
 *  window tolerates one missed beat before flipping the dot off. */
export const ONLINE_WINDOW_MS = 5 * 60_000;
export function isOnline(lastSeenAt?: number | null, now: number = Date.now()): boolean {
  return !!lastSeenAt && now - lastSeenAt < ONLINE_WINDOW_MS;
}

/** Absolute calendar date for the "Registered" column (e.g. "Jul 14, 2026").
 *  Year included so old signups read unambiguously. */
export function fmtDate(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Mirrors CRON_INTERVAL_MS in convex/crons.ts.
export const CRON_INTERVAL_MS: Record<string, number> = {
  every_1m: 60_000,
  every_5m: 5 * 60_000,
  every_15m: 15 * 60_000,
  every_30m: 30 * 60_000,
  every_1h: 60 * 60_000,
  every_2h: 2 * 60 * 60_000,
  every_3h: 3 * 60 * 60_000,
  every_4h: 4 * 60 * 60_000,
  every_12h: 12 * 60 * 60_000,
  daily: 24 * 60 * 60_000,
  manual: 0,
};

export const CRON_OPTIONS = [
  "manual",
  "every_1m",
  "every_5m",
  "every_15m",
  "every_30m",
  "every_1h",
  "every_2h",
  "every_3h",
  "every_4h",
  "every_12h",
  "daily",
] as const;

export function cronLabel(cron: string): string {
  if (cron === "manual") return "Manual";
  if (cron === "daily") return "Daily";
  return cron.replace("every_", "Every ");
}

/** Computes when an enabled heartbeat is next due (ms epoch), or null. */
export function nextDue(cron: string, lastFiredAt?: number | null): number | null {
  const interval = CRON_INTERVAL_MS[cron] ?? 0;
  if (interval === 0) return null;
  return (lastFiredAt ?? 0) + interval;
}

export function dueLabel(cron: string, enabled: boolean, lastFiredAt?: number | null): string {
  if (!enabled) return "paused";
  if (cron === "manual") return "manual";
  const due = nextDue(cron, lastFiredAt);
  if (due === null) return "—";
  const diff = due - Date.now();
  if (diff <= 0) return "due now";
  const mins = Math.ceil(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  return `in ${hours}h ${mins % 60}m`;
}

/* ── "Run oracle + crank now" result summary ─────────────────────────────── */

/** The JSON body /api/oracle/run returns on success (the fields we surface). */
export type OracleRunResult = {
  due?: number;
  settled?: number;
  deferred?: number;
  skippedV2?: number;
  error?: string;
};

/** The JSON body /api/oracle/claim returns. `skipped` is a NUMBER on the normal
 *  path but a STRING ("no crank key") on the not-configured no-op; `reason` is
 *  set on a whole-tick skip (e.g. "crank signer low on SOL"). */
export type ClaimRunResult = {
  due?: number;
  claimed?: number;
  skipped?: number | string;
  reason?: string;
  error?: string;
};

/**
 * PURE formatter for the admin "Run oracle + crank now" result. Renders the
 * oracle attest tick + the claim crank into ONE status line.
 *
 * The load-bearing case: the crank returns HTTP 200 with `claimed:0, skipped>0`
 * whenever every attested submission is still inside its ~1h on-chain dispute
 * window. That is the EXPECTED outcome of attesting-then-immediately-cranking —
 * NOT an error. Rendered naively it reads as a silent "claimed 0" no-op, so this
 * spells it out and tells the admin to re-run once the window clears.
 */
export function summarizeOracleRun(input: { oracle: OracleRunResult; crank: ClaimRunResult }): string {
  const { oracle, crank } = input;

  // Oracle (attest) side.
  const settled = oracle.settled ?? 0;
  const deferred = oracle.deferred ?? 0;
  const skippedV2 = oracle.skippedV2 ?? 0;
  let oraclePart: string;
  if (oracle.error) {
    oraclePart = `Oracle error: ${oracle.error}`;
  } else {
    oraclePart = `Oracle: settled ${settled} / deferred ${deferred}`;
    if (skippedV2 > 0) oraclePart += ` · ${skippedV2} awaiting wallet`;
  }

  // Crank (claim_payout) side.
  const claimed = crank.claimed ?? 0;
  const skippedNum = typeof crank.skipped === "number" ? crank.skipped : 0;
  let crankPart: string;
  if (crank.error) {
    crankPart = `Crank error: ${crank.error}`;
  } else if (typeof crank.skipped === "string") {
    // e.g. "no crank key" — the payout keeper isn't configured.
    crankPart = `Crank not configured (${crank.skipped})`;
  } else if (claimed > 0) {
    crankPart = `Crank: claimed ${claimed}`;
    if (skippedNum > 0) crankPart += ` · ${skippedNum} still in the ~1h dispute window`;
  } else if (skippedNum > 0) {
    // HTTP 200, claimed:0, skipped>0 — the dispute-window (or signer) case.
    crankPart = crank.reason
      ? `Crank: 0 paid — ${crank.reason} (rows retry next tick)`
      : `Attested ${settled} — payouts are within the ~1h on-chain dispute window; run again after it clears`;
  } else {
    crankPart = "Crank: nothing due to pay";
  }

  return `${oraclePart} · ${crankPart}`;
}
