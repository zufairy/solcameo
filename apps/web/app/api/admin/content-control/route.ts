import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { contentControlAdmin } from "@/lib/server/contentControlAuth";
import { generateConnectUrl, getProfile, isConfigured, resolveUsername } from "@/lib/server/uploadPost";
import { MARKETING_PROFILE, compatiblePlatforms } from "@/lib/server/contentPublishing";
import { cleanMarketingText } from "@/lib/marketingCaption";
import { assertPublicHttpUrl } from "@/lib/server/downloader";
import type { Id } from "@/convex/_generated/dataModel";
export const runtime = "nodejs";
export const maxDuration = 60;
const target = z.string().min(1).max(150).optional();
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), targetMint: target }),
  z.object({ action: z.literal("settings"), targetMint: target, autoAnnounce: z.boolean().optional(), autoMilestones: z.boolean().optional() }),
  z.object({ action: z.literal("publish"), targetMint: target, caption: z.string().min(1).max(5000), kind: z.enum(["text", "photo", "video"]), mediaUrl: z.string().url().optional(), key: z.string().uuid() }),
  z.object({ action: z.literal("retry"), id: z.string().min(1) }),
]);
export async function GET(req: NextRequest) {
  const auth = await contentControlAdmin(req);
  if (auth.error) return auth.error;
  try {
    const data = await auth.convex.query(api.contentControl.state, { authSecret: auth.secret });
    const selected = req.nextUrl.searchParams.get("targetMint") || undefined;
    if (selected && !data.agents.some(a => a.mintAddress === selected)) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    let profile: Awaited<ReturnType<typeof getProfile>> = { connected: {}, exists: false };
    let profileError: string | undefined;
    if (isConfigured()) {
      try { profile = await getProfile(selected ? resolveUsername(selected) : MARKETING_PROFILE); }
      catch (e) { profileError = e instanceof Error ? e.message : "Unable to read connected accounts"; }
    }
    return NextResponse.json({ ...data, configured: isConfigured(), connected: profile.connected, exists: profile.exists, profileError }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Unable to load Content Control" }, { status: 502 }); }
}
export async function POST(req: NextRequest) {
  const auth = await contentControlAdmin(req);
  if (auth.error) return auth.error;
  try {
    const parsed = input.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid Content Control request" }, { status: 400 });
    const body = parsed.data;
    const authSecret = auth.secret;
    if (body.action === "retry") {
      await auth.convex.mutation(api.contentControl.retry, { authSecret, id: body.id as Id<"contentControlPosts"> });
      return NextResponse.json({ ok: true });
    }
    if (body.targetMint) {
      const agent = await auth.convex.query(api.influencers.getByMintServer, { authSecret, mintAddress: body.targetMint });
      if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const username = body.targetMint ? resolveUsername(body.targetMint) : MARKETING_PROFILE;
    if (body.action === "connect") {
      const url = await generateConnectUrl(username, { redirectUrl: `${req.nextUrl.origin}/admin/content-control${body.targetMint ? `?targetMint=${encodeURIComponent(body.targetMint)}` : ""}`, title: "Connect Vello marketing accounts", description: "Connect accounts for Content Control publishing." });
      return NextResponse.json({ ok: true, url });
    }
    if (body.action === "settings") {
      // Auto-posting is always on; saving a destination only needs its X account to be connected.
      const profile = await getProfile(username);
      if (!profile.connected.x) return NextResponse.json({ error: "Connect X on this account before using it for automatic posts" }, { status: 400 });
      await auth.convex.mutation(api.contentControl.settings, { authSecret, targetMint: body.targetMint });
      return NextResponse.json({ ok: true });
    }
    const caption = cleanMarketingText(body.caption);
    if (!caption) return NextResponse.json({ error: "Write a caption first" }, { status: 400 });
    if (body.kind !== "text" && !body.mediaUrl) return NextResponse.json({ error: "Upload an image or video first" }, { status: 400 });
    if (body.mediaUrl) await assertPublicHttpUrl(body.mediaUrl);
    const profile = await getProfile(username);
    const connected = Object.entries(profile.connected).filter(([, account]) => account).map(([id]) => id);
    const platforms = compatiblePlatforms(connected, body.kind);
    if (!platforms.length) return NextResponse.json({ error: "No connected accounts support this content type" }, { status: 400 });
    const skipped = connected.filter(p => !platforms.includes(p));
    const id = await auth.convex.mutation(api.contentControl.queue, { authSecret, dedupeKey: `manual:${body.key}`, targetMint: body.targetMint, caption, mediaUrl: body.mediaUrl, kind: body.kind, platforms });
    return NextResponse.json({ ok: true, id, platforms, skipped });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Content Control request failed" }, { status: 502 }); }
}
