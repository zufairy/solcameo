import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const convex = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));
const agents = (await convex.query("influencers:listAll", {})).filter((a) => a.agentType === "clipping");
const all = [];
for (const a of agents) {
  const jobs = await convex.query("clipJobs:listJobsByMint", { mintAddress: a.mintAddress }).catch(() => []);
  for (const j of jobs) all.push({ agent: a.name, ...j });
}
all.sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0));
console.log("Recent clip jobs (newest first) — clipsTotal = # clips the run planned:\n");
for (const j of all.slice(0, 14)) {
  const when = new Date(j.createdAt).toISOString().slice(5, 16).replace("T", " ");
  console.log(`[${when}] ${(j.agent||"?").padEnd(16)} ${(j.status||"?").padEnd(11)} clipsTotal=${j.clipsTotal ?? "?"}  src=${(j.sourceUrl||"").slice(0,40)}`);
}
