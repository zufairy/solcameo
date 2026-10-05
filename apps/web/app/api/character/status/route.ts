import { NextRequest, NextResponse } from "next/server";
import { authorizeCharacterScope, verifyCharacterJobTicket, invalidDraftJob } from "@/lib/server/characterDraft";
import { HfError } from "@/lib/server/higgsfield";
import { characterResult } from "@/lib/server/characterResult";

export const maxDuration = 30;

/** Poll one Higgsfield job; on completion copy the portrait into our R2 and return that URL. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const a0 = await authorizeCharacterScope(req, q.get("mint"), q.get("draft") === "1");
  if (a0.error) return a0.error;
  const id = q.get("id") ?? "";
  if (!verifyCharacterJobTicket(q.get("ticket") ?? "", a0.mint, id)) return invalidDraftJob();
  try {
    return NextResponse.json(await characterResult(a0.mint, id), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof HfError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: "Status check failed" }, { status: 502 });
  }
}
