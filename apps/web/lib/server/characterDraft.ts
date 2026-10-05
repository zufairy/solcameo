import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "./requireAuth";
import { authorizeCharacterOwner } from "./characterAuth";

export async function authorizeCharacterScope(req: NextRequest, mint: string | null, draft: boolean) {
  if (!draft) return authorizeCharacterOwner(req, mint);
  const auth = await requireAuth(req);
  if (auth.error) return { error: auth.error };
  return { mint: `draft-${createHash("sha256").update(auth.user.id).digest("hex").slice(0, 32)}` };
}
function key() {
  const value = process.env.PRIVY_APP_SECRET;
  if (!value) throw new Error("Draft generation signing is not configured");
  return value;
}
export function issueCharacterJobTicket(scope: string, id: string) {
  const data = Buffer.from(JSON.stringify({ scope, id, exp: Date.now() + 30 * 60_000 })).toString("base64url");
  return `${data}.${createHmac("sha256", key()).update(data).digest("base64url")}`;
}
export function verifyCharacterJobTicket(ticket: string, scope: string, id: string) {
  try {
    const [data, signature, extra] = ticket.split(".");
    if (!data || !signature || extra) return false;
    const expected = createHmac("sha256", key()).update(data).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
    const value = JSON.parse(Buffer.from(data, "base64url").toString());
    return value.scope === scope && value.id === id && typeof value.exp === "number" && value.exp > Date.now();
  } catch { return false; }
}
export const invalidDraftJob = () => NextResponse.json({ error: "Generation does not belong to this draft" }, { status: 403 });
