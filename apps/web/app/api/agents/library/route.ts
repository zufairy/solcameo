import { NextRequest, NextResponse } from "next/server";
import { authorizeCharacterOwner } from "@/lib/server/characterAuth";
import { getR2Object, putR2Object, r2Configured } from "@/lib/server/videoStorage";

export const maxDuration = 20;

const KINDS = ["photo", "video", "carousel", "motion"] as const;
const MAX_ITEMS = 300;
const keyFor = (mint: string, kind: string) => `agents/${mint}/library-${kind}.json`;

/** Per-agent generation library (settled photos / videos / carousels) so it follows the agent across devices. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const a = await authorizeCharacterOwner(req, q.get("mint"));
  if (a.error) return a.error;
  const kind = q.get("kind") ?? "";
  if (!(KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "Bad kind" }, { status: 400 });
  try {
    const raw = await getR2Object(keyFor(a.mint, kind));
    const items = raw ? (JSON.parse(raw) as { items?: unknown[] }).items ?? [] : [];
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ items: [] });
  }
}

export async function PUT(req: NextRequest) {
  if (!r2Configured()) return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { mintAddress?: string; kind?: string; items?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const a = await authorizeCharacterOwner(req, body.mintAddress ?? null);
  if (a.error) return a.error;
  if (!(KINDS as readonly string[]).includes(body.kind ?? "")) return NextResponse.json({ error: "Bad kind" }, { status: 400 });
  if (!Array.isArray(body.items)) return NextResponse.json({ error: "items required" }, { status: 400 });
  const items = body.items.filter((i) => i && typeof i === "object").slice(0, MAX_ITEMS);
  const json = JSON.stringify({ items, updatedAt: Date.now() });
  if (json.length > 2_000_000) return NextResponse.json({ error: "Library too large" }, { status: 413 });
  await putR2Object(keyFor(a.mint, body.kind!), json);
  return NextResponse.json({ ok: true, count: items.length });
}
