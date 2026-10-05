import { marketCapSol } from "@/lib/meteora/poolPrice";
import { migratedPool } from "@/lib/server/dammLifecycle";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { NextRequest, NextResponse } from "next/server";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import BN from "bn.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  prepareAuthedJson,
  convexClient,
  isConvexIdString,
} from "@/lib/server/solstarRoute";
import { assertDevnet } from "@/lib/server/devnetGuard";
import { dbcConnection, dbcReadiness } from "@/lib/server/meteoraLaunch";
import {
  unsignedPumpTransaction,
  pumpMessageHash,
} from "@/lib/server/pumpLaunch";
import {
  readTradeReceipt,
  signTradeReceipt,
} from "@/lib/server/dbcTradeReceipt";
import { txFingerprint } from "@/lib/server/dbcTradeFingerprint";
import { putImage } from "@/lib/server/imageStorage";
export const maxDuration = 60;
// New receipts carry a review fingerprint that tolerates wallet-injected guard and
// priority instructions; receipts issued before that change used the exact message hash.
function matchesReview(
  tx: VersionedTransaction,
  receipt: { hash: string; fingerprint?: number },
  wallet: string,
) {
  try {
    if (receipt.fingerprint === 2) return txFingerprint(tx, wallet) === receipt.hash;
  } catch {
    return false;
  }
  return pumpMessageHash(tx) === receipt.hash;
}
export async function POST(req: NextRequest) {
  const prep = await prepareAuthedJson(req, 16384);
  if (!prep.ok) return prep.res;
  const { body, wallet } = prep;
  const network = dbcReadiness().network;
  if (!dbcReadiness().ready)
    return NextResponse.json({ error: dbcReadiness().reason }, { status: 503 });
  try {
    const connection = dbcConnection();
    if (network === "devnet") await assertDevnet(connection);
    const client = new DynamicBondingCurveClient(connection, "confirmed");
    const payer = new PublicKey(wallet);
    if (body.action === "prepare" || body.action === "quote") {
      if (
        !isConvexIdString(body.characterId) ||
        !["buy", "sell"].includes(body.side as string) ||
        typeof body.amount !== "string" ||
        !/^\d{1,19}$/.test(body.amount)
      )
        throw new Error("Invalid trade");
      const amount = new BN(body.amount);
      const slippage = Number(body.slippageBps);
      if (
        amount.lte(new BN(0)) ||
        !Number.isInteger(slippage) ||
        slippage < 10 ||
        slippage > 1000
      )
        throw new Error("Invalid amount or slippage");
      const data = await convexClient().query(api.solstarMarket.terminal, {
        characterId: body.characterId as Id<"ssCharacters">,
      });
      if (
        !data?.token.dbcPool ||
        !data.token.dbcConfig ||
        data.token.network !== network ||
        !["live", "graduated", "migrated"].includes(data.token.state)
      )
        throw new Error("This coin is not available on the configured network.");
      const poolAddress = new PublicKey(data.token.dbcPool);
      const [pool, config] = await Promise.all([
        client.state.getPool(poolAddress),
        client.state.getPoolConfig(new PublicKey(data.token.dbcConfig)),
      ]);
      if (
        !pool ||
        !config ||
        pool.poolState.baseMint.toBase58() !== data.token.mint ||
        pool.poolState.config.toBase58() !== data.token.dbcConfig
      )
        throw new Error("Bonding curve is unavailable or has graduated");
      let tx, minimumOut: BN;
      if (pool.poolState.isMigrated) {
        const migrated = await migratedPool(connection, poolAddress);
        if (!migrated) throw new Error("Graduated pool unavailable");
        const state = migrated.state,
          inputMint =
            body.side === "buy" ? NATIVE_MINT : pool.poolState.baseMint,
          outputMint =
            body.side === "buy" ? pool.poolState.baseMint : NATIVE_MINT;
        const quote = migrated.cp.getQuote({
          inAmount: amount,
          inputTokenMint: inputMint,
          slippage: slippage / 100,
          poolState: state,
          currentTime: Math.floor(Date.now() / 1000),
          currentSlot: await connection.getSlot("confirmed"),
          tokenADecimal: state.tokenAMint.equals(NATIVE_MINT) ? 9 : 6,
          tokenBDecimal: state.tokenBMint.equals(NATIVE_MINT) ? 9 : 6,
          hasReferral: false,
        });
        minimumOut = quote.minSwapOutAmount;
        tx = await migrated.cp.swap({
          payer,
          pool: migrated.address,
          inputTokenMint: inputMint,
          outputTokenMint: outputMint,
          amountIn: amount,
          minimumAmountOut: minimumOut,
          tokenAMint: state.tokenAMint,
          tokenBMint: state.tokenBMint,
          tokenAVault: state.tokenAVault,
          tokenBVault: state.tokenBVault,
          tokenAProgram: TOKEN_PROGRAM_ID,
          tokenBProgram: TOKEN_PROGRAM_ID,
          referralTokenAccount: null,
          poolState: state,
        });
      } else {
        const currentPoint = new BN(
          config.activationType === 0
            ? await connection.getSlot("confirmed")
            : Math.floor(Date.now() / 1000),
        );
        const swapBaseForQuote = body.side === "sell";
        const quote = client.pool.swapQuote({
          virtualPool: pool,
          config,
          swapBaseForQuote,
          amountIn: amount,
          slippageBps: slippage,
          hasReferral: false,
          currentPoint,
          eligibleForFirstSwapWithMinFee: false,
        });
        tx = await client.pool.swap({
          owner: payer,
          pool: poolAddress,
          amountIn: amount,
          minimumAmountOut: quote.minimumAmountOut,
          swapBaseForQuote,
          referralTokenAccount: null,
        });
        minimumOut = quote.minimumAmountOut;
      }
      if (body.action === "quote") return NextResponse.json({ minimumOut: minimumOut.toString() }, { headers: { "Cache-Control": "no-store" } });
      const prepared = await unsignedPumpTransaction(
        connection,
        payer,
        tx.instructions,
        { priorityMicroLamports: 100_000 },
      );
      return NextResponse.json({
        transaction: prepared.transaction,
        receipt: signTradeReceipt({
          wallet,
          network,
          characterId: body.characterId,
          hash: txFingerprint(prepared.tx, wallet),
          fingerprint: 2,
          side: body.side as "buy" | "sell",
          amount: body.amount,
          expires: Date.now() + 120000,
        }),
        minimumOut: minimumOut.toString(),
      });
    }
    if (typeof body.receipt !== "string")
      throw new Error("Missing reviewed trade");
    const receipt = readTradeReceipt(
      body.receipt,
      wallet,
      body.action === "confirm",
      network,
    );
    if (body.action === "submit") {
      if (
        typeof body.transaction !== "string" ||
        body.transaction.length > 5000
      )
        throw new Error("Invalid signed transaction");
      const tx = VersionedTransaction.deserialize(
        Buffer.from(body.transaction, "base64"),
      );
      if (!matchesReview(tx, receipt, wallet))
        throw new Error("Signed trade differs from your reviewed transaction");
      return NextResponse.json({
        signature: await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        }),
      });
    }
    if (
      body.action !== "confirm" ||
      typeof body.signature !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(body.signature)
    )
      throw new Error("Invalid trade confirmation");
    const confirmed = await connection.getTransaction(body.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!confirmed) {
      if (typeof body.transaction === "string") {
        const packet = VersionedTransaction.deserialize(
          Buffer.from(body.transaction, "base64"),
        );
        if (
          !matchesReview(packet, receipt, wallet) ||
          bs58.encode(packet.signatures[0]) !== body.signature
        ) {
          // A packet that fails review is never broadcast by us (submit enforces the
          // same check), so unless it is already on chain it can safely be dropped.
          const seen = await connection.getSignatureStatuses([body.signature], {
            searchTransactionHistory: true,
          });
          if (!seen.value[0])
            return NextResponse.json({
              discarded: true,
              reason: "The saved swap no longer matches your review and never reached the network. No funds moved.",
            });
          throw new Error("Recovery packet differs from the reviewed swap");
        }
        const status = await connection.getSignatureStatuses([body.signature], {
          searchTransactionHistory: true,
        });
        if (status.value[0]?.err)
          return NextResponse.json({ failed: true, signature: body.signature });
        if (
          !status.value[0] &&
          !(
            await connection.isBlockhashValid(packet.message.recentBlockhash, {
              commitment: "confirmed",
            })
          ).value
        )
          return NextResponse.json({ expired: true });
      }
      throw new Error("Trade not confirmed successfully yet");
    }
    if (!confirmed.meta || confirmed.meta.err)
      return NextResponse.json({ failed: true, signature: body.signature });
    if (
      !matchesReview(
        new VersionedTransaction(confirmed.transaction.message),
        receipt,
        wallet,
      )
    )
      throw new Error("Confirmed trade differs from reviewed transaction");
    const keys = confirmed.transaction.message.staticAccountKeys;
    const index = keys.findIndex((k) => k.equals(payer));
    const delta =
      index < 0
        ? null
        : confirmed.meta.postBalances[index] -
          confirmed.meta.preBalances[index];
    let historyWarning: string | undefined;
    try {
      const data = await convexClient().query(api.solstarMarket.terminal, {
        characterId: receipt.characterId as Id<"ssCharacters">,
      });
      if (data?.token.dbcPool) {
        const state = await client.state.getPool(
          new PublicKey(data.token.dbcPool),
        );
        if (state) {
          const supply = await connection.getTokenSupply(new PublicKey(data.token.mint!));
          const units = 10 ** (supply.value.decimals - 9);
          const totalSupply = Number(supply.value.amount) / 10 ** supply.value.decimals;
          const sqrt = Number(state.poolState.sqrtPrice.toString()) / 2 ** 64;
          let capSol = sqrt * sqrt * units * totalSupply;
          if (state.poolState.isMigrated) {
            const migrated = await migratedPool(connection, new PublicKey(data.token.dbcPool));
            if (!migrated) throw new Error("Migrated pool missing");
            const s = Number(migrated.state.sqrtPrice.toString()) / 2 ** 64;
            capSol = marketCapSol(s, totalSupply, supply.value.decimals, migrated.state.tokenBMint.equals(NATIVE_MINT));
          }
          const solAmount =
            receipt.side === "buy"
              ? receipt.amount
              : String(Math.max(0, (delta ?? 0) + confirmed.meta.fee));
          const sample = {
            signature: body.signature,
            wallet,
            side: receipt.side,
            time: (confirmed.blockTime ?? Math.floor(Date.now() / 1000)) * 1000,
            observedAt: Date.now(),
            capSol,
            volumeLamports: solAmount,
          };
          await putImage(
            Buffer.from(JSON.stringify(sample)),
            "application/json",
            { key: `dbc-trades/${receipt.characterId}/${body.signature}.json` },
          );
        }
      }
    } catch {
      historyWarning =
        "Trade confirmed, but its market-history observation could not be saved.";
    }
    return NextResponse.json({
      confirmed: true,
      signature: body.signature,
      walletSolChange: delta == null ? null : delta / 1e9,
      networkFeeLamports: confirmed.meta.fee,
      historyWarning,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Devnet trade failed" },
      { status: 400 },
    );
  }
}
