// Hard-delete the DELETED Web3-board campaigns from Convex.
//
// The /stage "Web3" tab has been removed, so its campaigns (category "web3"/absent,
// non-clipping_fr) are no longer shown anywhere. This tool deletes them + their
// submissions. It is DRY-RUN BY DEFAULT: it only previews unless you pass --execute.
//
// Selection is precise server-side (convex/adminCampaigns): a UGC, Clipping, or
// Clipping FR campaign can NEVER be selected. Funded rows (spentUsdc > 0 or a set
// pdaAddress) are SKIPPED unless you also pass --force.
//
// Usage (from apps/web) — always dry-run first:
//   node scripts/delete-web3-campaigns.mjs                          # preview only
//   node scripts/delete-web3-campaigns.mjs --execute                # delete unfunded
//   node scripts/delete-web3-campaigns.mjs --execute --force        # also delete funded
//
// Reads NEXT_PUBLIC_CONVEX_URL + INTERNAL_CRON_SECRET from .env.local (or env).
// The secret must match the value in the TARGET Convex deployment's environment
// (Convex dashboard → Settings → Environment Variables → INTERNAL_CRON_SECRET),
// which can differ from a local-dev value. Override it without editing .env.local:
//   node scripts/delete-web3-campaigns.mjs --execute <prod-INTERNAL_CRON_SECRET>
//   DELETE_WEB3_SECRET=<prod-secret> node scripts/delete-web3-campaigns.mjs --execute
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

let envFile = "";
try {
  envFile = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
} catch {
  /* no .env.local — fall back to process.env */
}
const get = (k) => {
  const l = envFile.split("\n").find((x) => x.startsWith(k + "="));
  return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : "";
};

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const force = args.includes("--force");
const positional = args.filter((a) => !a.startsWith("--"));

const url = process.env.NEXT_PUBLIC_CONVEX_URL || get("NEXT_PUBLIC_CONVEX_URL");
const secret = positional[0] || process.env.DELETE_WEB3_SECRET || get("INTERNAL_CRON_SECRET");

if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set (in .env.local or env)");
if (!secret) throw new Error("INTERNAL_CRON_SECRET not set (pass it as an arg or set DELETE_WEB3_SECRET)");

const convex = new ConvexHttpClient(url);
const fmt$ = (n) => `$${Number(n ?? 0).toLocaleString()}`;

function printRows(label, rows) {
  console.log(`\n${label} (${rows.length}):`);
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  rows.forEach((r, i) => {
    const cat = r.category ?? "(none)";
    const origin = r.origin ?? "(none)";
    console.log(
      `  ${String(i + 1).padStart(2)}. ${String(r.title).slice(0, 40).padEnd(40)}  ` +
        `cat=${String(cat).padEnd(8)} origin=${String(origin).padEnd(12)} ` +
        `budget=${fmt$(r.budget).padEnd(10)} spent=${fmt$(r.spentUsdc).padEnd(8)} subs=${r.submissionsCount}`,
    );
  });
}

// Always preview first so the operator sees the exact targets.
const preview = await convex.query(api.adminCampaigns.previewWeb3Deletion, { authSecret: secret });
console.log(`Convex: ${url}`);
console.log(`Scanned ${preview.scanned} campaigns — ${preview.total} match the removed Web3 board.`);
printRows("WOULD DELETE (unfunded)", preview.toDelete);
printRows("SKIPPED (funded — needs --force)", preview.skipped);

if (!execute) {
  console.log(
    `\nDRY RUN — nothing deleted. Re-run with --execute` +
      (preview.skipped.length > 0 ? " (and --force to include the funded/skipped rows)" : "") +
      " to delete.",
  );
  process.exit(0);
}

console.log(`\nExecuting delete (force=${force})...`);
const res = await convex.mutation(api.adminCampaigns.executeWeb3Deletion, { authSecret: secret, force });
printRows("DELETED", res.deleted);
if (res.skipped.length > 0) printRows("SKIPPED (funded — re-run with --force)", res.skipped);
console.log(
  `\nDone. Deleted ${res.deletedCount} campaign(s) + ${res.removedSubmissions} submission(s); skipped ${res.skippedCount}.`,
);
