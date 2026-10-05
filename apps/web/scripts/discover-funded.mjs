import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const APP = "https://velloagents.com";
const convex = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));
const all = await convex.query(api.influencers.listAll, {});
const clippers = all.filter((a) => a.agentType === "clipping" && a.agentWallet);
console.log("Clipping agents with a wallet: " + clippers.length + "\n");
for (const a of clippers) {
  let usdc = "?";
  try { const b = await (await fetch(`${APP}/api/agent-wallet-balance?wallet=${a.agentWallet}`)).json(); usdc = b.ok ? `$${Number(b.usdc).toFixed(2)}` : `err:${b.error}`; } catch { usdc = "fetch-err"; }
  let skills = [];
  try { const sf = await convex.query(api.agentSkillFiles.listByMint, { mintAddress: a.mintAddress }); skills = (sf || []).map((s) => s.skillId); } catch {}
  console.log(`${(a.name || "?").padEnd(18)} mint=${a.mintAddress.slice(0, 12)} usdc=${usdc.padEnd(9)} skills=[${skills.join(",")}]`);
}
