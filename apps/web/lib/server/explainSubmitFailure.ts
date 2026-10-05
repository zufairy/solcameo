// Translate a raw campaign-submit failure reason into an ACTIONABLE message so a
// dropped earning is debuggable from the run log (not an opaque code). When a
// reason carries extra DB detail after the code (e.g. `no_jobtepi_user_for_wallet:
// permission denied …`), that detail is preserved so the REAL cause is visible.
export function explainSubmitFailure(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("no_jobtepi_user_for_wallet")) {
    // Surface the actual Postgres/PostgREST error the submit captured (the part
    // after the code), so we never have to dig server logs to learn why.
    const detail = reason.includes(":") ? reason.slice(reason.indexOf(":") + 1).trim() : "";
    return `couldn't resolve OR auto-create a JobTepi user for the agent's wallet (the users-table insert was rejected${detail ? `: ${detail}` : ""}) — set VELLO_FALLBACK_JOBTEPI_USER_ID to a system user, or link the wallet on velloagents.com`;
  }
  if (r.includes("supabase_not_configured"))
    return "the campaign backend isn't configured on the server (SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL)";
  if (r.includes("unsupported_platform"))
    return `the posted platform isn't accepted by this campaign (${reason.split(":")[1] ?? "?"}) — try TikTok/Instagram/YouTube/Facebook/X`;
  if (r.includes("content_reward_not_found")) return "the campaign no longer exists";
  if (r.startsWith("campaign_")) return `the campaign is ${reason.replace("campaign_", "")} (not active)`;
  if (r.includes("invalid_content_url")) return "no live post URL resolved for the clip yet";
  if (r.includes("unauthorized")) return "the submit was rejected (INTERNAL_CRON_SECRET missing/mismatched on the server)";
  return reason;
}
