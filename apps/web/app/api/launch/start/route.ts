import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAgentQuotaIdentity } from "@/lib/server/agentQuota";
import { requireAuth } from "@/lib/server/requireAuth";
import { parseLaunchInput } from "@/lib/server/launch/launchInput";
import { runLaunch, defaultLaunchDeps } from "@/lib/server/launch/runLaunch";

/**
 * Public LAUNCH funnel entry (index page → "Paste your website").
 *
 * Signed-in only (Privy bearer): the run burns an analysis, an image and 3
 * video generations, so anonymous drive-bys never spend. Creates the
 * launchRuns doc and returns its id IMMEDIATELY; the orchestrator drains
 * post-response (Railway long-lived Node — same pattern as ugc-sample/
 * generate). The page subscribes to launchRuns.get (+ the linked
 * ugcSampleRuns doc for the 3 video slots).
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const input = parseLaunchInput(body);
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: 400 });

  // The agent's owner. Privy creates an embedded Solana wallet on login for
  // users without one, so this is normally present; a brand-new account can
  // race it — the client retries after a moment.
  const creatorWallet = auth.user.walletAddress;
  if (!creatorWallet) {
    return NextResponse.json({ ok: false, error: "Your wallet is still being set up — try again in a moment.", code: "wallet_required" }, { status: 409 });
  }
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });

  // Lead capture — fire-and-forget, shows up on the admin Leads page.
  void fetch(new URL("/api/leads", req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: input.websiteUrl, source: "hero_website" }),
  }).catch(() => {});

  const convex = new ConvexHttpClient(CONVEX_URL);
  let identity: Awaited<ReturnType<typeof getAgentQuotaIdentity>>;
  try {
    identity = await getAgentQuotaIdentity(convex, auth.user);
    const quote = await convex.query(api.mintFee.quoteMintFee, {
      creatorWallet, creatorWallets: identity.creatorWallets, creatorDid: identity.creatorDid,
      agentLimit: identity.agentLimit, standardFeeUsdc: 0, forceFree: true,
    });
    if (identity.agentLimit >= 0 && quote.priorMints >= identity.agentLimit) {
      return NextResponse.json({ ok: false, error: "Agent limit reached. Open My Agents to manage your agents or free a slot.", code: "agent_limit_reached" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Could not check agent access. Please retry." }, { status: 503 });
  }
  let runId: Id<"launchRuns">;
  try {
    runId = (await convex.mutation(api.launchRuns.create, {
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
      ownerDid: auth.user.id,
      creatorWallet,
      websiteUrl: input.websiteUrl,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    })) as Id<"launchRuns">;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/rate_limited/.test(m)) {
      return NextResponse.json({ ok: false, error: "You've used your launches for today. Open your studio to keep going.", code: "rate_limited" }, { status: 429 });
    }
    return NextResponse.json({ ok: false, error: `Could not start: ${m.slice(0, 200)}` }, { status: 502 });
  }

  // Claim capacity before any paid analysis/image work. The internal mint
  // callback rechecks this same reservation when inserting the agent.
  try {
    const args = {
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "", sessionId: `launch_${runId}`,
      creatorWallet, creatorWallets: identity.creatorWallets, creatorDid: identity.creatorDid,
      standardFeeUsdc: 0, forceFree: true,
    };
    await convex.mutation(api.mintFee.reserveMintFee, args);
    const claim = await convex.mutation(api.mintFee.claimMint, { ...args, agentLimit: identity.agentLimit });
    if (!claim.ok) {
      await convex.mutation(api.launchRuns.patch, { authSecret: args.authSecret, runId, stage: "failed", error: "Agent limit reached. Manage your existing agents or delete one to free a slot." });
      return NextResponse.json({ ok: false, error: "Agent limit reached. Open My Agents to manage your agents or free a slot.", code: "agent_limit_reached" }, { status: 403 });
    }
  } catch {
    await convex.mutation(api.launchRuns.patch, { authSecret: process.env.INTERNAL_CRON_SECRET ?? "", runId, stage: "failed", error: "Could not check agent access. Please retry." }).catch(() => {});
    return NextResponse.json({ ok: false, error: "Could not check agent access. Please retry." }, { status: 503 });
  }

  // Background orchestration. void'd by design (see header).
  void runLaunch(defaultLaunchDeps(convex, runId, req), {
    runId,
    websiteUrl: input.websiteUrl,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    creatorWallet,
  }).catch((e) => console.error(`[launch/start] ${runId} orchestrator crashed: ${e instanceof Error ? e.message : e}`));

  return NextResponse.json({ ok: true, runId }, { status: 202 });
}
