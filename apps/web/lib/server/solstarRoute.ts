import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { requireAuth, getProvenWalletFromRequest, siwsRequiredResponse } from "./requireAuth";

const tooLarge = () => NextResponse.json({ error: "body_too_large" }, { status: 413 });

/**
 * Reads and parses a JSON body with a hard byte bound. Never calls req.json():
 * an oversize Content-Length is rejected up front and the stream is cancelled
 * as soon as the byte budget is exceeded.
 */
export async function readBoundedJson(req: NextRequest, maxBytes = 4096):
  Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, res: tooLarge() };
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, res: tooLarge() };
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
  try { return { ok: true, body: JSON.parse(new TextDecoder().decode(merged)) }; }
  catch { return { ok: false, res: NextResponse.json({ error: "invalid_json" }, { status: 400 }) }; }
}

const INT64_MAX = 9223372036854775807n;

/** Digits-only string within Convex int64 range, else null. */
export function parseBigint(v: unknown): bigint | null {
  if (typeof v !== "string" || !/^\d{1,19}$/.test(v)) return null;
  const n = BigInt(v);
  return n > INT64_MAX ? null : n;
}

export async function requireProvenWallet(req: NextRequest): Promise<{ wallet: string } | { res: NextResponse }> {
  const auth = await requireAuth(req);
  if (auth.error) return { res: auth.error };
  const wallet = getProvenWalletFromRequest(req, auth.user);
  if (!wallet) return { res: siwsRequiredResponse() };
  return { wallet };
}

/** Shared secret the Convex solstar mutations require; null when not configured. */
export function internalSecret(): string | null {
  const s = process.env.INTERNAL_CRON_SECRET;
  return s ? s : null;
}

export function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Convex not configured");
  return new ConvexHttpClient(url);
}

/**
 * Common prelude for authenticated mutation routes: session + SIWS proof,
 * server secret present, bounded JSON object body. Convex is never touched here.
 */
export async function prepareAuthedJson(req: NextRequest, maxBytes = 4096):
  Promise<{ ok: true; wallet: string; secret: string; body: Record<string, unknown> } | { ok: false; res: NextResponse }> {
  const who = await requireProvenWallet(req);
  if ("res" in who) return { ok: false, res: who.res };
  const secret = internalSecret();
  if (!secret) return { ok: false, res: NextResponse.json({ error: "server_misconfigured" }, { status: 500 }) };
  const parsed = await readBoundedJson(req, maxBytes);
  if (!parsed.ok) return parsed;
  const body = parsed.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, res: NextResponse.json({ error: "invalid_body" }, { status: 400 }) };
  }
  return { ok: true, wallet: who.wallet, secret, body: body as Record<string, unknown> };
}

/** Convex document ids are opaque alphanumeric strings. */
export function isConvexIdString(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= 64 && /^[A-Za-z0-9]+$/.test(v);
}

/** JSON.stringify cannot serialize bigint; render those as decimal strings. */
export function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
}

const STATUS: Record<string, number> = {
  quote_expired: 409, slippage_exceeded: 409, idempotency_conflict: 409,
  insufficient_balance: 422, insufficient_position: 422,
  invalid_amount: 400, not_paper_token: 400, invalid_wallet: 400, invalid_key: 400,
  token_not_found: 404, character_not_found: 404,
  rate_limited: 429, invalid_body: 400, duplicate_message: 409,
  ticker_taken: 409, create_limit: 429,
  invalid_name: 400, invalid_ticker: 400, invalid_bio: 400, invalid_category: 400, invalid_image: 400, rights_required: 400,
};
const INVALID_ID_MARKERS = ["Invalid argument", "ArgumentValidationError", "Unable to decode"];

export function errorResponse(e: unknown): NextResponse {
  const msg = e instanceof Error ? e.message : "";
  const code = Object.keys(STATUS).find((k) => msg.includes(k));
  if (code) return NextResponse.json({ error: code }, { status: STATUS[code] });
  if (INVALID_ID_MARKERS.some((m) => msg.includes(m))) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
