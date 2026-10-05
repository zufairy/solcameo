// TEMP E2E — trigger a CLOUD clip run (run-task clip_source -> clipJobs.process) on
// the funded test agent and poll clipJobs till done. Verifies the production cloud
// path end-to-end on prod. Delete after.
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const SECRET = get("INTERNAL_CRON_SECRET");
const CONVEX_URL = get("NEXT_PUBLIC_CONVEX_URL");
const APP = "https://velloagents.com";
const MINT = "HLEmBir8PoTmsmFhc7NbEUypjRrKdxx2fZxvpZkwDUd9";
const SOURCE = process.argv[2] || "https://www.youtube.com/watch?v=U0-ttGGB7b4";

const res = await fetch(APP + "/api/agents/run-task", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Internal-Secret": SECRET },
  body: JSON.stringify({ mintAddress: MINT, taskType: "clip_source", input: { sourceUrl: SOURCE }, triggeredBy: "e2e" }),
});
const rj = await res.json().catch(() => ({}));
console.log("run-task HTTP " + res.status + " " + JSON.stringify(rj).slice(0, 300));

const convex = new ConvexHttpClient(CONVEX_URL);
const t0 = Date.now();
let last = "";
while (Date.now() - t0 < 9 * 60_000) {
  await new Promise((r) => setTimeout(r, 8000));
  let jobs;
  try { jobs = await convex.query("clipJobs:listJobsByMint", { mintAddress: MINT }); }
  catch (e) { console.log("poll err: " + (e.message || e)); continue; }
  const j = jobs?.[0];
  if (!j) { console.log("no job yet"); continue; }
  const line = `${j.status} clips=${j.clipsReady ?? 0}/${j.clipsTotal ?? 0}` + (j.error ? " ERR:" + String(j.error).slice(0, 160) : "");
  if (line !== last) { console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${line}`); last = line; }
  if (j.status === "completed" || j.status === "error") {
    try {
      const clips = await convex.query("clipJobs:getClipsForJob", { jobId: j._id });
      console.log("CLIPS: " + JSON.stringify((clips || []).map((c) => ({ status: c.status, clipUrl: c.clipUrl, title: c.title })), null, 2));
    } catch (e) { console.log("getClipsForJob err: " + (e.message || e)); }
    break;
  }
}
console.log("DONE");
