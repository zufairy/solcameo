import { NextRequest, NextResponse } from "next/server";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { createNftTask } from "@/lib/server/nftKie";
import { buildDesignSheetPrompts } from "@/lib/server/characterDesign";

/**
 * CREATE step for a character design sheet — kicks off one KIE image task per view
 * and returns immediately.
 *
 * Split create/collect for the same reason the NFT-avatar routes are: holding an
 * HTTP request open while KIE renders blows past Railway's proxy window and the
 * browser gets an HTML error page instead of JSON. The client polls /collect.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const KIE_KEY = process.env.KIE_API_KEY ?? "";

export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!KIE_KEY) return NextResponse.json({ error: "KIE_API_KEY is not set" }, { status: 500 });

  let body: { name?: string; description?: string; medium?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const description = (body.description ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (description.length < 8) {
    return NextResponse.json({ error: "Describe the character in a bit more detail (colour, body, one distinctive feature)." }, { status: 400 });
  }

  const prompts = buildDesignSheetPrompts({ name, description, medium: body.medium });
  try {
    const tasks = await Promise.all(
      prompts.map(async ({ view, prompt }) => ({ view, taskId: await createNftTask(prompt) })),
    );
    return NextResponse.json({ ok: true, tasks });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "could not start the design sheet" }, { status: 502 });
  }
}
