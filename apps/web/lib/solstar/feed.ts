/** Display helpers for the Solstar feed. Never expose a full wallet address. */

/** `abcd…wxyz`: first 4 + ellipsis + last 4. Inputs of 8 chars or fewer are returned as is. */
export function shortWallet(w: string): string {
  if (w.length <= 8) return w;
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}
