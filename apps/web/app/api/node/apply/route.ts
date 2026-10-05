import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { COUNTRIES } from "@/lib/node/countries";

export const runtime = "nodejs";

const PURPOSES = new Set(["business", "agents", "both"]);
const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });

/** Sign-up for the Vello Operators Call on /node. Public + anonymous, so the
 *  Convex mutation is secret-gated and only this route holds the secret. */
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!url || !secret) return NextResponse.json({ ok: false, error: "Sign-ups are not available right now." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Honeypot: real visitors never fill this hidden field.
  if (typeof body.company === "string" && body.company) return NextResponse.json({ ok: true });
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  const name = str("name"), email = str("email"), phone = str("phone"), country = str("country"), purpose = str("purpose");
  if (!name || name.length > 120) return bad("Please enter your name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 160) return bad("Please enter a valid email.");
  if (!/^\+?[0-9][0-9 ()\-.]{5,30}$/.test(phone) || phone.replace(/\D/g, "").length < 7) return bad("Please enter a valid phone number, including the country code.");
  if (!(COUNTRIES as readonly string[]).includes(country)) return bad("Please choose your country.");
  if (!PURPOSES.has(purpose)) return bad("Please tell us what you want to use a node for.");
  try {
    await new ConvexHttpClient(url).mutation(api.nodeApplications.submit, {
      authSecret: secret, fullName: name, email, phone, country, purpose,
      businessName: str("businessName") || undefined,
      telegram: str("telegram") || undefined,
      experience: str("experience") || "none",
      referer: req.headers.get("referer")?.slice(0, 300) ?? undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[node/apply] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Could not save your seat. Please try again." }, { status: 500 });
  }
}
