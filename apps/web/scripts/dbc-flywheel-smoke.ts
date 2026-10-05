/** Real devnet lifecycle smoke. Uses test SOL only; refuses mainnet. */
import fs from "node:fs";
import dotenv from "dotenv";
import {Keypair,Connection,sendAndConfirmTransaction} from "@solana/web3.js";
import {NATIVE_MINT} from "@solana/spl-token";
import {DynamicBondingCurveClient,SwapMode,DAMM_V2_MIGRATION_FEE_ADDRESS} from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import {dbcTreasury} from "../lib/server/dbcTreasury";
import {buildDbcCurve} from "../lib/meteora/curve";
import {DEFAULT_DBC} from "../lib/meteora/options";
import {getRpcUrl} from "../lib/solana/network";
import {assertDevnet} from "../lib/server/devnetGuard";
import {confirmedQuoteDebit} from "../lib/server/dbcClaimAccounting";
async function main(){
  Object.assign(process.env,dotenv.parse(fs.readFileSync(".env.local")));
  const connection=new Connection(process.env.SOLCAMEO_DBC_RPC_URL||getRpcUrl("devnet"),"confirmed");await assertDevnet(connection);
  const payer=dbcTreasury();let balance=await connection.getBalance(payer.publicKey);
  if(balance<1500000000){
    try{const signature=await connection.requestAirdrop(payer.publicKey,2000000000);await connection.confirmTransaction(signature,"confirmed");balance=await connection.getBalance(payer.publicKey);}catch{throw new Error(`Devnet faucet unavailable. Fund ${payer.publicKey.toBase58()} with 2 test SOL to run the lifecycle smoke.`);}
  }
  console.log("Devnet treasury:",payer.publicKey.toBase58(),"test SOL:",balance/1e9);
  if(!process.argv.includes("--run"))return;
  const client=new DynamicBondingCurveClient(connection,"confirmed"),config=Keypair.generate(),mint=Keypair.generate();
  const curve=buildDbcCurve({...DEFAULT_DBC,initialCapSol:.1,graduationCapSol:1});
  const configTx=await client.partner.createConfig({...curve,config:config.publicKey,feeClaimer:payer.publicKey,leftoverReceiver:payer.publicKey,payer:payer.publicKey,quoteMint:NATIVE_MINT});
  const configSignature=await sendAndConfirmTransaction(connection,configTx,[payer,config]);console.log("Config confirmed:",configSignature);
  const create=await client.creator.createPool({config:config.publicKey,baseMint:mint.publicKey,payer:payer.publicKey,poolCreator:payer.publicKey,name:"Solcameo lifecycle test",symbol:"SCMTEST",uri:"https://solcameo.com"});
  const poolSignature=await sendAndConfirmTransaction(connection,create,[payer,mint]);
  const pools=await client.state.getPoolsByConfig(config.publicKey);const pool=pools.find(p=>p.account.poolState.baseMint.equals(mint.publicKey));if(!pool)throw new Error("Pool not found");
  console.log("Pool confirmed:",poolSignature,"Mint:",mint.publicKey.toBase58());
  const maxQuote=new BN(curve.migrationQuoteThreshold.toString()).muln(100).divn(99).addn(1000);
  const swap=await client.pool.swap2({swapMode:SwapMode.PartialFill,owner:payer.publicKey,pool:pool.publicKey,amountIn:maxQuote,minimumAmountOut:new BN(1),swapBaseForQuote:false,referralTokenAccount:null});
  const swapSignature=await sendAndConfirmTransaction(connection,swap,[payer]);console.log("Buy confirmed:",swapSignature);
  const state=await client.state.getPool(pool.publicKey);if(!state)throw new Error("Pool missing");
  const claim=await client.partner.claimPartnerTradingFee2({feeClaimer:payer.publicKey,payer:payer.publicKey,pool:pool.publicKey,maxBaseAmount:new BN(0),maxQuoteAmount:state.poolState.partnerQuoteFee,receiver:payer.publicKey});
  const claimSignature=await sendAndConfirmTransaction(connection,claim,[payer]);const receipt=await connection.getTransaction(claimSignature,{commitment:"confirmed",maxSupportedTransactionVersion:0});if(!receipt)throw new Error("Claim receipt missing");
  console.log("Verified partner SOL claim:",confirmedQuoteDebit(receipt,state.poolState.quoteVault).toString(),"lamports",claimSignature);
  const migrated=await client.migration.migrateToDammV2({payer:payer.publicKey,pool:pool.publicKey,dammConfig:DAMM_V2_MIGRATION_FEE_ADDRESS[6]});
  const migrationSignature=await sendAndConfirmTransaction(connection,migrated.transaction,[payer,migrated.firstPositionNftKeypair,migrated.secondPositionNftKeypair]);
  console.log("Graduation confirmed:",migrationSignature);if(!(await client.state.getPool(pool.publicKey))?.poolState.isMigrated)throw new Error("Pool not graduated");
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
