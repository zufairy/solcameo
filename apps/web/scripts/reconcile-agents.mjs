import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const SECRET = get("INTERNAL_CRON_SECRET");
const APP = "https://velloagents.com";
const convex = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));
const all = await convex.query(api.influencers.listAll, {});
const clippers = all.filter((a) => a.agentType === "clipping" && a.agentWallet);
for (const a of clippers) {
  let onchain = null;
  try { const b = await (await fetch(`${APP}/api/agent-wallet-balance?wallet=${a.agentWallet}`)).json(); onchain = b.ok ? Number(b.usdc) : null; } catch {}
  if (onchain == null) { console.log(`${(a.name || "?").padEnd(18)} balance read failed — skip`); continue; }
  try {
    await convex.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: a.mintAddress, onchainUsdc: onchain, authSecret: SECRET });
    const acct = await convex.query(api.agentAccount.getWithNav, { mintAddress: a.mintAddress });
    console.log(`${(a.name || "?").padEnd(18)} on-chain=$${onchain.toFixed(2)} -> escrowMirror now $${(acct?.escrowUsdc ?? "?")}`);
  } catch (e) { console.log(`${(a.name || "?").padEnd(18)} reconcile FAILED — ${String(e.message).slice(0, 70)}`); }
}
