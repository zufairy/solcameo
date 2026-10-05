import { readFileSync, writeFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const H = { "Content-Type": "application/json", "X-Internal-Secret": get("INTERNAL_CRON_SECRET") };
const APP = "https://velloagents.com";
const DIR = "C:/Users/ongee/AppData/Local/Temp/claude/C--Project-Vello/de16cc55-5d7f-4eaf-a1fb-d02e1bfb7718/scratchpad";
const SRC = "https://www.youtube.com/watch?v=U0-ttGGB7b4";
async function post(p, b, ms = 120000) { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); try { const r = await fetch(APP + p, { method: "POST", headers: H, body: JSON.stringify(b), signal: ac.signal }); const j = await r.json().catch(() => ({ ok: false, error: "non-JSON " + r.status })); if (!r.ok || j.ok === false) console.log(`  ${p} FAIL ${r.status}: ${String(j.error).slice(0,100)}`); return j; } catch (e) { return { ok: false, error: e.name === "AbortError" ? "timeout" : e.message }; } finally { clearTimeout(t); } }
const dl = await post("/api/video/download", { sourceUrl: SRC, mode: "audio" }, 290000);
const tr = await post("/api/video/transcribe-clip", { sourceUrl: dl.url }, 240000);
const transcript = { segments: tr.segments, words: tr.words ?? [], durationSeconds: tr.durationSeconds };
const base = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 1, captionsOn: true, clipLength: { min: 20, max: 60 } }, skills: [], analysis: tr.analysis, autoPlan: true }, 120000);
const m = base.plans?.[0]?.moment ?? base.moment;
const seg = await post("/api/video/download", { sourceUrl: SRC, mode: "segment", start: m.startSeconds, end: m.endSeconds }, 290000);
const segDur = m.endSeconds - m.startSeconds;
const words = (transcript.words || []).filter((w) => w.end > m.startSeconds && w.start < m.endSeconds).map((w) => ({ ...w, start: +(w.start - m.startSeconds).toFixed(3), end: +(w.end - m.startSeconds).toFixed(3) }));
// HEAVY stack: captions + keywords + hook + zoom + meme + filters + facetrack
const skills = [
  { skillId: "clip.captions", name: "Captions", instructions: "captions" },
  { skillId: "clip.keywords", name: "Keywords", instructions: "emphasize keywords" },
  { skillId: "clip.hook", name: "Hook", instructions: "punchy hook", hookDurationSec: 3 },
  { skillId: "clip.zoom", name: "Zoom", instructions: "zoom punches" },
  { skillId: "clip.meme", name: "Meme", instructions: "meme caption" },
  { skillId: "clip.filters", name: "Filters", instructions: "vivid", filterPreset: "vivid" },
  { skillId: "clip.facetrack", name: "Face Track", instructions: "center face", framingMode: "pan" },
];
const plan = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 1, captionsOn: true, clipLength: { min: 20, max: 60 } }, skills, analysis: tr.analysis, autoPlan: false }, 120000);
const ops = plan.plans?.[0]?.ops ?? [];
console.log("FULL-STACK OPS: [" + ops.map((o) => o.op).join(", ") + "]  (" + ops.length + " ops)");
const clip = await post("/api/video/clip", { sourceUrl: seg.url, startSeconds: 0, endSeconds: segDur, ops, words }, 290000);
if (clip.ok && clip.clipUrl) { writeFileSync(`${DIR}/fullstack.mp4`, Buffer.from(await (await fetch(clip.clipUrl)).arrayBuffer())); console.log("SAVED fullstack.mp4 — RENDER OK with " + ops.length + " ops"); if (clip.warnings) console.log("warnings: " + JSON.stringify(clip.warnings)); }
else console.log("FULL-STACK RENDER FAILED: " + clip.error);
