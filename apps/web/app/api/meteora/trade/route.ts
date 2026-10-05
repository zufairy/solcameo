import { migratedPool } from "@/lib/server/dammLifecycle";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { NextRequest, NextResponse } from "next/server";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import BN from "bn.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { prepareAuthedJson, convexClient, isConvexIdString } from "@/lib/server/solstarRoute";
import { assertDevnet } from "@/lib/server/devnetGuard";
import { dbcConnection } from "@/lib/server/meteoraLaunch";
import { unsignedPumpTransaction, pumpMessageHash } from "@/lib/server/pumpLaunch";
import { readTradeReceipt, signTradeReceipt } from "@/lib/server/dbcTradeReceipt";
import { putImage } from "@/lib/server/imageStorage";
import { getNetwork } from "@/lib/solana/network";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const prep = await prepareAuthedJson(req,16384);
  if (!prep.ok) return prep.res;
  const { body, wallet } = prep;
  if (getNetwork() !== "devnet") return NextResponse.json({error:"This rehearsal trades only on Solana devnet."},{status:400});
  try {
    const connection = dbcConnection();
    await assertDevnet(connection);
    const client = new DynamicBondingCurveClient(connection,"confirmed");
    const payer = new PublicKey(wallet);
    if (body.action === "prepare") {
      if (!isConvexIdString(body.characterId) || !["buy","sell"].includes(body.side as string) || typeof body.amount !== "string" || !/^\d{1,19}$/.test(body.amount)) throw new Error("Invalid trade");
      const amount = new BN(body.amount);
      const slippage = Number(body.slippageBps);
      if (amount.lte(new BN(0)) || !Number.isInteger(slippage) || slippage < 10 || slippage > 1000) throw new Error("Invalid amount or slippage");
      const data = await convexClient().query(api.solstarMarket.terminal,{characterId:body.characterId as Id<"ssCharacters">});
      if (!data?.token.dbcPool || !data.token.dbcConfig || data.token.network !== "devnet" || !["live","graduated","migrated"].includes(data.token.state)) throw new Error("This coin is not minted on devnet. Mint it first.");
      const poolAddress = new PublicKey(data.token.dbcPool);
      const [pool,config] = await Promise.all([client.state.getPool(poolAddress),client.state.getPoolConfig(new PublicKey(data.token.dbcConfig))]);
      if (!pool || !config || pool.poolState.baseMint.toBase58() !== data.token.mint || pool.poolState.config.toBase58() !== data.token.dbcConfig) throw new Error("Bonding curve is unavailable or has graduated");
      let tx, minimumOut:BN;
      if(pool.poolState.isMigrated){
        const migrated=await migratedPool(connection,poolAddress);if(!migrated)throw new Error("Graduated pool unavailable");
        const state=migrated.state,inputMint=body.side==="buy"?NATIVE_MINT:pool.poolState.baseMint,outputMint=body.side==="buy"?pool.poolState.baseMint:NATIVE_MINT;
        const quote=migrated.cp.getQuote({inAmount:amount,inputTokenMint:inputMint,slippage:slippage/100,poolState:state,currentTime:Math.floor(Date.now()/1000),currentSlot:await connection.getSlot("confirmed"),tokenADecimal:state.tokenAMint.equals(NATIVE_MINT)?9:6,tokenBDecimal:state.tokenBMint.equals(NATIVE_MINT)?9:6,hasReferral:false});
        minimumOut=quote.minSwapOutAmount;
        tx=await migrated.cp.swap({payer,pool:migrated.address,inputTokenMint:inputMint,outputTokenMint:outputMint,amountIn:amount,minimumAmountOut:minimumOut,tokenAMint:state.tokenAMint,tokenBMint:state.tokenBMint,tokenAVault:state.tokenAVault,tokenBVault:state.tokenBVault,tokenAProgram:TOKEN_PROGRAM_ID,tokenBProgram:TOKEN_PROGRAM_ID,referralTokenAccount:null,poolState:state});
      }else{
      const currentPoint = new BN(config.activationType === 0 ? await connection.getSlot("confirmed") : Math.floor(Date.now()/1000));
      const swapBaseForQuote = body.side === "sell";
      const quote = client.pool.swapQuote({virtualPool:pool,config,swapBaseForQuote,amountIn:amount,slippageBps:slippage,hasReferral:false,currentPoint,eligibleForFirstSwapWithMinFee:false});
      tx = await client.pool.swap({owner:payer,pool:poolAddress,amountIn:amount,minimumAmountOut:quote.minimumAmountOut,swapBaseForQuote,referralTokenAccount:null});
      minimumOut=quote.minimumAmountOut;
      }
      const prepared = await unsignedPumpTransaction(connection,payer,tx.instructions);
      return NextResponse.json({transaction:prepared.transaction,receipt:signTradeReceipt({wallet,characterId:body.characterId,hash:pumpMessageHash(prepared.tx),side:body.side as "buy"|"sell",amount:body.amount,expires:Date.now()+120000}),minimumOut:minimumOut.toString()});
    }
    if (typeof body.receipt !== "string") throw new Error("Missing reviewed trade");
    const receipt = readTradeReceipt(body.receipt,wallet, body.action === "confirm");
    if (body.action === "submit") {
      if (typeof body.transaction !== "string" || body.transaction.length > 5000) throw new Error("Invalid signed transaction");
      const tx = VersionedTransaction.deserialize(Buffer.from(body.transaction,"base64"));
      if (pumpMessageHash(tx) !== receipt.hash) throw new Error("Signed trade differs from your reviewed transaction");
      return NextResponse.json({signature:await connection.sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:3})});
    }
    if (body.action !== "confirm" || typeof body.signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(body.signature)) throw new Error("Invalid trade confirmation");
    const confirmed = await connection.getTransaction(body.signature,{commitment:"confirmed",maxSupportedTransactionVersion:0});
    if (!confirmed) {
      if (typeof body.transaction === "string") {
        const packet = VersionedTransaction.deserialize(Buffer.from(body.transaction, "base64"));
        if (pumpMessageHash(packet) !== receipt.hash || bs58.encode(packet.signatures[0]) !== body.signature) throw new Error("Recovery packet differs from the reviewed swap");
        const status = await connection.getSignatureStatuses([body.signature], { searchTransactionHistory: true });
        if (status.value[0]?.err) return NextResponse.json({ failed: true, signature: body.signature });
        if (!status.value[0] && !(await connection.isBlockhashValid(packet.message.recentBlockhash, { commitment: "confirmed" })).value) return NextResponse.json({ expired: true });
      }
      throw new Error("Trade not confirmed successfully yet");
    }
    if (!confirmed.meta || confirmed.meta.err) return NextResponse.json({ failed: true, signature: body.signature });
    if (pumpMessageHash(new VersionedTransaction(confirmed.transaction.message)) !== receipt.hash) throw new Error("Confirmed trade differs from reviewed transaction");
    const keys = confirmed.transaction.message.staticAccountKeys;
    const index = keys.findIndex(k=>k.equals(payer));
    const delta = index < 0 ? null : confirmed.meta.postBalances[index]-confirmed.meta.preBalances[index];
    let historyWarning: string | undefined;
    try {
      const data = await convexClient().query(api.solstarMarket.terminal, { characterId: receipt.characterId as Id<"ssCharacters"> });
      if (data?.token.dbcPool) {
        const state = await client.state.getPool(new PublicKey(data.token.dbcPool));
        if (state) {
          const sqrt = Number(state.poolState.sqrtPrice.toString()) / 2 ** 64;
          const solAmount = receipt.side === "buy" ? receipt.amount : String(Math.max(0, (delta ?? 0) + confirmed.meta.fee));
          const sample = { signature: body.signature, wallet, side: receipt.side, time: (confirmed.blockTime ?? Math.floor(Date.now()/1000)) * 1000, observedAt: Date.now(), capSol: sqrt * sqrt * 1e6, volumeLamports: solAmount };
          await putImage(Buffer.from(JSON.stringify(sample)), "application/json", { key: `dbc-trades/${receipt.characterId}/${body.signature}.json` });
        }
      }
    } catch { historyWarning = "Trade confirmed, but its market-history observation could not be saved."; }
    return NextResponse.json({confirmed:true,signature:body.signature,walletSolChange:delta == null ? null : delta/1e9,networkFeeLamports:confirmed.meta.fee,historyWarning});
  } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:"Devnet trade failed"},{status:400}); }
}
