import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { convexClient, internalSecret } from "@/lib/server/solstarRoute";

export const runtime = "nodejs";

/**
 * Reports whether this deployment's INTERNAL_CRON_SECRET matches the Convex deployment it talks to.
 * A mismatch makes every secret-gated action (creating coins, callouts, replies, view sync) fail.
 * Returns only a boolean and a hint, never a secret value.
 */
export async function GET() {
  if (!internalSecret()) return NextResponse.json({ ok: false, reason: "INTERNAL_CRON_SECRET is not set on the web app" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    await convexClient().query(api.solstarCreate.authPing, { authSecret: internalSecret()! });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const unauthorized = e instanceof Error && e.message.includes("unauthorized");
    return NextResponse.json(
      { ok: false, reason: unauthorized ? "INTERNAL_CRON_SECRET on the web app does not match the Convex deployment" : "Convex is unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
