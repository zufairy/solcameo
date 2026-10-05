import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { PublicKey } from "@solana/web3.js";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { getNetwork } from "@/lib/solana/network";
import { buildServerEscrowProgram, loadKeypair } from "@/lib/server/escrowServer";
import { recordPerformanceTx } from "@/lib/escrow";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
export const maxDuration = 60;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;
const CHECK_ADMIN = makeFunctionReference<"action">("submissions:checkAdminToken");
const ONCHAIN_JOIN = makeFunctionReference<"query">("submissions:onchainJoinById");

/**
 * Devnet-only admin route that drives a full on-chain attest + settle for a
 * submission, so the existing claim keeper can pay without waiting for organic
 * view growth.
 *
 * Body: { submissionId: string (Convex _id), views: number, accessToken?: string }
 * Auth: internal INTERNAL_CRON_SECRET header OR admin Supabase token in body.
 *
 * Flow:
 *  1. Gate: devnet only (403 on mainnet-beta/testnet).
 *  2. Auth: dual gate (checkInternalSecret OR admin Supabase token via checkAdminToken).
 *  3. Lookup: onchainJoinById → campaignId, creatorWallet, agentWallet, onchainVersion.
 *  4. Validate: onchainVersion >= 2 and both wallets present.
 *  5. Attest: recordPerformanceTx (oracle signs on-chain ClaimRecord).
 *  6. Settle: settleFromOracle (Convex mutation → markVerified → claim keeper fires).
 */
export async function POST(req: NextRequest) {
  if (getNetwork() !== "devnet")
    return NextResponse.json({ ok: false, error: "Injector disabled off devnet" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await req.json() as any;

  // dual gate — internal secret OR admin Supabase token
  if (!checkInternalSecret(req)) {
    const convex = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null;
    if (!body.accessToken || !convex) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const chk = (await convex.action(CHECK_ADMIN, { accessToken: body.accessToken }).catch(() => null)) as { admin: boolean } | null;
    if (!chk?.admin) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const secret = process.env.INTERNAL_CRON_SECRET!;
  const convex = new ConvexHttpClient(CONVEX_URL);

  const j = (await convex.query(ONCHAIN_JOIN, { authSecret: secret, submissionId: body.submissionId })) as
    | { campaignId: string; creatorWallet: string; agentWallet: string; onchainVersion: number } | null;
  if (!j || j.onchainVersion < 2 || !j.creatorWallet || !j.agentWallet)
    return NextResponse.json({ ok: false, error: "submission not on the on-chain rail (needs v2 + creator + agent wallet)" }, { status: 400 });

  const program = buildServerEscrowProgram(loadKeypair(process.env.VELLO_ORACLE_SECRET!));
  const { txSignature } = await recordPerformanceTx(
    program, j.campaignId, body.submissionId, j.creatorWallet,
    new PublicKey(j.agentWallet), Number(body.views),
    Buffer.alloc(32), Buffer.alloc(64),
  );

  await convex.mutation(api.oracle.settleFromOracle, {
    authSecret: secret, submissionId: body.submissionId,
    decision: "approved", viewCount: Number(body.views), attestationTx: txSignature,
  });

  return NextResponse.json({ ok: true, txSignature });
}
