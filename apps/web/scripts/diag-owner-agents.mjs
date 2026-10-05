// M0 diagnostic for the /wallet "0 agents / all $0" symptom.
//
// Answers the one question the dashboard can't: are your agents/campaigns keyed
// to a wallet you're NOT currently viewing under (identity divergence — the
// listByCreators union fixes it), or do none exist under any of your wallets
// (you genuinely never minted — only a real mint helps)?
//
// Usage (from apps/web):
//   node scripts/diag-owner-agents.mjs <wallet1> [wallet2 ...]
// Pass every wallet you might own (your Privy embedded wallet + any external
// Phantom/Solflare you've used). The embedded wallet shown on /wallet right now
// is pSZM…ipyb — include its full address.
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => {
  const l = env.split("\n").find((x) => x.startsWith(k + "="));
  return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : "";
};

const mine = new Set(process.argv.slice(2).filter(Boolean));
const convex = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));

const agents = await convex.query(api.influencers.listAll, {});

// Tally agents per creatorWallet.
const byWallet = new Map();
for (const a of agents) {
  const w = a.creatorWallet ?? "(none)";
  if (!byWallet.has(w)) byWallet.set(w, []);
  byWallet.get(w).push(a);
}

console.log(`\nTotal agents in DB: ${agents.length}`);
console.log(`Distinct creatorWallets: ${byWallet.size}\n`);

let mineCount = 0;
const rows = [...byWallet.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [w, list] of rows) {
  const owned = mine.has(w);
  if (owned) mineCount += list.length;
  const names = list.slice(0, 4).map((a) => a.name || a.handle || "?").join(", ");
  console.log(`${owned ? "✅ YOURS " : "        "} ${w}  ×${list.length}  ${names}${list.length > 4 ? " …" : ""}`);
}

console.log("\n── Verdict ──");
if (mine.size === 0) {
  console.log("No wallets passed. Re-run with your wallet address(es) as args to get a verdict.");
} else if (mineCount > 0) {
  console.log(`✅ ${mineCount} agent(s) found under YOUR wallet set → identity divergence.`);
  console.log("   The listByCreators union (this PR) surfaces them once you pass profile.walletAddresses.");
  console.log("   If a ✅ wallet above is NOT in your Privy linked wallets, link it (Privy 'connect wallet') so whoami picks it up.");
} else {
  console.log("⚠️  ZERO agents under any wallet you passed.");
  console.log("   Either (a) the minting wallet isn't in your list — add it and re-run, or");
  console.log("   (b) you genuinely never minted under these wallets → no wiring fixes this; mint an agent.");
}
console.log("");
