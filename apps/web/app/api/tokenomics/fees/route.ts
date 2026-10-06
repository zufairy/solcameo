import { NextRequest, NextResponse } from "next/server";
import BN from "bn.js";
import { PublicKey, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { api } from "@/convex/_generated/api";
import { convexClient, prepareAuthedJson } from "@/lib/server/solstarRoute";
import { dbcConnection, dbcReadiness } from "@/lib/server/meteoraLaunch";
import { migratedPosition } from "@/lib/server/dammLifecycle";
import { platformLaunchOwner } from "@/lib/server/platformLaunchOwner";
import { pumpMessageHash, unsignedPumpTransaction } from "@/lib/server/pumpLaunch";
import { readOperation, signOperation } from "@/lib/server/dbcOperation";
import { assertConfiguredChain } from "@/lib/server/devnetGuard";
import { splitClaimedFees } from "@/lib/tokenomics/feeSplit";

export const runtime = "nodejs";
export const maxDuration = 60;

const wallet = (raw: string | undefined) => { try { return raw?.trim() ? new PublicKey(raw.trim()) : null; } catch { return null; } };
/** Where the 40% operations and 30% treasury shares are sent. If either is unset, fees are claimed but not split. */
const splitWallets = () => ({ ops: wallet(process.env.SOLCAMEO_OPS_WALLET), treasury: wallet(process.env.SOLCAMEO_TREASURY_WALLET) });

async function context() {
  const network = dbcReadiness().network;
  const row = await convexClient().query(api.platformLaunch.get, { network, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
  if (!row || row.state !== "live" || !row.pool || !row.mint) return null;
  const conn = dbcConnection();
  await assertConfiguredChain(conn, network === "mainnet" ? "mainnet" : "devnet");
  const client = new DynamicBondingCurveClient(conn, "confirmed");
  const poolKey = new PublicKey(row.pool);
  const pool = await client.state.getPool(poolKey);
  if (!pool || pool.poolState.baseMint.toBase58() !== row.mint) throw new Error("Pool mismatch");
  const owner = pool.poolState.creator;
  const lp = pool.poolState.isMigrated ? await migratedPosition(conn, poolKey, owner) : null;
  return { network, conn, client, poolKey, pool, owner, lp, row };
}

/** What the platform wallet can claim right now, and how the claim would be split. */
export async function GET() {
  try {
    const ctx = await context();
    if (!ctx) return NextResponse.json({ available: false });
    const curve = BigInt(ctx.pool.poolState.creatorQuoteFee.toString());
    const graduated = BigInt(ctx.lp?.quoteFees.toString() ?? "0");
    const claimable = curve > 0n ? curve : graduated;
    const w = splitWallets();
    return NextResponse.json({
      available: true, migrated: !!ctx.pool.poolState.isMigrated, owner: ctx.owner.toBase58(),
      claimableLamports: claimable.toString(), curveFeesLamports: curve.toString(), graduatedFeesLamports: graduated.toString(),
      split: { ...Object.fromEntries(Object.entries(splitClaimedFees(claimable)).map(([k, v]) => [k, v.toString()])), opsWallet: w.ops?.toBase58() ?? null, treasuryWallet: w.treasury?.toBase58() ?? null },
      checkedAt: Date.now(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Platform fees are temporarily unavailable." }, { status: 503 }); }
}

export async function POST(req: NextRequest) {
  const prep = await prepareAuthedJson(req, 8192);
  if (!prep.ok) return prep.res;
  const { wallet: signer, body } = prep;
  try {
    const owner = await platformLaunchOwner();
    if (!owner || signer !== owner) return NextResponse.json({ error: "Connect the platform wallet to claim fees." }, { status: 403 });
    const ctx = await context();
    if (!ctx) return NextResponse.json({ error: "The platform token is not live yet." }, { status: 409 });
    if (!ctx.owner.equals(new PublicKey(signer))) return NextResponse.json({ error: "This wallet is not the pool creator." }, { status: 403 });
    const payer = new PublicKey(signer);

    if (body.action === "prepare") {
      const curve = BigInt(ctx.pool.poolState.creatorQuoteFee.toString());
      let instructions;
      let claimed: bigint;
      if (curve > 0n) {
        const built = await ctx.client.creator.claimCreatorTradingFee2({ creator: payer, payer, pool: ctx.poolKey, maxBaseAmount: new BN(0), maxQuoteAmount: ctx.pool.poolState.creatorQuoteFee, receiver: payer });
        instructions = built.instructions; claimed = curve;
      } else if (ctx.lp && !ctx.lp.quoteFees.isZero()) {
        instructions = (await ctx.lp.claim()).instructions; claimed = BigInt(ctx.lp.quoteFees.toString());
      } else return NextResponse.json({ error: "No fees to claim yet." }, { status: 409 });
      // Send the operations and treasury shares in the same transaction, so a claim can never leave the split half done.
      const w = splitWallets(), parts = splitClaimedFees(claimed);
      const splitting = !!(w.ops && w.treasury);
      if (splitting) instructions = [...instructions,
        SystemProgram.transfer({ fromPubkey: payer, toPubkey: w.ops!, lamports: parts.ops }),
        SystemProgram.transfer({ fromPubkey: payer, toPubkey: w.treasury!, lamports: parts.treasury })];
      const { tx } = await unsignedPumpTransaction(ctx.conn, payer, instructions);
      if (tx.serialize().length > 1232) return NextResponse.json({ error: "This claim is too large for one transaction." }, { status: 413 });
      return NextResponse.json({
        transaction: Buffer.from(tx.serialize()).toString("base64"), claimedLamports: claimed.toString(), split: splitting,
        receipt: signOperation({ wallet: signer, characterId: "platform", kind: "claim", hash: pumpMessageHash(tx), network: ctx.network, expires: Date.now() + 120_000 }),
      });
    }
    if (body.action === "submit") {
      if (typeof body.receipt !== "string" || typeof body.transaction !== "string" || body.transaction.length > 6000) return NextResponse.json({ error: "Invalid claim." }, { status: 400 });
      const r = readOperation(body.receipt, signer, ctx.network);
      const tx = VersionedTransaction.deserialize(Buffer.from(body.transaction, "base64"));
      if (r.characterId !== "platform" || pumpMessageHash(tx) !== r.hash) return NextResponse.json({ error: "Transaction differs from the reviewed claim." }, { status: 400 });
      const signature = await ctx.conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      return NextResponse.json({ signature });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "Claim failed." }, { status: 400 });
  }
}
