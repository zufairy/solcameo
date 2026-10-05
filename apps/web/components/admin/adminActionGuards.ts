/* Pure guards for the admin console's destructive / on-chain actions.
 * Kept side-effect-free so they can be unit-tested in isolation. */

/**
 * Type-to-confirm gate for a destructive action (e.g. Delete agent). The
 * operator must type the target string EXACTLY — trimmed and case-insensitive —
 * to unlock the action. An empty target OR empty input never matches, so the
 * confirm button can't be armed by leaving the field blank.
 */
export function confirmMatches(input: string, target: string): boolean {
  const a = input.trim().toLowerCase();
  const b = target.trim().toLowerCase();
  if (a.length === 0 || b.length === 0) return false;
  return a === b;
}

/**
 * Parse a USDC amount from a free-text input for a money-moving action. Valid =
 * a finite, strictly-positive number. Rounds to cents so the on-chain transfer
 * and the displayed amount agree (the escrow tx floors to 6dp micro-USDC).
 */
export function parseAmount(input: string): { valid: boolean; amount: number } {
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n) || n <= 0) return { valid: false, amount: 0 };
  return { valid: true, amount: Math.round(n * 100) / 100 };
}
