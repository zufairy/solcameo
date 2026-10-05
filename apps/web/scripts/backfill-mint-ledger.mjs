// One-time transition backfill for the "first agent free, then $50" mint fee.
//
// The fee ledger (agentMintCharges) starts empty, so without this every EXISTING
// agent owner would get one more free mint (the ledger thinks they've never
// minted). This marks every current agent as a prior mint, so owners are charged
// $50 on their NEXT agent. Idempotent — safe to run more than once.
//
// Run once AFTER `npx convex deploy` (from apps/web):
//   node scripts/backfill-mint-ledger.mjs
//
// Reads NEXT_PUBLIC_CONVEX_URL + INTERNAL_CRON_SECRET from .env.local.
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => {
  const l = env.split("\n").find((x) => x.startsWith(k + "="));
  return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : "";
};

const url = get("NEXT_PUBLIC_CONVEX_URL");
// The secret must match the value set in the PROD Convex environment (Convex
// dashboard → Settings → Environment Variables → INTERNAL_CRON_SECRET), which
// can differ from a local-dev value in .env.local. Allow overriding it via a CLI
// arg or MINT_BACKFILL_SECRET env so you don't have to edit .env.local:
//   node scripts/backfill-mint-ledger.mjs <prod-INTERNAL_CRON_SECRET>
const secret = process.argv[2] || process.env.MINT_BACKFILL_SECRET || get("INTERNAL_CRON_SECRET");
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set in .env.local");
if (!secret) throw new Error("INTERNAL_CRON_SECRET not set (pass it as an arg or set MINT_BACKFILL_SECRET)");

const convex = new ConvexHttpClient(url);
const res = await convex.mutation(api.mintFee.backfillFromInfluencers, { authSecret: secret });
console.log(`Backfill complete: scanned ${res.scanned} agents, inserted ${res.inserted} ledger rows.`);
console.log("Existing agent owners will now be charged $50 on their next mint.");
