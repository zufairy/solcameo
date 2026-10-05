// E2E for the campaign (daddymin Drive) + upload (storage mp4) sources — runs each
// through the deployed pipeline (download→transcribe→plan→segment→render key skills),
// downloads clips, extracts frames for the CV pass. Complements e2e-matrix-cv.mjs
// (which does the full skill matrix on the paste-URL source).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const SECRET = get("INTERNAL_CRON_SECRET");
const APP = "https://velloagents.com";
const DIR = "C:/Users/ongee/AppData/Local/Temp/claude/C--Project-Vello/923ccbc4-975e-4368-a1cc-8e272f2cb376/scratchpad/matrix";
const FDIR = `${DIR}/frames`;
const FFMPEG = "C:/Project/Vello/node_modules/ffmpeg-static/ffmpeg.exe";
for (const d of [DIR, FDIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
const H = { "Content-Type": "application/json", "X-Internal-Secret": SECRET };
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function post(path, body, label = "", timeoutMs = 290000) {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeoutMs); const t = Date.now();
  try {
    const r = await fetch(APP + path, { method: "POST", headers: H, body: JSON.stringify(body), signal: ac.signal });
    const j = await r.json().catch(() => ({}));
    const s = Math.round((Date.now() - t) / 1000);
    if (!r.ok || j.ok === false) { log(`${label} ${path} FAIL ${r.status} (${s}s) ${String(j.error).slice(0,150)}`); throw new Error(j.error || `HTTP ${r.status}`); }
    log(`${label} ${path} ok (${s}s)`); return j;
  } catch (e) { if (e.name === "AbortError") { log(`${label} ${path} TIMEOUT`); throw new Error("timeout"); } throw e; }
  finally { clearTimeout(timer); }
}
async function retry(fn, label, tries = 3) { for (let i=1;i<=tries;i++){ try { return await fn(); } catch(e){ if(i===tries) throw e; const w=12000*i; log(`  ${label} retry ${i} in ${w/1000}s (${String(e.message).slice(0,70)})`); await new Promise(r=>setTimeout(r,w)); } } }

function extract(mp4, label, dur) {
  const fps = dur > 0 ? Math.max(0.2, 8 / dur) : 0.4;
  spawnSync(FFMPEG, ["-y","-i",mp4,"-vf",`fps=${fps.toFixed(3)},scale=540:-1`,"-frames:v","8",`${FDIR}/${label}_f%02d.jpg`], { encoding: "utf8" });
  const a = spawnSync(FFMPEG, ["-i",mp4,"-af","astats=metadata=1","-f","null","-"], { encoding: "utf8" });
  const peak = (a.stderr||"").match(/Max(?:imum)? volume:\s*(-?[\d.]+) dB/i)?.[1] ?? null;
  return { peakDb: peak };
}

const SKILLS = {
  captions: [{ skillId: "clip.captions", name: "Captions", instructions: "Burn word-synced captions." }],
  hook:     [{ skillId: "clip.hook", name: "Auto Hook", instructions: "Add a punchy hook title overlay.", hookDurationSec: 3 }],
  sticker:  [{ skillId: "clip.sticker", name: "Sticker", instructions: "Add an emoji sticker overlay.", stickerStyleId: "pop", stickerPosition: "top" }],
  brainrot: [{ skillId: "clip.captions", name: "Captions", instructions: "captions" }, { skillId: "clip.brainrot", name: "Brain Rot", instructions: "gameplay bg", bgLayout: "vstack" }],
  combo:    [{ skillId: "clip.captions", name: "Captions", instructions: "captions" }, { skillId: "clip.facetrack", name: "Face Track", instructions: "center", framingMode: "pan" }, { skillId: "clip.hook", name: "Hook", instructions: "hook", hookDurationSec: 3 }, { skillId: "clip.brainrot", name: "Brain Rot", instructions: "bg", bgLayout: "vstack" }],
};

async function runSource(label, sourceUrl, campaignSource) {
  log(`\n===== SOURCE ${label} =====`);
  const out = { label, sourceUrl, stages: {}, momentCount: 0, clips: {} };
  try {
    const dl = await retry(() => post("/api/video/download", { sourceUrl, mode: "audio" }, `[${label}]`), `${label} dl`);
    out.stages.download = "ok";
    const tr = await post("/api/video/transcribe-clip", { sourceUrl: dl.url, campaignSource }, `[${label}]`);
    if (!tr.segments?.length) throw new Error("transcribe: no segments");
    out.stages.transcribe = `ok ${tr.segments.length} segs`;
    const transcript = { segments: tr.segments, words: tr.words ?? [], durationSeconds: tr.durationSeconds };
    const plan = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 5, captionsOn: true, clipLength: { min: 15, max: 45 } }, skills: [], analysis: tr.analysis, autoPlan: true }, `[${label}]`);
    out.momentCount = plan.plans?.length ?? (plan.moment ? 1 : 0);
    const moment = plan.plans?.[0]?.moment ?? plan.moment;
    if (!moment) throw new Error("plan: no moment");
    out.stages.plan = `ok ${out.momentCount} moments`;
    const segDur = moment.endSeconds - moment.startSeconds;
    const segUrl = await retry(() => post("/api/video/download", { sourceUrl, mode: "segment", start: moment.startSeconds, end: moment.endSeconds }, `[${label}seg]`).then((s) => s.url), `${label} seg`);
    const words = (transcript.words||[]).filter(w=>w.end>moment.startSeconds&&w.start<moment.endSeconds).map(w=>({...w,start:+(w.start-moment.startSeconds).toFixed(3),end:+(w.end-moment.startSeconds).toFixed(3)}));
    out.stages.segment = "ok";
    for (const [sk, skills] of Object.entries(SKILLS)) {
      try {
        const cp = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 1, captionsOn: true, clipLength: { min: 15, max: 45 } }, skills, analysis: tr.analysis, autoPlan: false }, `[${label}:${sk}]`);
        const ops = cp.plans?.[0]?.ops ?? cp.ops ?? [];
        let clip;
        for (let at = 1; at <= 2; at++) { try { clip = await post("/api/video/clip", { sourceUrl: segUrl, startSeconds: 0, endSeconds: segDur, ops, words }, `[${label}:${sk}]`); break; } catch (e) { if (at === 2) throw e; await new Promise((r) => setTimeout(r, 8000)); } }
        const mp4 = `${DIR}/s_${label}_${sk}.mp4`;
        const buf = Buffer.from(await (await fetch(clip.clipUrl)).arrayBuffer());
        writeFileSync(mp4, buf);
        const fx = extract(mp4, `${label}_${sk}`, segDur);
        out.clips[sk] = { ok: true, ops: ops.map(o=>o.op), kb: Math.round(buf.length/1024), peakDb: fx.peakDb };
        log(`RESULT ${label}:${sk} ok ops=${JSON.stringify(ops.map(o=>o.op))} ${out.clips[sk].kb}KB`);
      } catch (e) { out.clips[sk] = { ok: false, error: String(e.message).slice(0,150) }; log(`RESULT ${label}:${sk} FAIL ${String(e.message).slice(0,120)}`); }
    }
  } catch (e) { out.error = String(e.message).slice(0,200); log(`SOURCE ${label} FAILED: ${out.error}`); }
  return out;
}

const SOURCES = [
  { label: "campaign", src: "https://drive.google.com/file/d/1Adz2uM873czOqJGP6Z5z2q60oXQ9xJfS/view", campaign: true },
  { label: "upload", src: "https://bold-ram-39.convex.cloud/api/storage/27c6549e-7c49-4b5e-93f8-d949be846087", campaign: false },
];
const results = [];
for (const s of SOURCES) results.push(await runSource(s.label, s.src, s.campaign));
writeFileSync(`${DIR}/sources-results.json`, JSON.stringify(results, null, 2));
log("SOURCES DONE → " + DIR);
