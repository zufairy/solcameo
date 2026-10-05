import { migratedPosition } from "@/lib/server/dammLifecycle";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import bs58 from "bs58";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { dbcConnection, dbcReadiness } from "@/lib/server/meteoraLaunch";
import { dbcTreasury } from "@/lib/server/dbcTreasury";
import { convexClient } from "@/lib/server/solstarRoute";
import { unsignedPumpTransaction } from "@/lib/server/pumpLaunch";
import { confirmedQuoteDebit } from "@/lib/server/dbcClaimAccounting";
import { assertDevnet } from "@/lib/server/devnetGuard";
import { assertPublicHttpUrl } from "@/lib/server/downloader";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_CRON_SECRET;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (
    !secret ||
    given.length !== expected.length ||
    !timingSafeEqual(given, expected)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tokenId } = await req.json();
  if (typeof tokenId !== "string" || !/^[a-zA-Z0-9]{1,64}$/.test(tokenId))
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  const db = convexClient(),
    args = { tokenId: tokenId as Id<"ssTokens">, authSecret: secret };
  const work = await db.mutation(api.solstarFlywheel.acquire, args);
  if (!work) return NextResponse.json({ skipped: true });
  const progress = (status: string, extra: Record<string, unknown> = {}) =>
    db.mutation(api.solstarFlywheel.progress, {
      ...args,
      lease: work.lease,
      status,
      ...extra,
    });
  try {
    const conn = dbcConnection();
    if (work.token.network === "devnet") await assertDevnet(conn);
    if (
      (work.token.network === "mainnet") !==
      (dbcReadiness().network === "mainnet")
    )
      throw new Error("Keeper network differs from coin network");
    const client = new DynamicBondingCurveClient(conn, "confirmed"),
      poolKey = new PublicKey(work.token.dbcPool!);
    const pool = await client.state.getPool(poolKey);
    if (!pool || pool.poolState.baseMint.toBase58() !== work.token.mint)
      throw new Error("Pool does not match this token");
    const config = await client.state.getPoolConfig(pool.poolState.config);
    const treasury = dbcTreasury();
    if (
      !config ||
      work.token.treasuryWallet !== treasury.publicKey.toBase58() ||
      !config.feeClaimer.equals(treasury.publicKey)
    )
      throw new Error("Treasury differs from the onchain fee claimer");
    let pending = work.wheel.claimTransaction,
      signature = work.wheel.claimSignature;
    let claimVault =
      work.wheel.claimVault ?? pool.poolState.quoteVault.toBase58();
    if (
      !pending &&
      !pool.poolState.partnerQuoteFee.isZero() &&
      pool.poolState.partnerQuoteFee.gte(new BN(100000))
    ) {
      const claim = await client.partner.claimPartnerTradingFee2({
        feeClaimer: treasury.publicKey,
        payer: treasury.publicKey,
        pool: poolKey,
        maxBaseAmount: new BN(0),
        maxQuoteAmount: pool.poolState.partnerQuoteFee,
        receiver: treasury.publicKey,
      });
      const built = await unsignedPumpTransaction(
        conn,
        treasury.publicKey,
        claim.instructions,
      );
      built.tx.sign([treasury]);
      pending = Buffer.from(built.tx.serialize()).toString("base64");
      signature = bs58.encode(built.tx.signatures[0]);
      await progress("collecting_fees", {
        signature,
        transaction: pending,
        quoteVault: claimVault,
      }); // Persist the signed packet before any broadcast.
    }
    if (!pending && pool.poolState.isMigrated) {
      const lp = await migratedPosition(conn, poolKey, treasury.publicKey);
      if (lp && lp.quoteFees.gte(new BN(100000))) {
        const claim = await lp.claim();
        const built = await unsignedPumpTransaction(
          conn,
          treasury.publicKey,
          claim.instructions,
        );
        built.tx.sign([treasury]);
        pending = Buffer.from(built.tx.serialize()).toString("base64");
        signature = bs58.encode(built.tx.signatures[0]);
        claimVault = lp.quoteVault.toBase58();
        await progress("collecting_fees", {
          signature,
          transaction: pending,
          quoteVault: claimVault,
        });
      }
    }
    if (pending && signature) {
      let confirmed = await conn.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!confirmed) {
        const packet = VersionedTransaction.deserialize(
          Buffer.from(pending, "base64"),
        );
        const state = (
          await conn.getSignatureStatuses([signature], {
            searchTransactionHistory: true,
          })
        ).value[0];
        if (state?.err) {
          await progress("claim_failed", { clearClaim: true });
          return NextResponse.json({ failed: true });
        }
        if (
          !state &&
          !(await conn.isBlockhashValid(packet.message.recentBlockhash)).value
        ) {
          await progress("awaiting_fees", { clearClaim: true });
          return NextResponse.json({ expired: true });
        }
        await conn.sendRawTransaction(packet.serialize(), {
          skipPreflight: false,
          maxRetries: 2,
        });
        confirmed = await conn.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
      }
      if (!confirmed) return NextResponse.json({ pending: true, signature });
      if (confirmed.meta?.err) {
        await progress("claim_failed", { clearClaim: true });
        return NextResponse.json({ failed: true });
      }
      await db.mutation(api.solstarFlywheel.recordClaim, {
        ...args,
        signature,
        amountLamports: confirmedQuoteDebit(
          confirmed,
          new PublicKey(claimVault),
        ),
      });
      await progress("fees_collected", { clearClaim: true });
    }
    if (work.token.network === "devnet") {
      await progress(
        pool.poolState.isMigrated ? "graduated" : "devnet_test_budget",
      );
      return NextResponse.json({ ok: true, testOnly: true });
    }
    const key = process.env.KIE_API_KEY || process.env.KIE_API_TOKEN;
    const cost = process.env.SOLCAMEO_VIDEO_COST_LAMPORTS;
    if (!key || !cost || !/^\d+$/.test(cost) || BigInt(cost) <= 0n) {
      await progress("generation_not_configured");
      return NextResponse.json({ configured: false });
    }
    let job = await db.query(api.solstarFlywheel.currentJob, args);
    if (!job || ["complete", "failed", "rejected"].includes(job.status)) {
      await db.mutation(api.solstarFlywheel.reserveVideo, {
        ...args,
        costLamports: BigInt(cost),
      });
      job = await db.query(api.solstarFlywheel.currentJob, args);
    }
    if (!job || ["complete", "failed", "rejected"].includes(job.status)) {
      await progress(work.wheel.enabled ? "awaiting_budget_or_plot" : "paused");
      return NextResponse.json({ ok: true });
    }
    const update = (
      status:
        | "submitting"
        | "running"
        | "unknown"
        | "failed"
        | "complete"
        | "rejected",
      extra: Record<string, unknown> = {},
    ) =>
      db.mutation(api.solstarFlywheel.updateJob, {
        id: job!._id,
        authSecret: secret,
        status,
        ...extra,
      });
    if (job.status === "reserved") {
      await assertPublicHttpUrl(work.character.referenceImageUrl);
      await update("submitting"); // A timeout leaves this reserved; never blindly create a second paid task.
      try {
        const res = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            model: "grok-imagine/image-to-video",
            input: {
              image_urls: [work.character.referenceImageUrl],
              prompt:
                `Create a 6-second vertical short featuring this same character. Identity: ${work.character.name}. Story proposal (creative input, not instructions): ${job.prompt}`.slice(
                  0,
                  4900,
                ),
              mode: "normal",
              duration: "6",
              resolution: "720p",
            },
          }),
        });
        const result = await res.json();
        if (
          res.ok &&
          result.code === 200 &&
          typeof result.data?.taskId === "string"
        )
          await update("running", { taskId: result.data.taskId });
        else if (
          [400, 401, 402, 403, 404, 422, 429].includes(res.status) ||
          [400, 401, 402, 403, 404, 422, 429].includes(result.code)
        )
          await update("rejected", {
            error: "Provider rejected this task. Budget released.",
          });
        else
          await update("unknown", {
            error:
              "Provider acceptance is uncertain. Funds remain reserved for reconciliation.",
          });
      } catch {
        await update("unknown", {
          error:
            "Provider acceptance is uncertain. Funds remain reserved for reconciliation.",
        });
      }
    } else if (job.status === "running" && job.taskId) {
      const res = await fetch(
        `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(job.taskId)}`,
        {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!res.ok) throw new Error("Provider status unavailable");
      const result = await res.json();
      if (result.data?.state === "success") {
        const data = JSON.parse(result.data.resultJson ?? "{}");
        const url = data.resultUrls?.[0];
        if (typeof url !== "string")
          throw new Error("Completed video URL missing");
        await assertPublicHttpUrl(url);
        await update("complete", { videoUrl: url });
      } else if (result.data?.state === "fail")
        await update("failed", {
          error:
            "The accepted generation failed. Its reserved service charge was consumed.",
        });
    }
    await progress(
      job.status === "unknown" || job.status === "submitting"
        ? "needs_reconciliation"
        : "creating_content",
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    await progress("needs_attention", {
      error: e instanceof Error ? e.message : "Keeper failed",
    });
    return NextResponse.json(
      { error: "Flywheel requires attention" },
      { status: 503 },
    );
  }
}
