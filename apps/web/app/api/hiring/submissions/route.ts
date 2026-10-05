import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

/**
 * Admin-gated read of submitted job applications for /hiring/submissions.
 *
 * The rows carry applicant PII (email/phone/telegram/linkedin) plus signed
 * résumé download URLs, so the underlying Convex query `jobApplications.list`
 * is now secret-gated and can no longer be called from the browser. This route
 * is the only entrypoint: it authenticates the caller (Privy Bearer), confirms
 * they are an active admin (Convex `users.whoami` → isAdmin), and only then
 * forwards INTERNAL_CRON_SECRET to fetch the list. Cron/server-to-server
 * callers (valid X-Internal-Secret) are pre-trusted and skip the admin check.
 */
export async function GET(req: NextRequest) {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const convex = new ConvexHttpClient(CONVEX_URL);

  // Non-internal (real user) callers MUST be an active admin. The authoritative
  // gate is server-side: whoami verifies the Privy token and resolves the
  // Convex users doc's isAdmin flag (the same boundary as /app/admin).
  if (!auth.internal) {
    const profile = await convex.action(api.users.whoami, { accessToken: auth.token });
    if (!profile || !profile.isAdmin || profile.status === "suspended") {
      return NextResponse.json({ error: "Forbidden — admin access required" }, { status: 403 });
    }
  }

  const applications = await convex.query(api.jobApplications.list, { authSecret: secret });
  return NextResponse.json({ applications });
}
