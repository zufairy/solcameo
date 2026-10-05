/**
 * Minimal money-path alerter (ORA-3).
 *
 * `sendAlert(event, detail)` POSTs a compact JSON payload to
 * `VELLO_ALERT_WEBHOOK_URL` (Slack incoming-webhook compatible: `{ text, ... }`).
 * When the env var is unset it degrades to a `console.warn`. It is deliberately
 * FAIL-SAFE: it NEVER throws and NEVER blocks a payout. Every failure mode
 * (missing url, non-2xx response, network error, timeout) is swallowed and logged.
 * Callers may `await` it — it resolves fast and to `void`.
 *
 * This module is imported from BOTH the Next.js node runtime (oracle routes) and
 * the Convex action runtime (crons), so it only uses ubiquitous globals (`fetch`,
 * `process.env`) and guards optional ones (`AbortController` / `setTimeout`).
 */

const ALERT_TIMEOUT_MS = 4000;

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export async function sendAlert(event: string, detail?: Record<string, unknown>): Promise<void> {
  const url = process.env.VELLO_ALERT_WEBHOOK_URL?.trim();
  const detailStr = detail ? safeJson(detail) : "";
  const logLine = `[vello-alert] ${event}${detailStr ? ` ${detailStr}` : ""}`;

  // No webhook configured → log at info level (still visible in logs). Kept off
  // console.warn so it can't perturb warn-based observability assertions — the
  // caller already warns the underlying problem; this is the secondary escalation.
  if (!url) {
    console.info(logLine);
    return;
  }

  try {
    const payload = {
      // Slack incoming-webhook shape (also fine for a generic JSON webhook).
      text: `:rotating_light: *vello* \`${event}\`${detailStr ? `\n\`\`\`${detailStr}\`\`\`` : ""}`,
      event,
      detail: detail ?? {},
      ts: new Date().toISOString(),
    };

    // Bound the request so a hung webhook can never stall a payout tick. Guarded so
    // the module still works in runtimes without AbortController/setTimeout.
    let signal: AbortSignal | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (typeof AbortController !== "undefined") {
      const controller = new AbortController();
      signal = controller.signal;
      if (typeof setTimeout !== "undefined") {
        timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
      }
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
      if (!res.ok) {
        console.warn(`${logLine} — webhook responded ${res.status}`);
      }
    } finally {
      if (timer !== undefined && typeof clearTimeout !== "undefined") clearTimeout(timer);
    }
  } catch (e) {
    // Alerting must NEVER break the caller.
    console.warn(`${logLine} — webhook POST failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
