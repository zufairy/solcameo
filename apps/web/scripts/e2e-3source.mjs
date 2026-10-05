// FULL E2E — 3 sources (paste URL / campaign Drive / upload-as-storage) x bug-prone skill
// combos, through the deployed pipeline routes. Captures every stage error + renders clips
// for vision-judging. Unmetered (direct routes + internal secret). Delete after.
import { readFileSync, writeFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const SECRET = get("INTERNAL_CRON_SECRET");
const APP = "https://velloagents.com";
const DIR = "C:/Users/ongee/AppData/Local/Temp/claude/C--Project-Vello/de16cc55-5d7f-4eaf-a1fb-d02e1bfb7718/scratchpad";
const CAMPAIGN_REWARD = "d1e13de1-28bb-4859-98d1-a9797c4ce38a";
const URL_SRC = "https://www.youtube.com/watch?v=U0-ttGGB7b4";
const H = { "Content-Type": "application/json", "X-Internal-Secret": SECRET };

async function post(path, body, timeoutMs = 120000, label = "") {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const r = await fetch(APP + path, { method: "POST", headers: H, body: JSON.stringify(body), signal: ac.signal });
    const j = await r.json().catch(() => ({ ok: false, error: `non-JSON ${r.status}` }));
    const secs = Math.round((Date.now() - started) / 1000);
    if (!r.ok || j.ok === false) console.log(`  [${label}] ${path} FAIL ${r.status} (${secs}s): ${String(j.error).slice(0, 120)}`);
    else console.log(`  [${label}] ${path} ok (${secs}s)`);
    return j;
  } catch (e) {
    clearTimeout(t);
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(`  [${label}] ${path} THREW (${secs}s): ${e.name === "AbortError" ? `timeout after ${timeoutMs}ms` : e.message}`);
    return { ok: false, error: e.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(e.message) };
  } finally { clearTimeout(t); }
}

const COMBOS = {
  captions: [{ skillId: "clip.captions", name: "Captions", instructions: "captions" }],
  brainrot_caps: [{ skillId: "clip.captions", name: "Captions", instructions: "captions" }, { skillId: "clip.brainrot", name: "Brain Rot", instructions: "gameplay bg", bgLayout: "vstack" }],
  hook_zoom: [{ skillId: "clip.hook", name: "Hook", instructions: "punchy hook", hookDurationSec: 3 }, { skillId: "clip.zoom", name: "Zoom", instructions: "zoom punches" }],
  facetrack: [{ skillId: "clip.facetrack", name: "Face Track", instructions: "center face", framingMode: "pan" }],
};

async function testSource(label, resolveUrl, campaignSource) {
  console.log(`\n===== SOURCE: ${label} =====`);
  const out = { source: label, stages: {}, errors: [], clips: {}, momentCount: 0 };
  let sourceUrl;
  try { sourceUrl = await resolveUrl(); } catch (e) { out.errors.push(`resolve: ${e.message}`); return out; }
  out.sourceUrl = sourceUrl;
  console.log(`  url: ${String(sourceUrl).slice(0, 80)}`);

  const dl = await post("/api/video/download", { sourceUrl, mode: "audio" }, 290000, label);
  if (!dl.ok) { out.errors.push(`download(audio): ${dl.error}`); return out; }
  out.stages.download = `ok`;

  const tr = await post("/api/video/transcribe-clip", { sourceUrl: dl.url, campaignSource }, 240000, label);
  if (!tr.ok || !tr.segments?.length) { out.errors.push(`transcribe: ${tr.error || "no segments"}`); return out; }
  out.stages.transcribe = `ok ${tr.segments.length} segs, cached=${!!tr.cached}`;
  const transcript = { segments: tr.segments, words: tr.words ?? [], durationSeconds: tr.durationSeconds };

  // autoPlan multi-clip check
  const plan = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 5, captionsOn: true, clipLength: { min: 20, max: 60 } }, skills: [], analysis: tr.analysis, autoPlan: true }, 120000, label);
  out.momentCount = plan.plans?.length ?? (plan.moment ? 1 : 0);
  out.stages.plan = `ok ${out.momentCount} moments (autoPlan)`;
  const moment = plan.plans?.[0]?.moment ?? plan.moment;
  if (!moment) { out.errors.push("plan: no moment"); return out; }

  const seg = await post("/api/video/download", { sourceUrl, mode: "segment", start: moment.startSeconds, end: moment.endSeconds }, 290000, label);
  if (!seg.ok || !seg.url) { out.errors.push(`segment-download: ${seg.error}`); return out; }
  out.stages.segment = `ok`;
  const segDur = moment.endSeconds - moment.startSeconds;
  const words = (transcript.words || []).filter((w) => w.end > moment.startSeconds && w.start < moment.endSeconds)
    .map((w) => ({ ...w, start: +(w.start - moment.startSeconds).toFixed(3), end: +(w.end - moment.startSeconds).toFixed(3) }));

  for (const [cname, skills] of Object.entries(COMBOS)) {
    const cplan = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 1, captionsOn: true, clipLength: { min: 20, max: 60 } }, skills, analysis: tr.analysis, autoPlan: false }, 120000, `${label}:${cname}`);
    const ops = cplan.plans?.[0]?.ops ?? cplan.ops ?? [];
    const clip = await post("/api/video/clip", { sourceUrl: seg.url, startSeconds: 0, endSeconds: segDur, ops, words }, 290000, `${label}:${cname}`);
    if (!clip.ok || !clip.clipUrl) { out.clips[cname] = `FAIL: ${clip.error}`; continue; }
    try {
      const buf = Buffer.from(await (await fetch(clip.clipUrl)).arrayBuffer());
      writeFileSync(`${DIR}/e2e_${label}_${cname}.mp4`, buf);
      out.clips[cname] = `ok ${Math.round(buf.length / 1024)}KB ops=[${ops.map((o) => o.op).join("+")}]`;
    } catch (e) { out.clips[cname] = `download-clip ERR: ${e.message}`; }
  }
  return out;
}

const results = [];
results.push(await testSource("url", async () => URL_SRC, false));
results.push(await testSource("campaign", async () => {
  const cs = await post("/api/clip/campaign-sources", { rewardId: CAMPAIGN_REWARD }, 60000, "campaign-resolve");
  if (!Array.isArray(cs.videos) || cs.videos.length === 0) throw new Error(`no campaign videos: ${JSON.stringify(cs).slice(0, 140)}`);
  return cs.videos[0].url;
}, true));
results.push(await testSource("upload", async () => {
  const seg = await post("/api/video/download", { sourceUrl: URL_SRC, mode: "segment", start: 30, end: 90 }, 290000, "upload-prep");
  if (!seg.url) throw new Error(`upload-prep failed: ${seg.error}`);
  return seg.url; // a Convex storage URL — simulates an uploaded file source
}, false));

writeFileSync(`${DIR}/e2e-3source-results.json`, JSON.stringify(results, null, 2));
console.log("\n\n================ SUMMARY ================");
for (const r of results) {
  console.log(`\n### ${r.source}  (${String(r.sourceUrl).slice(0, 55)})`);
  console.log(`  stages: ${JSON.stringify(r.stages)}`);
  console.log(`  autoPlan moments: ${r.momentCount}`);
  if (r.errors.length) console.log(`  >>> ERRORS: ${r.errors.join(" | ")}`);
  console.log(`  clips: ${JSON.stringify(r.clips)}`);
}
console.log("\nDONE — clips at e2e_<source>_<combo>.mp4 for vision-judging");
