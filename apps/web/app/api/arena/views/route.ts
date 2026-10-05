import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const revalidate = 0;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Mirror of the deterministic vello-agent name slug used to mint the content-reward
 *  user email (`<wallet>-<slug>@wallet.vello.gg`) in lib/server/contentRewardSubmit.ts. */
function nameSlug(name: string, wallet: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, Math.max(0, 62 - wallet.length));
}

/**
 * Per-agent COLLECTED VIEWS for the Arena leaderboard.
 *
 * The scraped view counts live in Supabase `content_rewards_submissions.views`,
 * keyed by `user_id`. Each vello-agent gets a DETERMINISTIC user whose email is
 * `<creatorWallet>-<nameSlug>@wallet.vello.gg` — so we reverse that mapping to
 * attribute each user's summed views back to the exact agent mint. (Convex's own
 * `submissions.viewCount` is empty for these agents, which is why the column read
 * as all-empty before.)
 */
export async function GET() {
  if (!CONVEX_URL || !SB_URL || !SB_KEY) return NextResponse.json({});
  try {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const agents = (await convex.query(api.influencers.listAll, {})) as Array<{
      mintAddress?: string; creatorWallet?: string; name?: string;
    }>;

    // expected content-reward user email → agent mint
    const emailToMint = new Map<string, string>();
    for (const a of agents) {
      if (!a.mintAddress || !a.creatorWallet) continue;
      const w = a.creatorWallet;
      const s = nameSlug(a.name ?? "", w);
      const email = s ? `${w}-${s}@wallet.vello.gg` : `${w}@wallet.vello.gg`;
      emailToMint.set(email, a.mintAddress);
    }
    if (emailToMint.size === 0) return NextResponse.json({});

    const sb = createClient(SB_URL, SB_KEY);
    const { data: users } = await sb.from("users").select("id,email").like("email", "%wallet.vello.gg").limit(3000);
    const userToMint = new Map<string, string>();
    for (const u of (users ?? []) as Array<{ id: string; email: string }>) {
      const mint = emailToMint.get(u.email);
      if (mint) userToMint.set(u.id, mint);
    }
    if (userToMint.size === 0) return NextResponse.json({});

    const ids = [...userToMint.keys()];
    const out: Record<string, number> = {};
    // Chunk the IN() so a large roster stays within PostgREST limits.
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb
        .from("content_rewards_submissions")
        .select("user_id,views")
        .in("user_id", ids.slice(i, i + 200));
      for (const r of (data ?? []) as Array<{ user_id: string | null; views: number | null }>) {
        const v = Number(r.views) || 0;
        if (v <= 0 || !r.user_id) continue;
        const mint = userToMint.get(r.user_id);
        if (mint) out[mint] = (out[mint] ?? 0) + v;
      }
    }
    return NextResponse.json(out);
  } catch {
    return NextResponse.json({});
  }
}
