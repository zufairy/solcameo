import { platformLaunchOwner } from "@/lib/server/platformLaunchOwner";
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
import { boundedPrice, priorityFeeMicroLamports } from "@/lib/server/priorityFee";
export async function handleDbcLaunch(req: NextRequest, platform = false) {
  const prep = await prepareAuthedJson(req, 16384);
  if (!prep.ok) return prep.res;
  const { body, wallet, secret } = prep;
  const network = getNetwork() === "mainnet-beta" ? "mainnet" : "devnet";
  if (platform && wallet !== await platformLaunchOwner()) return NextResponse.json({ error: "Connect the platform wallet to launch SOLCAMEO." }, { status: 403 });
  const getLaunch = async (characterId: string) => {
    if (!platform) return convexClient().query(api.solstarCreate.getLaunchCharacter, { characterId: characterId as Id<"ssCharacters">, wallet, authSecret: secret });
    const row = await convexClient().query(api.platformLaunch.get, { network, authSecret: secret });
    if (!row || row.wallet !== wallet || characterId !== "platform") throw new Error("Platform launch draft unavailable.");
    return { character: { referenceImageUrl: row.image }, token: { name: row.name, ticker: row.ticker, description: row.description, mint: row.mint, state: row.state, dbcConfig: row.config } };
  };
  const storedOptions = async () => {
    const row = await convexClient().query(api.platformLaunch.get, { network, authSecret: secret });
    if (!row || row.wallet !== wallet) throw new Error("Platform launch draft unavailable.");
    return dbcOptionsSchema.parse(JSON.parse(row.optionsJson));
  };
  const finalize = async (a: { characterId: Id<"ssCharacters">; wallet: string; mint: string; config: string; pool: string; network: "devnet" | "mainnet"; launchSignature: string; economy: "creator-only" | "sustainable-v1"; treasuryWallet?: string; authSecret: string }) => {
    if (!platform) return convexClient().mutation(api.solstarCreate.finalizeDbcLaunch, a);
    await convexClient().mutation(api.platformLaunch.update, { network, wallet, authSecret: secret, action: "finalize", mint: a.mint, config: a.config, pool: a.pool, signature: a.launchSignature });
  };
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
      const { character, token } = await getLaunch(body.characterId);
      if (token.mint)
        throw new Error("This character has a saved launch. Resume it first.");
      publicWallet(body.mint);
      publicWallet(body.config);
      const options = { ...(platform ? await storedOptions() : dbcOptionsSchema.parse(body.options)), feeBps: (platform ? 100 : TRADING_FEE_BPS) as 25 | 100 | 150 | 200 }; // flat fee for every coin
      if (options.economy === "sustainable-v1") dbcTreasury();
      buildDbcCurve(options, platform ? "platform" : "influencer"); // Validate construction before metadata upload or wallet costs.
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
        protocol: "meteora-dbc", platform,
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
    } else if (body.action === "recover") {
      // Resume a launch whose browser state is gone: find what already happened on chain and continue from there.
      if (!isConvexIdString(body.characterId) || typeof body.mint !== "string") throw new Error("Invalid launch identifiers.");
      publicWallet(body.mint);
      const { character, token } = await getLaunch(body.characterId);
      if (token.state === "live") return NextResponse.json({ mode: "complete" });
      if (!token.mint) return NextResponse.json({ mode: "none" });
      const oldMint = new PublicKey(token.mint);
      // Case 1: the pool already exists on chain (the transaction landed, only the page lost track). Finish the record.
      const landed = await client.state.getPoolByBaseMint(oldMint);
      if (landed) {
        if (landed.account.poolState.creator.toBase58() !== wallet) throw new Error("This launch belongs to a different wallet.");
        const sigs = await connection.getSignaturesForAddress(landed.publicKey, { limit: 100 }, "confirmed");
        const first = sigs.filter((x) => !x.err).at(-1);
        if (!first) throw new Error("Pool found, but its creation transaction could not be read yet. Retry shortly.");
        const options = { ...(platform ? await storedOptions() : dbcOptionsSchema.parse(body.options)), feeBps: (platform ? 100 : TRADING_FEE_BPS) as 25 | 100 | 150 | 200 };
        await finalize({
          characterId: body.characterId as Id<"ssCharacters">, wallet, mint: token.mint, config: landed.account.poolState.config.toBase58(),
          pool: landed.publicKey.toBase58(), network: getNetwork() === "mainnet-beta" ? "mainnet" : "devnet", launchSignature: first.signature,
          economy: options.economy, treasuryWallet: options.economy === "sustainable-v1" ? dbcTreasury().publicKey.toBase58() : undefined, authSecret: secret,
        });
        return NextResponse.json({ mode: "complete" });
      }
      // Case 2: the old mint was never created. Reuse the curve config the first transaction already paid for.
      const options = { ...(platform ? await storedOptions() : dbcOptionsSchema.parse(body.options)), feeBps: (platform ? 100 : TRADING_FEE_BPS) as 25 | 100 | 150 | 200 };
      const wanted = buildDbcCurve(options, platform ? "platform" : "influencer");
      let configKey: PublicKey | null = token.dbcConfig ? new PublicKey(token.dbcConfig) : null;
      if (!configKey) {
        const owned = await client.state.getPoolConfigsByOwner(payer);
        for (const entry of owned) {
          if (entry.account.sqrtStartPrice.toString() !== String(wanted.sqrtStartPrice) || entry.account.migrationQuoteThreshold.toString() !== String(wanted.migrationQuoteThreshold)) continue;
          if ((await client.state.getPoolsByConfig(entry.publicKey)).length) continue; // already used by a launched coin
          configKey = entry.publicKey;
          break;
        }
      }
      if (!configKey) {
        // Nothing was paid on chain: free the reservation so a normal launch can start.
        if ((await connection.getAccountInfo(oldMint, "confirmed")) === null) {
          if (platform) await convexClient().mutation(api.platformLaunch.update, { network, wallet, mint: token.mint, action: "release", authSecret: secret });
          else await convexClient().mutation(api.solstarCreate.releaseReservedMint, { characterId: body.characterId as Id<"ssCharacters">, wallet, mint: token.mint, authSecret: secret });
          return NextResponse.json({ mode: "none" });
        }
        throw new Error("This launch has a token on chain but no pool. Contact support before retrying.");
      }
      if ((await connection.getAccountInfo(configKey, "confirmed")) === null) {
        if (platform && (await connection.getAccountInfo(oldMint, "confirmed")) === null) {
          await convexClient().mutation(api.platformLaunch.update, { network, wallet, mint: token.mint, action: "release", authSecret: secret });
          return NextResponse.json({ mode: "none" });
        }
        throw new Error("The saved curve configuration was not found on chain.");
      }
      if ((await connection.getAccountInfo(oldMint, "confirmed")) !== null) throw new Error("The reserved token already exists on chain without a pool. Contact support before retrying.");
      if (platform) await convexClient().mutation(api.platformLaunch.update, { network, wallet, oldMint: token.mint, mint: body.mint, config: configKey.toBase58(), action: "replace", authSecret: secret });
      else await convexClient().mutation(api.solstarCreate.replaceReservedMint, {
        characterId: body.characterId as Id<"ssCharacters">, wallet, oldMint: token.mint, newMint: body.mint, config: configKey.toBase58(), authSecret: secret,
      });
      const metadata = await putImage(
        Buffer.from(JSON.stringify({ name: token.name, symbol: token.ticker, description: token.description, image: character.referenceImageUrl })),
        "application/json",
        { keyPrefix: `dbc-metadata/${body.characterId}` },
      );
      receipt = {
        protocol: "meteora-dbc", platform, wallet, characterId: body.characterId, mint: body.mint, config: configKey.toBase58(), uri: metadata.url, options,
        network: getNetwork() === "mainnet-beta" ? "mainnet" : "devnet", stage: "pool", messageHash: "", expires: Date.now() + 7 * 86400000,
      };
    } else {
      if (typeof body.receipt !== "string")
        throw new Error("Missing launch receipt.");
      receipt = readDbcReceipt(body.receipt, wallet);
      // Recheck ownership for every submission/confirmation, not only preparation.
      await getLaunch(receipt.characterId);
      if (!!receipt.platform !== platform) throw new Error("Launch receipt belongs to a different launch type.");
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
        if (platform) await convexClient().mutation(api.platformLaunch.update, { network, wallet, mint: receipt.mint, config: receipt.config, action: "reserve", authSecret: secret });
        else await convexClient().mutation(api.solstarCreate.reservePumpMint, {
          characterId: receipt.characterId as Id<"ssCharacters">,
          wallet,
          mint: receipt.mint,
          config: receipt.config,
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
        if (!confirmed || !confirmed.meta || confirmed.meta.err) {
          // Say what really happened instead of waiting forever: failed on chain, dropped, or still pending.
          const failure = confirmed?.meta?.err ?? (await connection.getSignatureStatuses([body.signature], { searchTransactionHistory: true })).value[0]?.err;
          if (failure) return NextResponse.json({ error: `Solana rejected the transaction: ${JSON.stringify(failure)}. Nothing was created. Press Launch to try again.`, code: "TX_FAILED" }, { status: 409 });
          if (typeof body.transaction === "string" && body.transaction.length < 6000) {
            const sent = VersionedTransaction.deserialize(Buffer.from(body.transaction, "base64"));
            const seen = (await connection.getSignatureStatuses([body.signature], { searchTransactionHistory: true })).value[0];
            if (!seen && !(await connection.isBlockhashValid(sent.message.recentBlockhash, { commitment: "confirmed" })).value)
              return NextResponse.json({ error: "Your approval expired before Solana processed it. Nothing was charged. Press Launch to sign a fresh one.", code: "BLOCKHASH_EXPIRED" }, { status: 409 });
          }
          throw new Error("Transaction is not confirmed successfully yet.");
        }
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
          await finalize({
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
          if (!platform && receipt.options.autopilot) {
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
      await getLaunch(receipt.characterId)
    ).token;
    const tx =
      receipt.stage === "config"
        ? await client.partner.createConfig({
            ...buildDbcCurve(receipt.options, platform ? "platform" : "influencer"),
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
    // A launch with no priority fee can sit unconfirmed for minutes on a busy mainnet and then drop, which is the
    // "stuck, then fails" a signer sees. Pay a market-rate (bounded) fee and ask for only the compute the step uses
    // (the pool step measured about 105k units).
    const computeUnitLimit = receipt.stage === "pool" ? 250_000 : 400_000;
    const priorityMicroLamports = boundedPrice(await priorityFeeMicroLamports(network, [config.toBase58(), payer.toBase58()]), computeUnitLimit);
    const prepared = await unsignedPumpTransaction(
      connection,
      payer,
      tx.instructions,
      { priorityMicroLamports, computeUnitLimit },
    );
    if (platform && body.action === "prepare") await convexClient().mutation(api.platformLaunch.update, { network, wallet, mint: receipt.mint, config: receipt.config, action: "reserve", authSecret: secret });
    return NextResponse.json({
      transaction: prepared.transaction,
      receipt: signDbcReceipt({
        ...receipt,
        messageHash: pumpMessageHash(prepared.tx),
        lastValidBlockHeight: prepared.lastValidBlockHeight,
      }),
      stage: receipt.stage,
      ...(body.action === "recover" ? { mode: "resume" as const } : {}),
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
