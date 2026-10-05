import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { buildEscrowProgram, checkVaultFunded, getCampaignAccount, getCampaignPda } from "@/lib/escrow";
import { PublicKey } from "@solana/web3.js";

export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * Finalize a campaign onto the on-chain treasury rail: set its vault PDA +
 * onchainVersion (+ the finalized economic terms). The convex
 * `campaigns.updateCampaignPda` mutation is internal-secret gated; the only safe
 * way to reach it is here, where we SIWS-prove the caller owns the campaign's
 * creator wallet before forwarding the secret. (Was a public mutation that
 * "authorized" on a spoofable client-supplied callerWallet — IDOR.)
 *
 * Body: { campaignId, pdaAddress, onchainVersion?, contentRewardId?, budget?,
 *         ratePerThousandViews?, deadline? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  let body: {
    campaignId?: string;
    pdaAddress?: string;
    onchainVersion?: number;
    contentRewardId?: string;
    budget?: number;
    ratePerThousandViews?: number;
    deadline?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const campaignId = String(body.campaignId ?? "").trim();
  const pdaAddress = String(body.pdaAddress ?? "").trim();
  if (!campaignId || !pdaAddress) {
    return NextResponse.json({ error: "campaignId and pdaAddress are required" }, { status: 400 });
  }
  if (body.onchainVersion !== 2) {
    return NextResponse.json({ error: "Only verified v2 escrow campaigns can be finalized" }, { status: 400 });
  }
  // MONEY-SAFETY (H06/BUG-029): `typeof x === "number"` alone lets Infinity
  // (JSON.parse("1e400")) and negatives through, bypassing the isBudgetSufficient
  // gate that campaigns.create enforces on the SAME fields and corrupting payout
  // math (Infinity - Infinity = NaN). Reject junk here — mirrors the Number.isFinite
  // guards on the sibling money routes (topup, agents/withdraw, market/buy-shares).
  if (body.budget !== undefined && (typeof body.budget !== "number" || !Number.isFinite(body.budget) || body.budget < 0)) {
    return NextResponse.json({ error: "budget must be a non-negative finite number" }, { status: 400 });
  }
  if (
    body.ratePerThousandViews !== undefined &&
    (typeof body.ratePerThousandViews !== "number" || !Number.isFinite(body.ratePerThousandViews) || body.ratePerThousandViews < 0)
  ) {
    return NextResponse.json({ error: "ratePerThousandViews must be a non-negative finite number" }, { status: 400 });
  }
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 503 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  // A malformed campaignId makes getById's v.id validator throw — treat as
  // not-found (clean 404) instead of a 500.
  const campaign = await convex
    .query(api.campaigns.getById, { id: campaignId as Id<"campaigns"> })
    .catch(() => null);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  // Ownership: a user caller must SIWS-prove they control the campaign's creator
  // wallet. Internal (cron) callers are trusted.
  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, (campaign as { creatorWallet?: string }).creatorWallet);
    if (err) return err;
  }

  // Idempotent + anti-clobber: a campaign that ALREADY has a funded on-chain vault
  // (pdaAddress + onchainVersion >= 2) must not be re-pointed to a DIFFERENT vault
  // — that would strand the original escrow (the "Migrate to on-chain vault" action
  // refuses server-side here). A same-PDA re-write (a legit create/migrate retry
  // whose finalize response was lost) stays allowed, since createCampaignTx derives
  // a DETERMINISTIC PDA from (campaignId, creator).
  const existingPda = (campaign as { pdaAddress?: string }).pdaAddress;
  const existingVersion = (campaign as { onchainVersion?: number }).onchainVersion ?? 1;
  if (existingPda && existingVersion >= 2 && existingPda !== pdaAddress) {
    return NextResponse.json(
      { error: "Campaign already has an on-chain vault" },
      { status: 409 },
    );
  }

  // A client-provided PDA is not proof of a deposit. Read the actual program
  // account and vault before publishing the campaign as funded.
  {
    if (body.budget === undefined || body.ratePerThousandViews === undefined || !body.deadline) {
      return NextResponse.json({ error: "Final escrow terms are required" }, { status: 400 });
    }
    try {
      const expectedPda = getCampaignPda(campaignId, campaign.creatorWallet)[0].toBase58();
      if (pdaAddress !== expectedPda) return NextResponse.json({ error: "Wrong campaign vault" }, { status: 400 });
      const verified = await checkVaultFunded(campaignId, campaign.creatorWallet, body.budget);
      if (!verified.funded) return NextResponse.json({ error: "Escrow deposit is not confirmed on-chain" }, { status: 409 });
      const account = await getCampaignAccount(buildEscrowProgram({ publicKey: new PublicKey(campaign.creatorWallet) }), pdaAddress);
      const rate = BigInt(Math.floor(body.ratePerThousandViews * 1_000_000));
      const deadline = Math.floor(Date.parse(body.deadline) / 1000);
      if (BigInt(account.ratePer1k.toString()) !== rate || Number(account.deadlineUnix.toString()) !== deadline) {
        return NextResponse.json({ error: "Escrow terms differ from the campaign draft" }, { status: 409 });
      }
    } catch {
      return NextResponse.json({ error: "Could not verify the escrow deposit" }, { status: 503 });
    }
  }

  await convex.mutation(api.campaigns.updateCampaignPda, {
    id: campaignId as Id<"campaigns">,
    pdaAddress,
    ...(typeof body.onchainVersion === "number" ? { onchainVersion: body.onchainVersion } : {}),
    ...(body.contentRewardId ? { contentRewardId: body.contentRewardId } : {}),
    ...(typeof body.budget === "number" ? { budget: body.budget } : {}),
    ...(typeof body.ratePerThousandViews === "number"
      ? { ratePerThousandViews: body.ratePerThousandViews }
      : {}),
    ...(body.deadline ? { deadline: body.deadline } : {}),
    authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
  });
  return NextResponse.json({ ok: true });
}
