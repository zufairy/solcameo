import { PUMP_SDK } from "@/lib/server/pumpSdk";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { type LaunchOptions } from "@/lib/pump/economics";
import { USDC_MINT, pumpShareholders, publicWallet } from "./pumpLaunch";
export async function pumpSharingInstructions(wallet: string, mintAddress: string, options: LaunchOptions) {
  const creator = new PublicKey(wallet), mint = new PublicKey(mintAddress), instructions: TransactionInstruction[] = [];
  if (options.rewards === "creator") {
    instructions.push(await PUMP_SDK.createFeeSharingConfig({ creator, mint, pool: null }));
    instructions.push(await PUMP_SDK.updateFeeSharesV2({ authority: creator, mint, currentShareholders: [creator], newShareholders: pumpShareholders(options, wallet), quoteMint: options.pair === "USDC" ? new PublicKey(USDC_MINT) : NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID }));
  }
  if (options.postingBudgetUsdc > 0) {
    const usdc = new PublicKey(USDC_MINT), recipient = publicWallet(options.operationsWallet);
    const target = getAssociatedTokenAddressSync(usdc, recipient);
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(creator, target, recipient, usdc));
    instructions.push(createTransferCheckedInstruction(getAssociatedTokenAddressSync(usdc, creator), usdc, target, creator, BigInt(Math.round(options.postingBudgetUsdc * 1e6)), 6));
  }
  return instructions;
}
