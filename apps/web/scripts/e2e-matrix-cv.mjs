// E2E matrix + CV-prep — renders EVERY skill on one segment via the deployed routes,
// downloads each clip, and extracts frames (+ audio astats) so a vision pass can judge
// each skill's actual rendered output. Writes results to the session scratchpad.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const SECRET = get("INTERNAL_CRON_SECRET");
const APP = "https://velloagents.com";
const SRC = process.argv[2] || "https://www.youtube.com/watch?v=ENhfIeZF_AY&t=1039s";
const DIR = "C:/Users/ongee/AppData/Local/Temp/claude/C--Project-Vello/923ccbc4-975e-4368-a1cc-8e272f2cb376/scratchpad/matrix";
const FFMPEG = "C:/Project/Vello/node_modules/ffmpeg-static/ffmpeg.exe";
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const H = { "Content-Type": "application/json", "X-Internal-Secret": SECRET };
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function post(path, body, label = "", timeoutMs = 240000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t = Date.now();
  try {
    const r = await fetch(APP + path, { method: "POST", headers: H, body: JSON.stringify(body), signal: ac.signal });
    const j = await r.json().catch(() => ({}));
    const s = Math.round((Date.now() - t) / 1000);
    if (!r.ok || j.ok === false) { log(`${label} ${path} FAIL ${r.status} (${s}s) ${String(j.error).slice(0, 160)}`); throw new Error(path + " " + (j.error || r.status)); }
    log(`${label} ${path} ok (${s}s)`);
    return j;
  } catch (e) {
    if (e.name === "AbortError") { log(`${label} ${path} TIMEOUT ${Math.round(timeoutMs/1000)}s`); throw new Error(path + " timeout"); }
    throw e;
  } finally { clearTimeout(timer); }
}
async function postRetry(path, body, label = "", tries = 4, timeoutMs = 240000) {
  for (let i = 1; i <= tries; i++) {
    try { return await post(path, body, label + (i > 1 ? ` (retry ${i})` : ""), timeoutMs); }
    catch (e) { if (i === tries) throw e; const w = 12000 * i; log(`  ${label} retry in ${w / 1000}s (${String(e.message).slice(0,80)})`); await new Promise((r) => setTimeout(r, w)); }
  }
}

// ── PREP (once): audio → transcribe → baseline moment → segment ──────────────
log("PREP source=" + SRC);
const dl = await postRetry("/api/video/download", { sourceUrl: SRC, mode: "audio" }, "[prep]");
const tr = await post("/api/video/transcribe-clip", { sourceUrl: dl.url, campaignSource: false }, "[prep]");
const transcript = { segments: tr.segments ?? [], words: tr.words ?? [], durationSeconds: tr.durationSeconds ?? dl.durationSeconds };
log(`PREP transcript segs=${transcript.segments.length} words=${transcript.words.length} dur=${transcript.durationSeconds}s`);
const base = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 1, captionsOn: true, clipLength: { min: 15, max: 45 } }, skills: [], analysis: tr.analysis, autoPlan: true }, "[prep]");
const moment = base.moment ?? base.plans?.[0]?.moment;
const segDur = moment.endSeconds - moment.startSeconds;
log(`PREP moment ${moment.startSeconds}-${moment.endSeconds}s (${segDur}s) emotion=${moment.emotion} title="${(moment.title||"").slice(0,60)}"`);
const words = (transcript.words || []).filter((w) => w.end > moment.startSeconds && w.start < moment.endSeconds)
  .map((w) => ({ ...w, start: +(w.start - moment.startSeconds).toFixed(3), end: +(w.end - moment.startSeconds).toFixed(3) }));
const sampleText = words.slice(0, 30).map((w) => w.word ?? w.text ?? "").join(" ");
log(`PREP words=${words.length} sample="${sampleText.slice(0,90)}" — fresh segment per skill`);
// FRESH segment URL per skill — the previous run reused ONE storage URL that died
// when the backend flapped (BackendIsNotRunning). Re-downloading per skill is robust.
async function freshSeg() {
  const s = await postRetry("/api/video/download", { sourceUrl: SRC, mode: "segment", start: moment.startSeconds, end: moment.endSeconds }, "[seg]");
  return s.url;
}

// ── SKILL MATRIX ─────────────────────────────────────────────────────────────
const SKILLS = {
  captions:    [{ skillId: "clip.captions", name: "Captions", instructions: "Burn word-synced captions." }],
  facetrack:   [{ skillId: "clip.facetrack", name: "Face Track", instructions: "Keep the speaker face centered.", framingMode: "pan" }],
  hook:        [{ skillId: "clip.hook", name: "Auto Hook", instructions: "Add a punchy hook title overlay.", hookDurationSec: 3 }],
  title:       [{ skillId: "clip.title", name: "Title", instructions: "Add a bold title overlay." }],
  zoom:        [{ skillId: "clip.zoom", name: "Zoom", instructions: "Add dynamic zoom punches on emphasis." }],
  keywords:    [{ skillId: "clip.captions", name: "Captions", instructions: "captions" }, { skillId: "clip.keywords", name: "Keywords", instructions: "Emphasize keywords in captions." }],
  filters:     [{ skillId: "clip.filters", name: "Filters", instructions: "Apply a vivid color filter.", filterPreset: "vivid" }],
  captionstyle:[{ skillId: "clip.captionstyle", name: "Smart Captions", instructions: "ALL CAPS punchy captions.", captionPrompt: "Make the captions ALL CAPS and punchy." }],
  sticker:     [{ skillId: "clip.sticker", name: "Sticker", instructions: "Add an emoji sticker overlay.", stickerStyleId: "pop", stickerPosition: "top" }],
  meme:        [{ skillId: "clip.meme", name: "Meme", instructions: "Add a meme caption overlay." }],
  memeaudio:   [{ skillId: "clip.memeaudio", name: "MEME SFX", instructions: "Add an emotion-driven reaction sound effect." }],
  brainrot:    [{ skillId: "clip.brainrot", name: "Brain Rot", instructions: "Add a gameplay background under the clip.", bgLayout: "vstack" }],
  combo_all:   [{ skillId: "clip.captions", name: "Captions", instructions: "captions" }, { skillId: "clip.facetrack", name: "Face Track", instructions: "center face", framingMode: "pan" }, { skillId: "clip.hook", name: "Hook", instructions: "hook", hookDurationSec: 3 }, { skillId: "clip.brainrot", name: "Brain Rot", instructions: "gameplay bg", bgLayout: "vstack" }],
};

function extractFrames(mp4Path, label, durSec) {
  // Spread up to 8 frames across the whole clip (incl. the 0-3s hook window).
  const fdir = `${DIR}/frames`;
  if (!existsSync(fdir)) mkdirSync(fdir, { recursive: true });
  const fps = durSec > 0 ? Math.max(0.2, 8 / durSec) : 0.4; // ~8 frames over the clip
  const r = spawnSync(FFMPEG, ["-y", "-i", mp4Path, "-vf", `fps=${fps.toFixed(3)},scale=540:-1`, "-frames:v", "8", `${fdir}/${label}_f%02d.jpg`], { encoding: "utf8" });
  // Audio loudness (deterministic SFX presence signal) via astats max_volume.
  const a = spawnSync(FFMPEG, ["-i", mp4Path, "-af", "astats=metadata=1", "-f", "null", "-"], { encoding: "utf8" });
  const peak = (a.stderr || "").match(/Max(?:imum)? volume:\s*(-?[\d.]+) dB/i)?.[1]
            ?? (a.stderr || "").match(/Peak level dB:\s*(-?[\d.]+)/i)?.[1] ?? null;
  const rms = (a.stderr || "").match(/RMS level dB:\s*(-?[\d.]+)/i)?.[1] ?? null;
  return { ffOk: r.status === 0, peakDb: peak, rmsDb: rms };
}

async function renderSkill(label, skills) {
  try {
    const plan = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 1, captionsOn: true, clipLength: { min: 15, max: 45 } }, skills, analysis: tr.analysis, autoPlan: true }, "[" + label + "]");
    const p0 = plan.plans?.[0] ?? { moment, ops: plan.ops };
    const ops = p0.ops ?? [];
    let clip;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const segUrl = await freshSeg();
      try { clip = await post("/api/video/clip", { sourceUrl: segUrl, startSeconds: 0, endSeconds: segDur, ops, words }, "[" + label + "]"); break; }
      catch (e) { if (attempt === 2) throw e; log(`  [${label}] render retry (${String(e.message).slice(0,60)})`); await new Promise((r) => setTimeout(r, 8000)); }
    }
    const mp4 = `${DIR}/m_${label}.mp4`;
    const buf = Buffer.from(await (await fetch(clip.clipUrl)).arrayBuffer());
    writeFileSync(mp4, buf);
    const fx = extractFrames(mp4, label, segDur);
    log(`RESULT ${label}: ok ops=${JSON.stringify(ops.map((o) => o.op))} ${Math.round(buf.length/1024)}KB peak=${fx.peakDb}dB`);
    return { label, ok: true, ops: ops.map((o) => o.op), opsFull: ops, clipUrl: clip.clipUrl, kb: Math.round(buf.length / 1024), mp4, ...fx };
  } catch (e) {
    log(`RESULT ${label}: FAIL ${String(e.message || e).slice(0, 160)}`);
    return { label, ok: false, error: String(e.message || e).slice(0, 220) };
  }
}

const entries = Object.entries(SKILLS);
const results = [];
const CONC = 2;
for (let i = 0; i < entries.length; i += CONC) {
  const batch = entries.slice(i, i + CONC);
  const r = await Promise.all(batch.map(([label, skills]) => renderSkill(label, skills)));
  results.push(...r);
}
writeFileSync(`${DIR}/matrix-results.json`, JSON.stringify({ source: SRC, moment, segDur, sampleText, results }, null, 2));
log("MATRIX DONE — " + results.filter((r) => r.ok).length + "/" + results.length + " ok → " + DIR);
