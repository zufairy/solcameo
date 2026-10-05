import { NextRequest, NextResponse } from "next/server";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { deleteVideoBlob } from "@/lib/server/videoStorage";

export const runtime = "nodejs";

/**
 * Delete a transient source blob from Convex storage.
 * clipStorage.deleteStorage is secret-gated (it can delete ANY object by id), so
 * the browser can no longer call it directly. This route authenticates the
 * operator (internal secret OR a valid user session — storage objects carry no
 * owner field, so any authenticated caller is allowed; storageIds are opaque),
 * then forwards the internal secret. Best-effort: the source GC must never break.
 */
export async function POST(req: NextRequest) {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { storageId?: string };
  if (!body.storageId || typeof body.storageId !== "string") {
    return NextResponse.json({ error: "missing storageId" }, { status: 400 });
  }

  // Branches on the id: "r2:<key>" deletes from R2, bare ids from Convex storage.
  const result = await deleteVideoBlob(body.storageId, { convexUrl: CONVEX_URL });
  return NextResponse.json({ ok: true, result });
}
