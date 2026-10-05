// Shared helpers for the Render Studio NDJSON streaming routes.
import { NextResponse, type NextRequest } from "next/server";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";

/** Authenticates like the other video routes; returns a stable per-user key or an error response. */
export async function studioAuth(req: NextRequest): Promise<{ key: string } | { error: NextResponse }> {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return { error: auth.error };
  if (auth.internal) return { key: "internal" };
  const err = requireSiwsSession(auth);
  if (err) return { error: err };
  return { key: auth.user.id };
}

const hits = new Map<string, number[]>();
/** Sliding-window limiter (per process). Returns seconds to wait, or 0 when allowed. */
export function rateLimit(bucket: string, key: string, max: number, windowMs: number): number {
  const k = `${bucket}:${key}`;
  const now = Date.now();
  const arr = (hits.get(k) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return Math.ceil((arr[0] + windowMs - now) / 1000);
  arr.push(now);
  hits.set(k, arr);
  return 0;
}

export function ndjson(run: (send: (o: unknown) => void, signal: AbortSignal) => Promise<void>): Response {
  const enc = new TextEncoder();
  const ctl = new AbortController();
  const stream = new ReadableStream({
    async start(c) {
      const send = (o: unknown) => { try { c.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { /* client gone */ } };
      try { await run(send, ctl.signal); } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally { try { c.close(); } catch { /* already closed */ } }
    },
    cancel() { ctl.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
