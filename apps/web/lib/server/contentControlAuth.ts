import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
export async function contentControlAdmin(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!url || !secret) return { error: NextResponse.json({ error: "Content Control backend is not configured" }, { status: 503 }) };
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: NextResponse.json({ error: "Sign in as an admin" }, { status: 401 }) };
  const convex = new ConvexHttpClient(url);
  const result = await convex.action(api.submissions.checkAdminToken, { accessToken: token });
  if (!result.admin) return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  return { convex, secret };
}
