import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import bs58 from "bs58";
import { Keypair, Transaction } from "@solana/web3.js";
import { createBurnInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { api } from "@/convex/_generated/api";
import { getNetwork } from "@/lib/solana/network";
import { rpcCandidates, rpcTry } from "@/lib/solana/rpc";
import { platformTokenMint } from "@/lib/server/platformTokenChain";

export const runtime = "nodejs";
export const maxDuration = 60;

const authed = (req: NextRequest) => {
  const expected = Buffer.from(process.env.INTERNAL_CRON_SECRET ?? "");
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
};
const loadSigner = () => {
  const raw = process.env.SOLCAMEO_TREASURY_SECRET?.trim();
  if (!raw) return null;
  try { return Keypair.fromSecretKey(raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw)); } catch { return null; }
};

/**
 * Operator-only weekly job (Convex cron or manual).
 *   { action: "plan" }                               freeze the week that just closed (idempotent)
 *   { action: "burn", epochStart, tokens, execute? } burn `tokens` whole SOLCAMEO from the treasury token account
 * The market buy that acquires the tokens is an operator step; this route only burns what the treasury already holds.
 * Burns are a dry run unless execute:true AND SOLCAMEO_EPOCH_EXECUTE=true, and can never exceed the treasury's balance.
 */
export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL, secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!url) return NextResponse.json({ error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(url);
  const body = (await req.json().catch(() => ({}))) as { action?: string; epochStart?: number; tokens?: number; execute?: boolean };

  if (body.action === "plan") {
    try {
      return NextResponse.json({ ok: true, ...(await convex.mutation(api.platformToken.planEpoch, { authSecret: secret, ...(typeof body.epochStart === "number" ? { epochStart: body.epochStart } : {}) })) });
    } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "plan failed" }, { status: 409 }); }
  }

  if (body.action === "burn") {
    const mint = await platformTokenMint(), signer = loadSigner();
    const tokens = Number(body.tokens);
    if (!mint || !signer) return NextResponse.json({ error: "SOLCAMEO_TOKEN_MINT or SOLCAMEO_TREASURY_SECRET is not configured" }, { status: 503 });
    if (typeof body.epochStart !== "number" || !Number.isFinite(tokens) || tokens <= 0) return NextResponse.json({ error: "epochStart and a positive token amount are required" }, { status: 400 });
    const urls = rpcCandidates(getNetwork());
    try {
      const info = await rpcTry(urls, (c) => c.getAccountInfo(mint, "confirmed"));
      const program = info?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const decimals = (await rpcTry(urls, (c) => c.getTokenSupply(mint, "confirmed"))).value.decimals;
      const ata = getAssociatedTokenAddressSync(mint, signer.publicKey, false, program);
      const balance = (await rpcTry(urls, (c) => c.getTokenAccountBalance(ata, "confirmed"))).value;
      const raw = BigInt(Math.floor(tokens * 10 ** decimals));
      if (raw > BigInt(balance.amount)) return NextResponse.json({ error: `Treasury holds ${balance.uiAmountString} SOLCAMEO, less than the ${tokens} requested` }, { status: 409 });
      const dry = !(body.execute === true && process.env.SOLCAMEO_EPOCH_EXECUTE === "true");
      if (dry) return NextResponse.json({ ok: true, dryRun: true, wouldBurn: tokens, treasuryBalance: balance.uiAmountString });
      const sig = await rpcTry(urls, async (c) => {
        const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
        const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(createBurnInstruction(ata, mint, signer.publicKey, raw, [], program));
        tx.sign(signer);
        const signature = await c.sendRawTransaction(tx.serialize());
        const res = await c.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        if (res.value.err) throw new Error("Burn transaction failed on-chain");
        return signature;
      });
      await convex.mutation(api.platformToken.markBurned, { authSecret: secret, epochStart: body.epochStart, burnTokens: String(tokens), burnSig: sig }).catch(() => undefined);
      return NextResponse.json({ ok: true, burned: tokens, signature: sig });
    } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "burn failed" }, { status: 502 }); }
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

