import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { Keypair } from "@solana/web3.js";
import { encryptWalletSecret } from "@/lib/server/walletCrypto";
import { x402Config } from "@/lib/server/x402/config";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
export const runtime = "nodejs";
const input = z.object({ mintAddress: z.string().min(32).max(44), enabled: z.boolean(),
  perRequestMicros: z.number().int().min(0).max(100_000), dailyMicros: z.number().int().min(0).max(1_000_000) });
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (auth.internal) return NextResponse.json({ error: "Owner SIWS session required" }, { status: 403 });
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid policy" }, { status: 400 });
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const agent = await convex.query(api.influencers.getByMint, { mintAddress: parsed.data.mintAddress });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  const denied = requireOwnerWithSiws(auth, agent.creatorWallet);
  if (denied) return denied;
  if (parsed.data.perRequestMicros > parsed.data.dailyMicros) return NextResponse.json({ error: "Daily budget below request budget" }, { status: 400 });
  const authSecret = process.env.INTERNAL_CRON_SECRET ?? "";
  let config: ReturnType<typeof x402Config>;
  try { config = x402Config(); } catch {
    if (parsed.data.enabled) return NextResponse.json({ error: "x402 payments are not configured" }, { status: 503 });
    config = { network: process.env.X402_NETWORK as ReturnType<typeof x402Config>["network"], payTo: "", asset: "", facilitatorUrl: "" };
  }
  const prior = await convex.query(api.x402.getPolicyServer, { mintAddress: parsed.data.mintAddress, authSecret });
  if (!prior && !parsed.data.enabled) return NextResponse.json({ ok: true, ...parsed.data, walletAddress: "", paymentNetwork: config.network });
  if (prior && prior.network !== config.network && parsed.data.enabled) return NextResponse.json({ error: "Spending wallet belongs to a different payment network" }, { status: 409 });
  const wallet = prior ? undefined : Keypair.generate();
  const walletAddress = prior?.walletAddress ?? wallet!.publicKey.toBase58();
  const walletSecret = prior?.walletSecret ?? encryptWalletSecret(Buffer.from(wallet!.secretKey).toString("base64"));
  await convex.mutation(api.x402.setPolicy, { ...parsed.data, ownerWallet: auth.provenWallet!, walletAddress, walletSecret, network: prior?.network ?? config.network, authSecret });
  return NextResponse.json({ ok: true, ...parsed.data, walletAddress, paymentNetwork: config.network, usdcMint: config.asset, funding: "Fund this dedicated wallet with USDC on X402_NETWORK. Credits and the agent investment wallet are separate." });
}
