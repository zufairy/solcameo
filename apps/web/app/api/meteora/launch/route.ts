import { dbcTreasury } from "@/lib/server/dbcTreasury";
import bs58 from "bs58";
import { NextRequest, NextResponse } from "next/server";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  DynamicBondingCurveClient,
  deriveDbcPoolAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  prepareAuthedJson,
  convexClient,
  isConvexIdString,
} from "@/lib/server/solstarRoute";
import { putImage } from "@/lib/server/imageStorage";
import { buildDbcCurve } from "@/lib/meteora/curve";
import { dbcOptionsSchema } from "@/lib/meteora/options";
import { TRADING_FEE_BPS } from "@/lib/meteora/feePolicy";
import {
  dbcConnection,
  dbcReadiness,
  readDbcReceipt,
  signDbcReceipt,
  type DbcReceipt,
} from "@/lib/server/meteoraLaunch";
import {
  pumpMessageHash,
  unsignedPumpTransaction,
  publicWallet,
} from "@/lib/server/pumpLaunch";
import { assertConfiguredChain } from "@/lib/server/devnetGuard";
import { getNetwork } from "@/lib/solana/network";
import { LAUNCH_MIN_LAMPORTS, formatSol } from "@/lib/meteora/launchCost";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const prep = await prepareAuthedJson(req, 16384);
  if (!prep.ok) return prep.res;
  const { body, wallet, secret } = prep;
  if (!dbcReadiness().ready)
    return NextResponse.json({ error: dbcReadiness().reason }, { status: 503 });
  try {
    const connection = dbcConnection(),
      client = new DynamicBondingCurveClient(connection, "confirmed"),
      payer = new PublicKey(wallet);
    await assertConfiguredChain(connection, getNetwork() === "mainnet-beta" ? "mainnet" : "devnet");
    let receipt: DbcReceipt;
    if (body.action === "prepare") {
      if (
        !isConvexIdString(body.characterId) ||
        typeof body.mint !== "string" ||
        typeof body.config !== "string"
      )
        throw new Error("Invalid launch identifiers.");
      const { character, token } = await convexClient().query(
        api.solstarCreate.getLaunchCharacter,
        {
          characterId: body.characterId as Id<"ssCharacters">,
          wallet,
          authSecret: secret,
        },
      );
      if (token.mint)
        throw new Error("This character has a saved launch. Resume it first.");
      publicWallet(body.mint);
      publicWallet(body.config);
      const options = { ...dbcOptionsSchema.parse(body.options), feeBps: TRADING_FEE_BPS as 25 | 100 | 150 | 200 }; // flat fee for every coin
      if (options.economy === "sustainable-v1") dbcTreasury();
      buildDbcCurve(options); // Validate construction before metadata upload or wallet costs.
      const metadata = await putImage(
        Buffer.from(
          JSON.stringify({
            name: token.name,
            symbol: token.ticker,
            description: token.description,
            image: character.referenceImageUrl,
          }),
        ),
        "application/json",
        { keyPrefix: `dbc-metadata/${body.characterId}` },
      );
      receipt = {
        protocol: "meteora-dbc",
        wallet,
        characterId: body.characterId,
        mint: body.mint,
        config: body.config,
        uri: metadata.url,
        options,
        network: getNetwork() === "mainnet-beta" ? "mainnet" : "devnet",
        stage: "config",
        messageHash: "",
        expires: Date.now() + 7 * 86400000,
      };
    } else {
      if (typeof body.receipt !== "string")
        throw new Error("Missing launch receipt.");
      receipt = readDbcReceipt(body.receipt, wallet);
      // Recheck ownership for every submission/confirmation, not only preparation.
      await convexClient().query(api.solstarCreate.getLaunchCharacter, {
        characterId: receipt.characterId as Id<"ssCharacters">,
        wallet,
        authSecret: secret,
      });
      if (body.action === "refresh") {
        if (
          typeof body.transaction !== "string" ||
          body.transaction.length > 5000
        )
          throw new Error("Invalid saved transaction.");
        const previous = VersionedTransaction.deserialize(
          Buffer.from(body.transaction, "base64"),
        );
        if (pumpMessageHash(previous) !== receipt.messageHash)
          throw new Error(
            "Saved transaction differs from the reviewed launch.",
          );
        if (previous.signatures[0].some((v) => v !== 0)) {
          const signature = bs58.encode(previous.signatures[0]);
          const status = (
            await connection.getSignatureStatuses([signature], {
              searchTransactionHistory: true,
            })
          ).value[0];
          if (status?.err)
            throw new Error(
              "The saved transaction failed on Solana. Review its signature before retrying.",
            );
          if (status) return NextResponse.json({ signature });
        }
        if (
          (await connection.isBlockhashValid(previous.message.recentBlockhash, {commitment: "confirmed"}))
            .value
        )
          return NextResponse.json({
            transaction: body.transaction,
            receipt: body.receipt,
            stage: receipt.stage,
          });
        if (receipt.lastValidBlockHeight != null && await connection.getBlockHeight("confirmed") <= receipt.lastValidBlockHeight)
          return NextResponse.json({error: "Solana is syncing your saved approval. Retry shortly.", code: "RPC_RETRY"}, {status: 503});
        // An expired transaction can no longer land. Rebuild the same accounts/settings with a fresh blockhash.
      }
      if (body.action === "submit") {
        if (
          typeof body.transaction !== "string" ||
          body.transaction.length > 5000
        )
          throw new Error("Invalid signed transaction.");
        const tx = VersionedTransaction.deserialize(
          Buffer.from(body.transaction, "base64"),
        );
        if (pumpMessageHash(tx) !== receipt.messageHash)
          throw new Error(
            "Transaction differs from your reviewed Meteora launch.",
          );
        await convexClient().mutation(api.solstarCreate.reservePumpMint, {
          characterId: receipt.characterId as Id<"ssCharacters">,
          wallet,
          mint: receipt.mint,
          authSecret: secret,
        });
        if (!(await connection.isBlockhashValid(tx.message.recentBlockhash, {commitment: "confirmed"})).value) {
          if (receipt.lastValidBlockHeight != null && await connection.getBlockHeight("confirmed") <= receipt.lastValidBlockHeight)
            return NextResponse.json({error: "Solana is syncing your approval. Your signed transaction is saved.", code: "RPC_RETRY"}, {status: 503});
          return NextResponse.json({ error: "Your wallet approval expired. Refreshing the launch transaction is safe.", code: "BLOCKHASH_EXPIRED" }, {status: 409});
        }
        const signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });
        return NextResponse.json({ signature });
      }
      if (body.action !== "refresh") {
        if (
          body.action !== "confirm" ||
          typeof body.signature !== "string" ||
          !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(body.signature)
        )
          throw new Error("Invalid launch step.");
        const confirmed = await connection.getTransaction(body.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (!confirmed || !confirmed.meta || confirmed.meta.err)
          throw new Error("Transaction is not confirmed successfully yet.");
        const confirmedTx = new VersionedTransaction(
          confirmed.transaction.message,
        );
        if (pumpMessageHash(confirmedTx) !== receipt.messageHash)
          throw new Error(
            "Confirmed transaction differs from the reviewed launch.",
          );
        if (receipt.stage === "pool") {
          const pool = deriveDbcPoolAddress(
            NATIVE_MINT,
            new PublicKey(receipt.mint),
            new PublicKey(receipt.config),
          );
          const state = await client.state.getPool(pool);
          if (!state || state.poolState.creator.toBase58() !== wallet || state.poolState.baseMint.toBase58() !== receipt.mint)
            throw new Error("Confirmed Meteora pool unavailable.");
          const supply = await connection.getTokenSupply(new PublicKey(receipt.mint), "confirmed");
          if (supply.value.decimals !== 6 || BigInt(supply.value.amount) <= 0n) throw new Error("SPL mint supply was not verified on chain.");
          await convexClient().mutation(api.solstarCreate.finalizeDbcLaunch, {
            characterId: receipt.characterId as Id<"ssCharacters">,
            wallet,
            mint: receipt.mint,
            config: receipt.config,
            pool: pool.toBase58(),
            network: receipt.network,
            launchSignature: body.signature,
            economy: receipt.options.economy,
            treasuryWallet: receipt.options.economy === "sustainable-v1" ? dbcTreasury().publicKey.toBase58() : undefined,
            authSecret: secret,
          });
          // Off-chain switch: turn the agent's heartbeat on so it makes and posts content by itself.
          // Failing here must never undo or hide a confirmed launch, so the result is reported, not thrown.
          let autopilot = false;
          if (receipt.options.autopilot) {
            try {
              const convex = convexClient();
              const saved = await convex.mutation(api.influencers.saveAgentConfig, { mintAddress: receipt.characterId, heartbeatEnabled: true, heartbeatCron: receipt.options.autopilotCadence, authSecret: secret });
              if (saved) {
                await convex.mutation(api.influencers.setAutonomyMode, { mintAddress: receipt.characterId, mode: "full-auto", authSecret: secret });
                autopilot = true;
              }
            } catch { /* The owner can still switch it on from the agent page. */ }
          }
          return NextResponse.json({ complete: true, autopilot, mint: receipt.mint, pool: pool.toBase58(), supply: supply.value.amount, network: receipt.network, signature: body.signature, networkFeeLamports: confirmed.meta.fee });
        }
        receipt = { ...receipt, stage: "pool" };
      }
    }
    const config = new PublicKey(receipt.config);
    // The wallet pays all on-chain rent. Refuse BEFORE asking for a signature if it can't cover this step,
    // instead of letting the simulation fail after the first transaction has already been paid.
    const requiredLamports = receipt.stage === "config" ? LAUNCH_MIN_LAMPORTS.total : LAUNCH_MIN_LAMPORTS.pool;
    const balanceLamports = await connection.getBalance(payer, "confirmed");
    if (balanceLamports < requiredLamports)
      return NextResponse.json({
        error: `Your wallet needs about ${formatSol(requiredLamports)} SOL to ${receipt.stage === "config" ? "launch" : "finish this launch"} (it has ${formatSol(balanceLamports) || "0"} SOL). This covers on-chain rent and network fees. Add SOL, then press Launch again. Nothing is lost.`,
        code: "INSUFFICIENT_SOL", requiredLamports, balanceLamports,
      }, { status: 402 });
    const token = (
      await convexClient().query(api.solstarCreate.getLaunchCharacter, {
        characterId: receipt.characterId as Id<"ssCharacters">,
        wallet,
        authSecret: secret,
      })
    ).token;
    const tx =
      receipt.stage === "config"
        ? await client.partner.createConfig({
            ...buildDbcCurve(receipt.options),
            config,
            feeClaimer: receipt.options.economy === "sustainable-v1" ? dbcTreasury().publicKey : payer,
            leftoverReceiver: payer,
            payer,
            quoteMint: NATIVE_MINT,
          })
        : await client.creator.createPool({
            config,
            baseMint: new PublicKey(receipt.mint),
            payer,
            poolCreator: payer,
            name: token.name,
            symbol: token.ticker,
            uri: receipt.uri,
          });
    const prepared = await unsignedPumpTransaction(
      connection,
      payer,
      tx.instructions,
    );
    return NextResponse.json({
      transaction: prepared.transaction,
      receipt: signDbcReceipt({
        ...receipt,
        messageHash: pumpMessageHash(prepared.tx),
        lastValidBlockHeight: prepared.lastValidBlockHeight,
      }),
      stage: receipt.stage,
    });
  } catch (e) {
    if (e instanceof Error && /blockhash not found/i.test(e.message))
      return NextResponse.json({ error: "Solana is catching up with your transaction. Retry to resume your saved launch.", code: "RPC_RETRY" }, {status: 503});
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Meteora launch failed." },
      { status: 400 },
    );
  }
}
