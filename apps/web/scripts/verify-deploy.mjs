import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const SECRET = get("INTERNAL_CRON_SECRET");
const r1 = await fetch("https://velloagents.com/api/agents/config", { method: "POST", headers: { "Content-Type": "application/json", "X-Internal-Secret": SECRET }, body: "{}" });
console.log("config route POST {}: HTTP " + r1.status + "  (400 = LIVE; 404 = not deployed)");
const convex = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));
try {
  await convex.mutation(api.influencers.setClipConfig, { mintAddress: "deploy-check-nonexistent-xyz", clipConfig: {} });
  console.log("setClipConfig WITHOUT secret: ACCEPTED  ->  GATE NOT DEPLOYED");
} catch (e) {
  const m = String(e.message || e);
  const gated = /authSecret|unauthorized|ArgumentValidationError|Validator|missing/i.test(m);
  console.log("setClipConfig WITHOUT secret: rejected  ->  " + (gated ? "GATE DEPLOYED (ok)" : "other: " + m.slice(0, 120)));
}
