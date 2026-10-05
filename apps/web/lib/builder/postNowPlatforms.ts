// Resolve which connected platforms a manual "Post now" should publish to.
// Auto-post (drip) respects the agent's CONFIGURED platforms; but "Post now" is a
// manual test affordance that must always work with whatever the operator has
// connected. So: prefer configured ∩ connected, but FALL BACK to all connected
// when the agent's configured platforms don't overlap what's connected — otherwise
// the button is silently disabled even though a social account IS connected (e.g.
// agent configured for TikTok, operator connected Instagram).
export function effectivePostNowPlatforms(configured: string[], connected: string[]): string[] {
  if (configured.length === 0) return connected;
  const intersection = connected.filter((p) => configured.includes(p));
  return intersection.length > 0 ? intersection : connected;
}
