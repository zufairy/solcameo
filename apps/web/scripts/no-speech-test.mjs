import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const FF = "C:/Project/Vello/node_modules/ffmpeg-static/ffmpeg.exe";
const APP = "https://velloagents.com";
const H = { "Content-Type": "application/json", "X-Internal-Secret": get("INTERNAL_CRON_SECRET") };
const convex = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));
async function post(p, b, ms = 120000) { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); try { const r = await fetch(APP + p, { method: "POST", headers: H, body: JSON.stringify(b), signal: ac.signal }); const j = await r.json().catch(() => ({ ok: false, error: "non-JSON " + r.status })); return j; } catch (e) { return { ok: false, error: e.name === "AbortError" ? "timeout" : e.message }; } finally { clearTimeout(t); } }

// 1. generate a 30s 9:16 video with a non-speech TONE (audio stream present, zero speech)
const tmp = join(tmpdir(), "nospeech.mp4");
await new Promise((res, rej) => { const p = spawn(FF, ["-y", "-f", "lavfi", "-i", "testsrc=duration=30:size=720x1280:rate=30", "-f", "lavfi", "-i", "sine=frequency=300:duration=30", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", tmp], { stdio: ["ignore", "ignore", "ignore"] }); p.on("close", (c) => c === 0 ? res() : rej(new Error("ffmpeg " + c))); p.on("error", rej); });
console.log("generated no-speech video");

// 2. upload to Convex storage → a real source URL
const uploadUrl = await convex.mutation("clipStorage:generateUploadUrl", {});
const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "video/mp4" }, body: new Uint8Array(readFileSync(tmp)) });
const { storageId } = await up.json();
const srcUrl = await convex.mutation("clipStorage:resolveStorageUrl", { storageId });
console.log("uploaded → " + String(srcUrl).slice(0, 70));

// 3. run the pipeline + report how the 0-speech path is handled
const dl = await post("/api/video/download", { sourceUrl: srcUrl, mode: "audio" }, 290000);
console.log(`download: ${dl.ok ? "ok " + dl.durationSeconds + "s" : "FAIL " + dl.error}`);
if (!dl.ok) process.exit(0);
const tr = await post("/api/video/transcribe-clip", { sourceUrl: dl.url }, 240000);
console.log(`transcribe: ok=${tr.ok} segs=${tr.segments?.length ?? 0} err=${tr.error ?? "none"}`);
const transcript = { segments: tr.segments ?? [], words: tr.words ?? [], durationSeconds: tr.durationSeconds ?? 30 };
const plan = await post("/api/video/plan-moments", { transcript, clipConfig: { maxClipsPerSource: 3, captionsOn: true, clipLength: { min: 10, max: 30 } }, skills: [], analysis: tr.analysis, autoPlan: true }, 120000);
console.log(`plan-moments: ok=${plan.ok !== false} moments=${plan.plans?.length ?? (plan.moment ? 1 : 0)} err=${plan.error ?? "none"}`);
console.log("VERDICT: " + (dl.ok && (tr.ok || tr.error) ? "handled (no crash)" : "investigate"));
