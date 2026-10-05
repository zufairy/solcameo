// BACKEND EDGE-CASE HUNT — does the pipeline fail GRACEFULLY (clear error, no crash) on
// hard inputs, and work on valid-but-unusual ones? Tests ingestion + transcription + plan
// + a render. Unmetered (direct routes). Delete after.
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const SECRET = get("INTERNAL_CRON_SECRET");
const APP = "https://velloagents.com";
const H = { "Content-Type": "application/json", "X-Internal-Secret": SECRET };

async function post(path, body, timeoutMs = 120000, label = "") {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const r = await fetch(APP + path, { method: "POST", headers: H, body: JSON.stringify(body), signal: ac.signal });
    const j = await r.json().catch(() => ({ ok: false, error: `non-JSON ${r.status}` }));
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(`  [${label}] ${path.split("/").pop()} -> ${r.ok && j.ok !== false ? "ok" : "FAIL " + r.status} (${secs}s) ${j.error ? ": " + String(j.error).slice(0, 110) : ""}`);
    return { ...j, _http: r.status };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: e.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(e.message), _threw: true };
  } finally { clearTimeout(t); }
}

const EDGES = [
  { label: "direct_mp4_nospeech", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4", render: true },
  { label: "short_source_15s", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", render: true },
  { label: "invalid_url_404", url: "https://velloagents.com/this-is-not-a-real-video-404.mp4", render: false },
  { label: "tiktok", url: "https://www.tiktok.com/@mimietaksukachoc/video/7634508222056992021", render: false },
];

async function testEdge(e) {
  console.log(`\n===== EDGE: ${e.label} =====\n  ${e.url}`);
  const out = { label: e.label, stages: {}, error: null, segs: 0, moments: 0, clip: null, graceful: null };
  const dl = await post("/api/video/download", { sourceUrl: e.url, mode: "audio" }, 290000, e.label);
  if (!dl.ok) { out.error = `download: ${dl.error}`; out.graceful = !dl._threw && !!dl.error; return out; }
  out.stages.download = `ok ${dl.durationSeconds ?? "?"}s`;
  const tr = await post("/api/video/transcribe-clip", { sourceUrl: dl.url }, 240000, e.label);
  out.segs = tr.segments?.length ?? 0;
  if (!tr.ok) { out.error = `transcribe: ${tr.error}`; out.graceful = !tr._threw && !!tr.error; return out; }
  out.stages.transcribe = `ok ${out.segs} segs`;
  const transcript = { segments: tr.segments ?? [], words: tr.words ?? [], durationSeconds: tr.durationSeconds };
  const plan = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 3, captionsOn: true, clipLength: { min: 20, max: 60 } }, skills: [], analysis: tr.analysis, autoPlan: true }, 120000, e.label);
  out.moments = plan.plans?.length ?? (plan.moment ? 1 : 0);
  out.stages.plan = plan.ok === false ? `FAIL: ${plan.error}` : `ok ${out.moments} moments`;
  const m = plan.plans?.[0]?.moment ?? plan.moment;
  if (e.render && m) {
    const seg = await post("/api/video/download", { sourceUrl: e.url, mode: "segment", start: m.startSeconds, end: m.endSeconds }, 290000, e.label);
    if (seg.ok && seg.url) {
      const segDur = m.endSeconds - m.startSeconds;
      const cplan = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 1, captionsOn: true, clipLength: { min: 20, max: 60 } }, skills: [{ skillId: "clip.captions", name: "Captions", instructions: "captions" }], analysis: tr.analysis, autoPlan: false }, 120000, e.label);
      const ops = cplan.plans?.[0]?.ops ?? [];
      const clip = await post("/api/video/clip", { sourceUrl: seg.url, startSeconds: 0, endSeconds: segDur, ops, words: [] }, 290000, e.label);
      out.clip = clip.ok ? `ok ops=[${ops.map((o) => o.op).join("+")}]` : `FAIL: ${clip.error}`;
    } else out.clip = `segment FAIL: ${seg.error}`;
  }
  out.graceful = true;
  return out;
}

const results = [];
for (const e of EDGES) results.push(await testEdge(e));
console.log("\n\n================ EDGE SUMMARY ================");
for (const r of results) {
  console.log(`\n### ${r.label}`);
  console.log(`  stages: ${JSON.stringify(r.stages)} | segs=${r.segs} moments=${r.moments}`);
  if (r.error) console.log(`  error: ${r.error}  (graceful=${r.graceful})`);
  if (r.clip) console.log(`  render: ${r.clip}`);
}
console.log("\nDONE");
