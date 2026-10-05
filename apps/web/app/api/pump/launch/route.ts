import { NextRequest, NextResponse } from "next/server";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PUMP_SDK, feeSharingConfigPda, bondingCurvePda } from "@/lib/server/pumpSdk";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { prepareAuthedJson, convexClient, isConvexIdString } from "@/lib/server/solstarRoute";
import { launchOptionsSchema } from "@/lib/pump/economics";
import { putImage } from "@/lib/server/imageStorage";
import { USDC_MINT, pumpConnection, pumpMessageHash, pumpReadiness, pumpShareholders, publicWallet, readPumpReceipt, signPumpReceipt, unsignedPumpTransaction, verifyPumpTransaction, type PumpReceipt } from "@/lib/server/pumpLaunch";
import { pumpSharingInstructions } from "@/lib/server/pumpInstructions";
export const maxDuration = 60;
export async function GET() { return NextResponse.json(pumpReadiness()); }
export async function POST(req: NextRequest) {
  const prep = await prepareAuthedJson(req, 16384);
  if (!prep.ok) return prep.res;
  const { wallet, secret, body } = prep;
  const readiness = pumpReadiness();
  if (!readiness.ready) return NextResponse.json({ error: readiness.reason }, { status: 503 });
  try {
    const connection = pumpConnection();
    if (body.action === "prepare-payout") {
      if (!isConvexIdString(body.characterId)) throw new Error("Invalid launch character.");
      const { character, token } = await convexClient().query(api.solstarCreate.getLaunchCharacter, { characterId: body.characterId as Id<"ssCharacters">, wallet, authSecret: secret });
      if (token.network !== "mainnet" || token.state !== "live" || !token.mint) throw new Error("This character has no confirmed live Pump launch.");
      const options = launchOptionsSchema.parse(character.launchOptions ?? {});
      if (options.rewards === "holders") throw new Error("Holder rewards have no creator-fee payout.");
      const mint = new PublicKey(token.mint), sharingConfigAddress = feeSharingConfigPda(mint);
      const [configInfo, curveInfo] = await Promise.all([connection.getAccountInfo(sharingConfigAddress), connection.getAccountInfo(bondingCurvePda(mint))]);
      if (!configInfo || !curveInfo) throw new Error("Pump's fee configuration is unavailable.");
      const sharingConfig = PUMP_SDK.decodeSharingConfig(configInfo), curve = PUMP_SDK.decodeBondingCurve(curveInfo);
      const quoteMint = options.pair === "USDC" ? new PublicKey(USDC_MINT) : NATIVE_MINT;
      const instructions = [];
      if (curve.complete) instructions.push(await PUMP_SDK.transferCreatorFeesToPumpV2({ payer: new PublicKey(wallet), mint, quoteMint, quoteTokenProgram: TOKEN_PROGRAM_ID }));
      instructions.push(await PUMP_SDK.distributeCreatorFeesV2({ mint, sharingConfig, sharingConfigAddress, quoteMint, payer: new PublicKey(wallet), shouldInitializeAta: true, quoteTokenProgram: TOKEN_PROGRAM_ID }));
      const prepared = await unsignedPumpTransaction(connection, new PublicKey(wallet), instructions);
      const receipt: PumpReceipt = { wallet, characterId: body.characterId, mint: token.mint, options, stage: "payout", messageHash: pumpMessageHash(prepared.tx), expires: Date.now() + 7 * 86400000 };
      return NextResponse.json({ transaction: prepared.transaction, receipt: signPumpReceipt(receipt) });
    }
    if (body.action === "prepare") {
      if (!isConvexIdString(body.characterId) || typeof body.mint !== "string") throw new Error("Invalid launch character.");
      const { character, token } = await convexClient().query(api.solstarCreate.getLaunchCharacter, { characterId: body.characterId as Id<"ssCharacters">, wallet, authSecret: secret });
      if (token.mint) throw new Error(`This character already launched: ${token.mint}`);
      const options = launchOptionsSchema.parse(character.launchOptions ?? {});
      if (options.pair === "CUSTOM") throw new Error("Live custom quote mints require separate support verification. Choose SOL or USDC.");
      if (options.rewards === "creator") pumpShareholders(options, wallet);
      if (options.postingBudgetUsdc > 0) publicWallet(options.operationsWallet);
      const mint = publicWallet(body.mint);
      if (await connection.getAccountInfo(mint)) throw new Error("This mint already exists. Resume your previous launch.");
      const metadata = await putImage(Buffer.from(JSON.stringify({ name: token.name, symbol: token.ticker, description: token.description, image: character.referenceImageUrl })), "application/json", { keyPrefix: `pump-metadata/${body.characterId}` });
      const ix = await PUMP_SDK.createV2Instruction({ mint, creator: new PublicKey(wallet), user: new PublicKey(wallet), name: token.name, symbol: token.ticker, uri: metadata.url, mayhemMode: false, holderReward: options.rewards === "holders", quoteMint: options.pair === "USDC" ? new PublicKey(USDC_MINT) : NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID });
      // Check the second transaction before asking the user to spend on token creation.
      const followup = await pumpSharingInstructions(wallet, body.mint, options);
      if (followup.length) await unsignedPumpTransaction(connection, new PublicKey(wallet), followup);
      const prepared = await unsignedPumpTransaction(connection, new PublicKey(wallet), [ix]);
      const receipt: PumpReceipt = { wallet, characterId: body.characterId, mint: body.mint, options, stage: "launch", messageHash: pumpMessageHash(prepared.tx), expires: Date.now() + 7 * 86400000 };
      return NextResponse.json({ transaction: prepared.transaction, receipt: signPumpReceipt(receipt), mint: body.mint });
    }
    if (typeof body.receipt !== "string") throw new Error("Missing launch receipt.");
    const receipt = readPumpReceipt(body.receipt, wallet);
    if (body.action === "submit") {
      if (typeof body.transaction !== "string" || body.transaction.length > 5000) throw new Error("Invalid signed transaction.");
      const tx = VersionedTransaction.deserialize(Buffer.from(body.transaction, "base64"));
      if (pumpMessageHash(tx) !== receipt.messageHash) throw new Error("Signed transaction differs from your reviewed launch.");
      if (receipt.stage === "launch") await convexClient().mutation(api.solstarCreate.reservePumpMint, { characterId: receipt.characterId as Id<"ssCharacters">, wallet, mint: receipt.mint, authSecret: secret });
      const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      // Return immediately: the browser keeps the signature and resumes verification without another spend.
      return NextResponse.json({ signature });
    }
    if (typeof body.signature !== "string") throw new Error("Missing confirmed signature.");
    await verifyPumpTransaction(connection, body.signature, receipt);
    if (body.action === "confirm-payout" && receipt.stage === "payout") return NextResponse.json({ complete: true, signature: body.signature });
    if (body.action === "sharing" && receipt.stage === "launch") {
      const creator = new PublicKey(wallet);
      const instructions = await pumpSharingInstructions(wallet, receipt.mint, receipt.options);
      if (!instructions.length) {
        const result = await convexClient().mutation(api.solstarCreate.finalizePumpLaunch, { characterId: receipt.characterId as Id<"ssCharacters">, wallet, mint: receipt.mint, launchSignature: body.signature, authSecret: secret });
        return NextResponse.json({ complete: true, ...result });
      }
      const prepared = await unsignedPumpTransaction(connection, creator, instructions);
      return NextResponse.json({ transaction: prepared.transaction, receipt: signPumpReceipt({ ...receipt, stage: "sharing", messageHash: pumpMessageHash(prepared.tx), launchSignature: body.signature, expires: Date.now() + 7 * 86400000 }) });
    }
    if (body.action === "finalize" && receipt.stage === "sharing" && receipt.launchSignature) {
      // The receipt is issued only after launch confirmation; verify the fee split/funding transaction above.
      const result = await convexClient().mutation(api.solstarCreate.finalizePumpLaunch, { characterId: receipt.characterId as Id<"ssCharacters">, wallet, mint: receipt.mint, launchSignature: receipt.launchSignature, sharingSignature: body.signature, authSecret: secret });
      return NextResponse.json({ complete: true, ...result });
    }
    throw new Error("Invalid launch step.");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pump launch preparation failed." }, { status: 400 });
  }
}
