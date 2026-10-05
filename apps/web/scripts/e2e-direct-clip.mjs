// TEMP E2E — direct-routes clip (audio-first). Renders ONE clip for a source + optional
// skills, downloads it locally for frame inspection. Unmetered (no billing). Delete after.
import { readFileSync, writeFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const SECRET = get("INTERNAL_CRON_SECRET");
const APP = "https://velloagents.com";
const SRC = process.argv[2] || "https://www.youtube.com/watch?v=U0-ttGGB7b4";
const LABEL = process.argv[3] || "baseline";
const OUT = `C:/Users/ongee/AppData/Local/Temp/claude/C--Project-Vello/de16cc55-5d7f-4eaf-a1fb-d02e1bfb7718/scratchpad/clip_${LABEL}.mp4`;
// optional: a JSON array of skill objects as argv[4]
const SKILLS = process.argv[4] ? JSON.parse(process.argv[4]) : [];

const H = { "Content-Type": "application/json", "X-Internal-Secret": SECRET };
async function post(path, body) {
  const t = Date.now();
  const r = await fetch(APP + path, { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  console.log(`${path} -> HTTP ${r.status} (${Math.round((Date.now() - t) / 1000)}s)${j.ok === false ? " ERR:" + String(j.error).slice(0, 160) : ""}`);
  if (!r.ok || j.ok === false) throw new Error(path + " failed: " + (j.error || r.status));
  return j;
}

console.log(`SOURCE ${SRC}  LABEL ${LABEL}  SKILLS ${SKILLS.map(s => s.skillId).join(",") || "(none)"}`);
const dl = await post("/api/video/download", { sourceUrl: SRC, mode: "audio" });
console.log("  audio dur=" + dl.durationSeconds);
const tr = await post("/api/video/transcribe-clip", { sourceUrl: dl.url, campaignSource: false });
console.log("  segments=" + (tr.segments?.length ?? 0) + " words=" + (tr.words?.length ?? 0) + " analysisMoments=" + (tr.analysis?.moments?.length ?? 0));
const transcript = { segments: tr.segments ?? [], words: tr.words ?? [], durationSeconds: tr.durationSeconds ?? dl.durationSeconds };
const plan = await post("/api/video/plan-moments", {
  transcript, clipConfig: { maxClipsPerSource: 1, captionsOn: true, clipLength: { min: 15, max: 45 } },
  skills: SKILLS, analysis: tr.analysis, autoPlan: true,
});
const moment = plan.moment ?? plan.plans?.[0]?.moment;
const ops = plan.ops ?? plan.plans?.[0]?.ops ?? [];
console.log("  moment " + moment.startSeconds + "-" + moment.endSeconds + "s emotion=" + (moment.emotion || "-") + " ops=" + JSON.stringify(ops.map(o => o.op)));
const seg = await post("/api/video/download", { sourceUrl: SRC, mode: "segment", start: moment.startSeconds, end: moment.endSeconds });
const segDur = moment.endSeconds - moment.startSeconds;
const words = (transcript.words || []).filter((w) => w.end > moment.startSeconds && w.start < moment.endSeconds)
  .map((w) => ({ ...w, start: +(w.start - moment.startSeconds).toFixed(3), end: +(w.end - moment.startSeconds).toFixed(3) }));
const clip = await post("/api/video/clip", { sourceUrl: seg.url, startSeconds: 0, endSeconds: segDur, ops, words });
console.log("CLIP_URL " + clip.clipUrl);
const buf = Buffer.from(await (await fetch(clip.clipUrl)).arrayBuffer());
writeFileSync(OUT, buf);
console.log("SAVED " + OUT + " (" + Math.round(buf.length / 1024) + " KB)");
console.log("DONE");
