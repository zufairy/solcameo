// TEMP — delete the user-selected agents (agent + upload-post slot) via the prod route.
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const SECRET = get("INTERNAL_CRON_SECRET");
const APP = "https://velloagents.com";
const H = { "Content-Type": "application/json", "X-Internal-Secret": SECRET };
const TARGETS = [
  ["Glitch Overlord", "2UQJNs5YfPoehaD8qeLCgLQZLd6rp5v8PHV26EzUL6hq"],
  ["Viral Hook Master", "H9kLvPPBEW4Hf4xA1EqMUnQSvqzZUpGJfRDfoPUGGooF"],
  ["Test1", "vello_cf02e7d4_1781366601569"],
  ["Luks", "9jLpiqJ9sAp8vR2hGTGYYaWpBDLR9MsuMs1gB7bpRDEQ"],
  ["Podcast Clipper", "4TyfQ4YnGiny7ocXe9LmVbxE2ob4ghjYZNT9yyNn1YWQ"],
  ["Test", "3mP95cEzvdLEzR5r7F4ogoruKQRMNFkrP4LvWnRyszMp"],
  ["Kadance", "4GNeSwvYpWqMdpexrfp8LHWxzd7c4x8Kmt4qjH9czdpP"],
];

// Liveness: empty body should hit the route and return 400 "mintAddress required".
// A 404 means /api/agents/delete isn't in the deployed build yet.
const live = await fetch(APP + "/api/agents/delete", { method: "POST", headers: H, body: "{}" });
if (live.status === 404) { console.log("ROUTE NOT DEPLOYED YET (404). Wait for the Railway deploy + a Convex deploy, then re-run."); process.exit(0); }
console.log("route live (empty-body HTTP " + live.status + ")\n");

let done = 0;
for (const [name, mint] of TARGETS) {
  const r = await fetch(APP + "/api/agents/delete", { method: "POST", headers: H, body: JSON.stringify({ mintAddress: mint }) });
  const j = await r.json().catch(() => ({}));
  console.log(`${name.padEnd(20)} -> HTTP ${r.status}  ${JSON.stringify(j)}`);
  if (!r.ok || j.ok === false) { console.log("\nSTOPPED — delete failed (Convex deploy of influencers.deleteByMint may be incomplete). Fix + re-run; the rest are untouched."); break; }
  done++;
}
console.log(`\nDELETED ${done}/${TARGETS.length}`);
