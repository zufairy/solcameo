import { migratedPosition } from "@/lib/server/dammLifecycle";
import { NextRequest, NextResponse } from "next/server";
import {
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDammV2PoolAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  prepareAuthedJson,
  convexClient,
  isConvexIdString,
} from "@/lib/server/solstarRoute";
import { dbcConnection, dbcReadiness } from "@/lib/server/meteoraLaunch";
import {
  pumpMessageHash,
  unsignedPumpTransaction,
} from "@/lib/server/pumpLaunch";
import { signOperation, readOperation } from "@/lib/server/dbcOperation";
import { assertDevnet } from "@/lib/server/devnetGuard";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("characterId");
  if (!isConvexIdString(id))
    return NextResponse.json({ error: "Invalid character" }, { status: 400 });
  try {
    const data = await convexClient().query(api.solstarMarket.terminal, {
      characterId: id as Id<"ssCharacters">,
    });
    if (!data?.token.dbcPool || !data.token.dbcConfig)
      return NextResponse.json({ available: false });
    if (data.token.network !== dbcReadiness().network)
      throw new Error("Network mismatch");
    const conn = dbcConnection();
    if (data.token.network === "devnet") await assertDevnet(conn);
    const client = new DynamicBondingCurveClient(conn, "confirmed");
    const [pool, config, fees] = await Promise.all([
      client.state.getPool(new PublicKey(data.token.dbcPool)),
      client.state.getPoolConfig(new PublicKey(data.token.dbcConfig)),
      client.state.getPoolFeeMetrics(data.token.dbcPool),
    ]);
    if (
      !pool ||
      !config ||
      pool.poolState.baseMint.toBase58() !== data.token.mint
    )
      throw new Error("Pool mismatch");
    const lp = pool.poolState.isMigrated
      ? await migratedPosition(
          conn,
          new PublicKey(data.token.dbcPool),
          pool.poolState.creator,
        )
      : null;
    const threshold = BigInt(config.migrationQuoteThreshold.toString()),
      reserve = BigInt(pool.poolState.quoteReserve.toString());
    return NextResponse.json(
      {
        available: true,
        creatorClaimable: fees.current.creatorQuoteFee
          .add(new BN(lp?.quoteFees.toString() ?? "0"))
          .toString(),
        partnerClaimable: fees.current.partnerQuoteFee.toString(),
        reserve: reserve.toString(),
        threshold: threshold.toString(),
        readyToGraduate: reserve >= threshold && !pool.poolState.isMigrated,
        migrated: !!pool.poolState.isMigrated,
        creator: pool.poolState.creator.toBase58(),
        creatorShare: config.creatorTradingFeePercentage,
        feeClaimer: config.feeClaimer.toBase58(),
        checkedAt: Date.now(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Onchain economics temporarily unavailable" },
      { status: 503 },
    );
  }
}
export async function POST(req: NextRequest) {
  const prep = await prepareAuthedJson(req, 16384);
  if (!prep.ok) return prep.res;
  const { wallet, body, secret } = prep;
  try {
    const conn = dbcConnection(),
      network = dbcReadiness().network,
      payer = new PublicKey(wallet),
      client = new DynamicBondingCurveClient(conn, "confirmed");
    if (network === "devnet") await assertDevnet(conn);
    if (body.action === "toggle") {
      if (
        !isConvexIdString(body.characterId) ||
        typeof body.enabled !== "boolean"
      )
        throw new Error("Invalid setting");
      await convexClient().mutation(api.solstarFlywheel.setEnabled, {
        characterId: body.characterId as Id<"ssCharacters">,
        wallet,
        enabled: body.enabled,
        authSecret: secret,
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "prepare") {
      if (
        !isConvexIdString(body.characterId) ||
        !["claim", "graduate"].includes(String(body.kind))
      )
        throw new Error("Invalid operation");
      const { token } = await convexClient().query(
        api.solstarCreate.getLaunchCharacter,
        {
          characterId: body.characterId as Id<"ssCharacters">,
          wallet,
          authSecret: secret,
        },
      );
      if (
        token.network !== network ||
        !token.dbcPool ||
        !token.dbcConfig ||
        !token.mint
      )
        throw new Error("Token is not live on this network");
      const poolKey = new PublicKey(token.dbcPool),
        pool = await client.state.getPool(poolKey),
        config = await client.state.getPoolConfig(
          new PublicKey(token.dbcConfig),
        );
      if (
        !pool ||
        !config ||
        !pool.poolState.creator.equals(payer) ||
        pool.poolState.baseMint.toBase58() !== token.mint
      )
        throw new Error("Pool ownership mismatch");
      let tx: VersionedTransaction, dammPool: string | undefined;
      if (body.kind === "claim") {
        const lp = pool.poolState.isMigrated
          ? await migratedPosition(conn, poolKey, payer)
          : null;
        if (
          pool.poolState.isMigrated &&
          pool.poolState.creatorQuoteFee.isZero()
        ) {
          if (!lp || lp.quoteFees.isZero())
            throw new Error("No graduated pool fees to claim yet");
          tx = (
            await unsignedPumpTransaction(
              conn,
              payer,
              (await lp.claim()).instructions,
            )
          ).tx;
        } else {
          if (pool.poolState.creatorQuoteFee.isZero())
            throw new Error("No creator fees to claim yet");
          const built = await client.creator.claimCreatorTradingFee2({
            creator: payer,
            payer,
            pool: poolKey,
            maxBaseAmount: new BN(0),
            maxQuoteAmount: pool.poolState.creatorQuoteFee,
            receiver: payer,
          });
          tx = (await unsignedPumpTransaction(conn, payer, built.instructions))
            .tx;
        }
      } else {
        if (pool.poolState.isMigrated)
          throw new Error("This coin has already graduated");
        if (pool.poolState.quoteReserve.lt(config.migrationQuoteThreshold))
          throw new Error("The required SOL reserve has not been reached");
        const dammConfig =
          DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
        const result = await client.migration.migrateToDammV2({
          payer,
          pool: poolKey,
          dammConfig,
        });
        const block = await conn.getLatestBlockhash("confirmed");
        tx = new VersionedTransaction(
          new TransactionMessage({
            payerKey: payer,
            recentBlockhash: block.blockhash,
            instructions: result.transaction.instructions,
          }).compileToV0Message(),
        );
        tx.sign([
          result.firstPositionNftKeypair,
          result.secondPositionNftKeypair,
        ]);
        dammPool = deriveDammV2PoolAddress(
          dammConfig,
          pool.poolState.baseMint,
          config.quoteMint,
        ).toBase58();
      }
      if (tx.serialize().length > 1232)
        throw new Error("This operation exceeds the transaction size limit");
      return NextResponse.json({
        transaction: Buffer.from(tx.serialize()).toString("base64"),
        receipt: signOperation({
          wallet,
          characterId: body.characterId,
          kind: body.kind as "claim" | "graduate",
          hash: pumpMessageHash(tx),
          network,
          expires: Date.now() + 120000,
          ...(dammPool ? { dammPool } : {}),
        }),
      });
    }
    if (typeof body.receipt !== "string") throw new Error("Missing receipt");
    const r = readOperation(
      body.receipt,
      wallet,
      network,
      body.action === "confirm",
    );
    if (body.action === "submit") {
      if (
        typeof body.transaction !== "string" ||
        body.transaction.length > 6000
      )
        throw new Error("Invalid packet");
      const tx = VersionedTransaction.deserialize(
        Buffer.from(body.transaction, "base64"),
      );
      if (pumpMessageHash(tx) !== r.hash)
        throw new Error("Transaction differs from reviewed operation");
      return NextResponse.json({
        signature: await conn.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        }),
      });
    }
    if (
      body.action !== "confirm" ||
      typeof body.signature !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(body.signature)
    )
      throw new Error("Invalid confirmation");
    const tx = await conn.getTransaction(body.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) {
      if (typeof body.transaction === "string") {
        const packet = VersionedTransaction.deserialize(
          Buffer.from(body.transaction, "base64"),
        );
        if (pumpMessageHash(packet) !== r.hash)
          throw new Error("Recovery packet differs from review");
        const state = (
          await conn.getSignatureStatuses([body.signature], {
            searchTransactionHistory: true,
          })
        ).value[0];
        if (state?.err) return NextResponse.json({ failed: true });
        if (
          !state &&
          !(await conn.isBlockhashValid(packet.message.recentBlockhash)).value
        )
          return NextResponse.json({ expired: true });
      }
      throw new Error("Operation not confirmed yet");
    }
    if (!tx.meta || tx.meta.err) return NextResponse.json({ failed: true });
    if (
      pumpMessageHash(new VersionedTransaction(tx.transaction.message)) !==
      r.hash
    )
      throw new Error("Confirmed operation differs from review");
    const { token } = await convexClient().query(
      api.solstarCreate.getLaunchCharacter,
      {
        characterId: r.characterId as Id<"ssCharacters">,
        wallet,
        authSecret: secret,
      },
    );
    if (r.kind === "graduate") {
      const pool = await client.state.getPool(new PublicKey(token.dbcPool!));
      if (
        !pool?.poolState.isMigrated ||
        !r.dammPool ||
        !(await conn.getAccountInfo(new PublicKey(r.dammPool)))
      )
        throw new Error("Graduated pool not verified");
      await convexClient().mutation(api.solstarFlywheel.migrationConfirmed, {
        tokenId: token._id,
        dammPool: r.dammPool,
        authSecret: secret,
      });
    }
    return NextResponse.json({ confirmed: true, signature: body.signature });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Operation failed" },
      { status: 400 },
    );
  }
}
