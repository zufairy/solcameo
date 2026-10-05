import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { checkInternalSecret } from "@/lib/server/requireAuth";

export const maxDuration = 120;
export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * Credits a verified campaign payout into the agent's escrow vault. This raises
 * the NAV for all share-holders (investors capture ~85% of earnings via NAV
 * appreciation) and mints founder shares worth 15% of the earnings to the
 * builder's wallet. The old 50/45/5 per-investor USDC split is retired — all
 * earnings flow through the vault model. Idempotent per submissionId.
 * Called by `convex/distributions.dispatch`.
 */
export async function POST(req: NextRequest) {
  // Internal-secret ONLY. This route credits real on-chain earnings into an
  // agent's vault and mints founder shares — there is no legitimate user-initiated
  // path. Its sole caller is convex/distributions.dispatch (sends INTERNAL_CRON_SECRET).
  // Removing the user path eliminates the entire user attack surface here.
  if (!checkInternalSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

    const { mintAddress, payoutUsdc, campaignId, submissionId, trancheKey } = (await req.json()) as {
      mintAddress?: string; payoutUsdc?: number; campaignId?: string; submissionId?: string; trancheKey?: string;
    };
    if (!mintAddress || !payoutUsdc || payoutUsdc <= 0) {
      return NextResponse.json({ error: "mintAddress and a positive payoutUsdc are required" }, { status: 400 });
    }

    const convex = new ConvexHttpClient(CONVEX_URL);

    // Idempotency. When the caller supplies a per-tranche key (v2 on-chain claim:
    // one submission paid across several claim ticks) we dedup on THAT, so each
    // tranche is credited exactly once without the bare-submissionId guard
    // collapsing tranches 2..n into a no-op. Otherwise (v1) dedup per submission.
    if (trancheKey) {
      const existing = await convex.query(api.distributions.getByTranche, { trancheKey }).catch(() => null);
      if (existing) return NextResponse.json({ ok: true, alreadyDistributed: true, distributionId: existing._id });
    } else if (submissionId) {
      const existing = await convex.query(api.distributions.getBySubmission, { submissionId }).catch(() => null);
      if (existing) return NextResponse.json({ ok: true, alreadyDistributed: true, distributionId: existing._id });
    }

    const agent = await convex.query(api.influencers.getByMint, { mintAddress });
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const builderWallet = agent.creatorWallet ?? "";

    // ── Credit the vault: all earnings go to escrow, builder gets founder shares ──
    const round = (n: number) => Math.round(n * 1e6) / 1e6;
    const amountUsdc = round(payoutUsdc);

    // Atomic: dedup + escrow credit + founder-share mint + distributions ledger
    // row in ONE Convex transaction, so a keeper retry after a partial failure can
    // never double-credit NAV (E2E hunt #9/10/14). Returns alreadyDistributed=true
    // when this tranche/submission was already credited.
    const result = await convex.mutation(api.earnings.creditAndRecord, {
      mintAddress,
      amountUsdc,
      builderWallet,
      campaignId,
      submissionId,
      trancheKey,
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
    if (result.alreadyDistributed) {
      return NextResponse.json({ ok: true, alreadyDistributed: true, distributionId: result.distributionId });
    }

    // Lifetime-earnings roll-up (display only; best-effort, once per NEW tranche —
    // skipped on the already-distributed path so it can't double-count).
    await convex
      .mutation(api.influencers.addEarnings, { mintAddress, usdc: amountUsdc, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" })
      .catch(() => {});

    return NextResponse.json({
      ok: true,
      distributionId: result.distributionId,
      status: "credited",
      escrowUsdc: result.escrowUsdc,
      navAfterEscrow: result.navAfterEscrow,
      founderShares: result.founderShares,
      builderWallet,
    });
  } catch (err) {
    console.error("[distribute-earnings]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Distribution failed" }, { status: 500 });
  }
}
