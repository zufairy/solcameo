// TEMP E2E — per-skill quality matrix. Downloads the shared segment ONCE, then renders
// every skill on it (concurrency-limited). Writes matrix-results.json. Unmetered. Delete after.
import { readFileSync, writeFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const SECRET = get("INTERNAL_CRON_SECRET");
const APP = "https://velloagents.com";
const SRC = process.argv[2] || "https://www.youtube.com/watch?v=U0-ttGGB7b4";
const DIR = "C:/Users/ongee/AppData/Local/Temp/claude/C--Project-Vello/de16cc55-5d7f-4eaf-a1fb-d02e1bfb7718/scratchpad";
const H = { "Content-Type": "application/json", "X-Internal-Secret": SECRET };
async function post(path, body, label = "") {
  const t = Date.now();
  const r = await fetch(APP + path, { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  const ms = Math.round((Date.now() - t) / 1000);
  if (!r.ok || j.ok === false) { console.log(`${label} ${path} FAIL ${r.status} ${String(j.error).slice(0,140)}`); throw new Error(path + " " + (j.error || r.status)); }
  console.log(`${label} ${path} ok (${ms}s)`);
  return j;
}

// yt-dlp downloads intermittently hit YouTube's bot-check (500). Retry with backoff.
async function postRetry(path, body, label = "", tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try { return await post(path, body, label + (i > 1 ? ` (retry ${i})` : "")); }
    catch (e) { if (i === tries) throw e; const wait = 10000 * i; console.log(`  ${label} retry in ${wait / 1000}s`); await new Promise((r) => setTimeout(r, wait)); }
  }
}

// ── PREP (once): audio -> transcribe -> baseline moment -> segment ───────────
console.log("PREP source=" + SRC);
const dl = await postRetry("/api/video/download", { sourceUrl: SRC, mode: "audio" }, "[prep]");
const tr = await post("/api/video/transcribe-clip", { sourceUrl: dl.url, campaignSource: false }, "[prep]");
const transcript = { segments: tr.segments ?? [], words: tr.words ?? [], durationSeconds: tr.durationSeconds ?? dl.durationSeconds };
const base = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 1, captionsOn: true, clipLength: { min: 15, max: 45 } }, skills: [], analysis: tr.analysis, autoPlan: true }, "[prep]");
const moment = base.moment ?? base.plans?.[0]?.moment;
const segDur = moment.endSeconds - moment.startSeconds;
console.log(`PREP moment ${moment.startSeconds}-${moment.endSeconds}s (${segDur}s) emotion=${moment.emotion}`);
const seg = await postRetry("/api/video/download", { sourceUrl: SRC, mode: "segment", start: moment.startSeconds, end: moment.endSeconds }, "[prep]");
const words = (transcript.words || []).filter((w) => w.end > moment.startSeconds && w.start < moment.endSeconds)
  .map((w) => ({ ...w, start: +(w.start - moment.startSeconds).toFixed(3), end: +(w.end - moment.startSeconds).toFixed(3) }));
console.log("PREP segUrl ready, words=" + words.length);

// ── SKILL MATRIX ─────────────────────────────────────────────────────────────
const SKILLS = {
  captions: [{ skillId: "clip.captions", name: "Captions", instructions: "Burn word-synced captions." }],
  facetrack: [{ skillId: "clip.facetrack", name: "Face Track", instructions: "Keep the speaker face centered.", framingMode: "pan" }],
  hook: [{ skillId: "clip.hook", name: "Auto Hook", instructions: "Add a punchy hook title overlay.", hookDurationSec: 3 }],
  title: [{ skillId: "clip.title", name: "Title", instructions: "Add a bold title overlay." }],
  zoom: [{ skillId: "clip.zoom", name: "Zoom", instructions: "Add dynamic zoom punches on emphasis." }],
  keywords: [{ skillId: "clip.captions", name: "Captions", instructions: "captions" }, { skillId: "clip.keywords", name: "Keywords", instructions: "Emphasize keywords in captions." }],
  filters: [{ skillId: "clip.filters", name: "Filters", instructions: "Apply a vivid color filter.", filterPreset: "vivid" }],
  captionstyle: [{ skillId: "clip.captionstyle", name: "Smart Captions", instructions: "ALL CAPS punchy captions.", captionPrompt: "Make the captions ALL CAPS and punchy." }],
  sticker: [{ skillId: "clip.sticker", name: "Sticker", instructions: "Add an emoji sticker overlay.", stickerStyleId: "pop", stickerPosition: "top" }],
  meme: [{ skillId: "clip.meme", name: "Meme", instructions: "Add a meme caption overlay." }],
  memeaudio: [{ skillId: "clip.memeaudio", name: "MEME SFX", instructions: "Add an emotion-driven reaction sound effect." }],
  brainrot: [{ skillId: "clip.brainrot", name: "Brain Rot", instructions: "Add a gameplay background under the clip.", bgLayout: "vstack" }],
  combo_a2: [{ skillId: "clip.captions", name: "Captions", instructions: "captions" }, { skillId: "clip.facetrack", name: "Face Track", instructions: "center face", framingMode: "pan" }, { skillId: "clip.hook", name: "Hook", instructions: "hook", hookDurationSec: 3 }, { skillId: "clip.brainrot", name: "Brain Rot", instructions: "gameplay bg", bgLayout: "vstack" }],
};

async function renderSkill(label, skills) {
  try {
    const plan = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 1, captionsOn: true, clipLength: { min: 15, max: 45 } }, skills, analysis: tr.analysis, autoPlan: true }, "[" + label + "]");
    const p0 = plan.plans?.[0] ?? { moment, ops: plan.ops };
    const ops = p0.ops ?? [];
    const clip = await post("/api/video/clip", { sourceUrl: seg.url, startSeconds: 0, endSeconds: segDur, ops, words }, "[" + label + "]");
    const buf = Buffer.from(await (await fetch(clip.clipUrl)).arrayBuffer());
    writeFileSync(`${DIR}/m_${label}.mp4`, buf);
    return { label, ok: true, ops: ops.map((o) => o.op), clipUrl: clip.clipUrl, kb: Math.round(buf.length / 1024) };
  } catch (e) {
    return { label, ok: false, error: String(e.message || e).slice(0, 200) };
  }
}

const entries = Object.entries(SKILLS);
const results = [];
const CONC = 3;
for (let i = 0; i < entries.length; i += CONC) {
  const batch = entries.slice(i, i + CONC);
  const r = await Promise.all(batch.map(([label, skills]) => renderSkill(label, skills)));
  results.push(...r);
  for (const x of r) console.log(`RESULT ${x.label}: ${x.ok ? "ok ops=" + JSON.stringify(x.ops) + " (" + x.kb + "KB)" : "FAIL " + x.error}`);
}
writeFileSync(`${DIR}/matrix-results.json`, JSON.stringify({ moment, segDur, results }, null, 2));
console.log("MATRIX DONE — " + results.filter((r) => r.ok).length + "/" + results.length + " ok");
