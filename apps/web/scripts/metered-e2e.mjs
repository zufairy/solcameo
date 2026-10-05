import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const SECRET = get("INTERNAL_CRON_SECRET");
const APP = "https://velloagents.com";
const TREASURY = get("NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET");
const MINT = process.argv[2] || "2joeGtRPDroujFMWRHQXyx6YHfTHRhR3pFDGMtfaoAKf"; // Bamboms
const SRC = process.argv[3] || "https://www.youtube.com/watch?v=U0-ttGGB7b4";
const convex = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));
const H = { "Content-Type": "application/json", "X-Internal-Secret": SECRET };
const bal = async (w) => { try { const b = await (await fetch(`${APP}/api/agent-wallet-balance?wallet=${w}`)).json(); return b.ok ? Number(b.usdc) : `err:${b.error}`; } catch { return "fetch-err"; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spend = () => convex.query(api.usage.serviceSpendQuery, { mintAddress: MINT });

const agent = await convex.query(api.influencers.getByMintServer, { mintAddress: MINT, authSecret: SECRET });
console.log(`AGENT ${agent?.name} wallet=${agent?.agentWallet}\nTREASURY ${TREASURY}\n`);
const W = agent.agentWallet;

const beforeA = await bal(W), beforeT = await bal(TREASURY), sBefore = await spend();
console.log(`BEFORE  agentWallet=$${beforeA}  treasury=$${beforeT}`);
console.log(`  spend=${JSON.stringify(sBefore)}\n`);

const rt = await fetch(`${APP}/api/agents/run-task`, { method: "POST", headers: H, body: JSON.stringify({ mintAddress: MINT, taskType: "clip_source", input: { sourceUrl: SRC }, triggeredBy: "clip_canvas" }) });
console.log(`RUN-TASK HTTP ${rt.status}  ${JSON.stringify(await rt.json().catch(() => ({}))).slice(0, 160)}\n`);

let charged = 0;
for (let i = 0; i < 20; i++) {
  await sleep(3000);
  const jobs = await convex.query(api.clipJobs.listJobsByMint, { mintAddress: MINT }).catch(() => []);
  const s = await spend();
  charged = (s.unsettledTabUsdc ?? 0) - (sBefore.unsettledTabUsdc ?? 0);
  console.log(`  poll ${i}: job=${jobs?.[0]?.status} unsettledTab=$${(s.unsettledTabUsdc ?? 0).toFixed(4)} (charged $${charged.toFixed(4)})`);
  if (charged > 0.0001) break;
}
console.log(`\nASSERT DEBIT: agent charged $${charged.toFixed(4)} (unsettledTab delta)\n`);

const st = await fetch(`${APP}/api/economy/settle-tab`, { method: "POST", headers: H, body: JSON.stringify({ mintAddress: MINT }) });
const stj = await st.json().catch(() => ({}));
console.log(`SETTLE-TAB HTTP ${st.status}  ${JSON.stringify(stj).slice(0, 300)}\n`);

await sleep(5000);
const afterA = await bal(W), afterT = await bal(TREASURY), sFinal = await spend();
console.log(`AFTER   agentWallet=$${afterA}  treasury=$${afterT}`);
console.log(`  spend=${JSON.stringify(sFinal)}\n`);
console.log("=== RECONCILE ===");
console.log(`  charged (tab):        $${charged.toFixed(4)}`);
console.log(`  settle-tab amount:    ${stj.amountUsdc ?? stj.settled ?? "?"}  tx=${(stj.txSignature || "").slice(0, 24)}`);
console.log(`  treasury delta:       $${(typeof afterT === "number" && typeof beforeT === "number" ? (afterT - beforeT).toFixed(4) : "rpc?")}`);
console.log(`  agentWallet delta:    $${(typeof afterA === "number" && typeof beforeA === "number" ? (afterA - beforeA).toFixed(4) : "rpc?")}`);
console.log(`  unsettledTab now:     $${(sFinal.unsettledTabUsdc ?? 0).toFixed(4)} (expect ~0)`);
