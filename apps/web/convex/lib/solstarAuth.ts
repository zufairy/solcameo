/** Gate for Solstar mutations: the Next route authenticated the user, then forwards the shared secret. */
export function assertSecret(authSecret: string): void {
  const expected = process.env.INTERNAL_CRON_SECRET;
  if (!expected || authSecret !== expected) throw new Error("unauthorized");
}
