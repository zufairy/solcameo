import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { readX } from "@/lib/server/xApi";
import { resolveUsername } from "@/lib/server/uploadPost";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  try {
    const { mintAddress, videoUrl, title } = await req.json();
    if (typeof mintAddress !== "string" || !mintAddress || typeof videoUrl !== "string" || !videoUrl.startsWith("https://"))
      return NextResponse.json({ ok: false, error: "Choose an agent and a saved video." }, { status: 400 });
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const secret = process.env.INTERNAL_CRON_SECRET ?? "";
    const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
    if (!agent) return NextResponse.json({ ok: false, error: "Agent not found." }, { status: 404 });
    if (!auth.internal) {
      const error = requireOwnerWithSiws(auth, agent);
      if (error) return error;
    }
    if (!await readX(resolveUsername(mintAddress)))
      return NextResponse.json({ ok: false, error: "Reconnect X in this agent’s Connections to enable direct X API posting." }, { status: 409 });
    const result = await convex.mutation(api.scheduledContent.repostVideo, {
      mintAddress, videoUrl, title: typeof title === "string" ? title : "Video", authSecret: secret,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to queue repost." }, { status: 400 });
  }
}
