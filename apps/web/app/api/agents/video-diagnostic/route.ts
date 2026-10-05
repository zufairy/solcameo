import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export const maxDuration = 30;

/**
 * GET /api/agents/video-diagnostic?mintAddress=...
 *
 * Quick check that everything the video pipeline needs is in place.
 * Use this before firing real generations to debug why videos aren't working.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mintAddress = url.searchParams.get("mintAddress");

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  // 1. KIE_API_KEY present
  const kieKey = process.env.KIE_API_KEY?.trim();
  checks.push({
    name: "KIE_API_KEY",
    ok: Boolean(kieKey),
    detail: kieKey ? `set (${kieKey.length} chars)` : "missing from env",
  });

  // 2. Kie API reachable + key valid (cheap query to recordInfo with bad id returns 200)
  if (kieKey) {
    try {
      const res = await fetch("https://api.kie.ai/api/v1/jobs/recordInfo?taskId=ping", {
        headers: { Authorization: `Bearer ${kieKey}` },
      });
      checks.push({
        name: "Kie connectivity",
        ok: res.status < 500,
        detail: `HTTP ${res.status}`,
      });
    } catch (e) {
      checks.push({ name: "Kie connectivity", ok: false, detail: e instanceof Error ? e.message : "network error" });
    }
  }

  // 3. Convex available + agent loaded
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  checks.push({
    name: "NEXT_PUBLIC_CONVEX_URL",
    ok: Boolean(convexUrl),
    detail: convexUrl ?? "missing",
  });

  let agent: { name: string; avatarUrl: string; videoEngine?: string; mintAddress: string } | null = null;
  if (mintAddress && convexUrl) {
    try {
      const convex = new ConvexHttpClient(convexUrl);
      const a = (await convex.query(api.influencers.getByMint, { mintAddress })) as { name: string; avatarUrl: string; videoEngine?: string; mintAddress: string } | null;
      if (a) {
        agent = a;
        checks.push({
          name: "Agent lookup",
          ok: true,
          detail: `${a.name} (${a.mintAddress.slice(0, 8)}…)`,
        });
      } else {
        checks.push({ name: "Agent lookup", ok: false, detail: `mint ${mintAddress} not found in influencers table` });
      }
    } catch (e) {
      checks.push({ name: "Agent lookup", ok: false, detail: e instanceof Error ? e.message : "convex query failed" });
    }
  }

  // 4. Agent avatar URL is fetchable HTTP(S)
  if (agent) {
    const avatarOk = Boolean(agent.avatarUrl) && /^https?:\/\//i.test(agent.avatarUrl);
    checks.push({
      name: "Agent avatarUrl",
      ok: avatarOk,
      detail: !agent.avatarUrl
        ? "EMPTY — agent has no avatar"
        : avatarOk
        ? agent.avatarUrl.slice(0, 80)
        : `not HTTP/S (got "${agent.avatarUrl.slice(0, 40)}…") — Kie cannot fetch this`,
    });

    // 5. Avatar is actually reachable
    if (avatarOk) {
      try {
        const res = await fetch(agent.avatarUrl, { method: "HEAD" });
        checks.push({
          name: "Avatar reachable",
          ok: res.ok,
          detail: `HTTP ${res.status} (${res.headers.get("content-type") ?? "unknown type"})`,
        });
      } catch (e) {
        checks.push({ name: "Avatar reachable", ok: false, detail: e instanceof Error ? e.message : "fetch failed" });
      }
    }

    checks.push({
      name: "Video engine",
      ok: true,
      detail: agent.videoEngine ?? "(default: veo3-fast)",
    });
  }

  const allOk = checks.every((c) => c.ok);
  return NextResponse.json({ ok: allOk, mintAddress, checks });
}
