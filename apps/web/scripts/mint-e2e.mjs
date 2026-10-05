// TEMP E2E helper — mint a headless test clipping agent on prod. Delete after.
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const SECRET = get("INTERNAL_CRON_SECRET");
const APP = "https://velloagents.com"; // mach.city has a broken TLS cert; velloagents.com is the valid prod host
if (!SECRET) { console.error("no INTERNAL_CRON_SECRET in .env.local"); process.exit(1); }
const creator = Keypair.generate().publicKey.toBase58();
const sessionId = "e2e_" + Date.now().toString(36);
const body = { sessionId, txSignature: "free_promo_" + sessionId, creatorWallet: creator, agentBlueprint: { agentType: "clipping", persona: { name: "E2E Test Clipper", niche: "comedy" } } };
console.log("POST " + APP + "/api/nft/mint  (creator=" + creator + ")");
const res = await fetch(APP + "/api/nft/mint", { method: "POST", headers: { "Content-Type": "application/json", "X-Internal-Secret": SECRET }, body: JSON.stringify(body) });
const j = await res.json().catch(() => ({}));
console.log("HTTP " + res.status);
console.log(JSON.stringify(j, null, 2));
