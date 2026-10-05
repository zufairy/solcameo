import { readFileSync, writeFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const H = { "Content-Type": "application/json", "X-Internal-Secret": get("INTERNAL_CRON_SECRET") };
const APP = "https://velloagents.com";
const DIR = "C:/Users/ongee/AppData/Local/Temp/claude/C--Project-Vello/de16cc55-5d7f-4eaf-a1fb-d02e1bfb7718/scratchpad";
const SRC = "https://www.youtube.com/watch?v=U0-ttGGB7b4";
async function post(p, b, ms = 120000) { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); try { const r = await fetch(APP + p, { method: "POST", headers: H, body: JSON.stringify(b), signal: ac.signal }); const j = await r.json().catch(() => ({ ok: false })); if (!r.ok || j.ok === false) console.log(`  ${p} FAIL ${r.status}: ${String(j.error).slice(0,90)}`); return j; } finally { clearTimeout(t); } }
const dl = await post("/api/video/download", { sourceUrl: SRC, mode: "audio" }, 290000);
const tr = await post("/api/video/transcribe-clip", { sourceUrl: dl.url }, 240000);
const transcript = { segments: tr.segments, words: tr.words ?? [], durationSeconds: tr.durationSeconds };
const base = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 1, captionsOn: true, clipLength: { min: 20, max: 60 } }, skills: [], analysis: tr.analysis, autoPlan: true }, 120000);
const m = base.plans?.[0]?.moment ?? base.moment;
const seg = await post("/api/video/download", { sourceUrl: SRC, mode: "segment", start: m.startSeconds, end: m.endSeconds }, 290000);
const segDur = m.endSeconds - m.startSeconds;
const words = (transcript.words || []).filter((w) => w.end > m.startSeconds && w.start < m.endSeconds).map((w) => ({ ...w, start: +(w.start - m.startSeconds).toFixed(3), end: +(w.end - m.startSeconds).toFixed(3) }));
const skills = [{ skillId: "clip.captions", name: "Captions", instructions: "captions" }, { skillId: "clip.brainrot", name: "Brain Rot", instructions: "gameplay bg", bgId: "random", bgLayout: "vstack" }];
const plan = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 1, captionsOn: true, clipLength: { min: 20, max: 60 } }, skills, analysis: tr.analysis, autoPlan: false }, 120000);
const ops = plan.plans?.[0]?.ops ?? [];
console.log("OPS: [" + ops.map((o) => o.op).join("+") + "]  (composite_bg present = " + ops.some((o) => o.op === "composite_bg") + ")");
const clip = await post("/api/video/clip", { sourceUrl: seg.url, startSeconds: 0, endSeconds: segDur, ops, words }, 290000);
if (clip.ok && clip.clipUrl) { writeFileSync(`${DIR}/brainrot_verify.mp4`, Buffer.from(await (await fetch(clip.clipUrl)).arrayBuffer())); console.log("SAVED brainrot_verify.mp4"); }
else console.log("CLIP FAIL: " + clip.error);
