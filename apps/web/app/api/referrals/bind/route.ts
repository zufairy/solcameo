import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { prepareAuthedJson } from "@/lib/server/solstarRoute";

export const runtime = "nodejs";

const MESSAGES: Record<string, string> = {
  unknown_code: "That referral code does not exist.",
  self_referral: "You cannot use your own referral code.",
  already_bound: "This wallet already has a referrer.",
  loop: "That referral would create a loop.",
};

/** Attach a referral code to the signed-in wallet. Once only, and never to yourself. */
export async function POST(req: NextRequest) {
  const prep = await prepareAuthedJson(req, 512);
  if (!prep.ok) return prep.res;
  const code = typeof prep.body.code === "string" ? prep.body.code.trim() : "";
  if (!/^[A-Za-z0-9]{4,16}$/.test(code)) return NextResponse.json({ error: "Invalid code." }, { status: 400 });
  try {
    const result = await new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).mutation(api.referrals.bind, { refereeWallet: prep.wallet, code, authSecret: prep.secret });
    if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason, error: MESSAGES[result.reason] ?? "Could not apply this code." }, { status: result.reason === "already_bound" ? 200 : 422 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 120) : "unavailable" }, { status: 502 });
  }
}
