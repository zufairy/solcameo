import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { convexClient, prepareAuthedJson } from "@/lib/server/solstarRoute";
import { handleDbcLaunch } from "@/lib/server/dbcLaunchRoute";
import { platformLaunchOwner } from "@/lib/server/platformLaunchOwner";
import { dbcReadiness } from "@/lib/server/meteoraLaunch";
import { platformTokenMint } from "@/lib/server/platformTokenChain";
import { DEFAULT_DBC, dbcOptionsSchema } from "@/lib/meteora/options";
import { getNetwork } from "@/lib/solana/network";

export const runtime = "nodejs";
export const maxDuration = 60;
const network = () => getNetwork() === "mainnet-beta" ? "mainnet" as const : "devnet" as const;
const draftSchema = z.object({
  name: z.string().trim().min(2).max(32),
  description: z.string().trim().min(1).max(1000),
  image: z.string().url().refine(s => s.startsWith("https://"), "Use an HTTPS artwork URL."),
  initialCapSol: z.number().min(0.1).max(1000),
  graduationCapSol: z.number().min(1).max(10000),
});
export async function GET() {
  try {
    const row = await convexClient().query(api.platformLaunch.get, { network: network(), authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
    const mint = await platformTokenMint();
    return NextResponse.json({ ...dbcReadiness(), owner: await platformLaunchOwner(), mint: mint?.toBase58() ?? null, draft: row ? { name: row.name, description: row.description, image: row.image, mint: row.mint, config: row.config, pool: row.pool, signature: row.signature, state: row.state, options: JSON.parse(row.optionsJson) } : null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Platform launch settings could not be loaded." }, { status: 503 });
  }
}
export async function POST(req: NextRequest) {
  // Parse a clone so the shared launch handler can perform its normal authenticated prelude.
  const prep = await prepareAuthedJson(new NextRequest(req.clone()), 16384);
  if (!prep.ok) return prep.res;
  const owner = await platformLaunchOwner();
  if (!owner || prep.wallet !== owner) return NextResponse.json({ error: "Connect the platform wallet to launch SOLCAMEO." }, { status: 403 });
  if (prep.body.action !== "draft") return handleDbcLaunch(req, true);
  try {
    if (await platformTokenMint()) return NextResponse.json({ error: "The platform token is already configured for this network." }, { status: 409 });
    const a = draftSchema.parse(prep.body);
    const options = dbcOptionsSchema.parse({ ...DEFAULT_DBC, economy: "creator-only", autopilot: false, initialCapSol: a.initialCapSol, graduationCapSol: a.graduationCapSol });
    await convexClient().mutation(api.platformLaunch.draft, { network: network(), wallet: prep.wallet, name: a.name, description: a.description, image: a.image, optionsJson: JSON.stringify(options), authSecret: prep.secret });
    return NextResponse.json({ ok: true, options });
  } catch (e) {
    return NextResponse.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : e instanceof Error ? e.message : "Could not save platform launch." }, { status: 400 });
  }
}
