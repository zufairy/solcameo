// @vitest-environment node
// Real-ffmpeg integration: every graph buildClipGraph emits must be ACCEPTED and
// rendered by ffmpeg, not just shaped right. This is the correctness gate for the
// edit-op handlers (logo / title_card / zoom_punch / freeze), which the pure
// string-level unit tests can't prove.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { buildClipGraph } from "./clipFilterGraph";
import { renderCaptionsAss } from "./captionRenderer";
import type { EditOp } from "./clipEditOps";
import type { TranscriptWord } from "./clipTypes";
import { FILTER_PRESET_IDS } from "../builder/filterStyles";
import { hookOverlayOp } from "../builder/clipSkillsCatalog";
import { HOOK_DESIGNS } from "../builder/hookDesigns";

const BIN = ffmpegPath as string;

function run(args: string[], cwd?: string, killMs?: number): Promise<{ code: number; err: string; killed: boolean }> {
  return new Promise((resolve) => {
    const p = spawn(BIN, args, { stdio: ["ignore", "ignore", "pipe"], cwd });
    let err = "", killed = false;
    // Optional SIGKILL timer so a test can ASSERT termination (a dup-explosion would
    // otherwise run to vitest's outer timeout). Cleared on close/error.
    const t = killMs ? setTimeout(() => { killed = true; try { p.kill("SIGKILL"); } catch { /* gone */ } }, killMs) : null;
    p.stderr.on("data", (d) => { err += d.toString(); if (err.length > 20000) err = err.slice(-20000); });
    p.on("error", (e) => { if (t) clearTimeout(t); resolve({ code: -1, err: String(e), killed }); });
    p.on("close", (c) => { if (t) clearTimeout(t); resolve({ code: c ?? -1, err, killed }); });
  });
}

let work: string;
let srcPath: string;
let silentSrcPath: string;
let logoPath: string;
let bgPath: string;
let shortBgPath: string;
let src24Path: string;
let bg60Path: string;
let audioPath: string;
const START = 1, END = 9; // 8s window of a 10s source

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "clipgraph-"));
  srcPath = join(work, "src.mp4");
  silentSrcPath = join(work, "silent.mp4");
  logoPath = join(work, "logo.png");
  // 10s 640x360 @25fps test video + tone, so seek/trim + reframe have real frames.
  const mk = await run(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", srcPath]);
  expect(mk.code, mk.err.slice(-400)).toBe(0);
  // A source with NO audio stream (muted screen-record / silent b-roll / AI-gen)
  // — exercises the optional-audio (0:a?) path that a mandatory [0:a] would crash.
  const ms = await run(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=10",
    "-c:v", "libx264", "-preset", "ultrafast", "-an", silentSrcPath]);
  expect(ms.code, ms.err.slice(-400)).toBe(0);
  const lg = await run(["-y", "-f", "lavfi", "-i", "color=c=red:s=160x160:d=1", "-frames:v", "1", logoPath]);
  expect(lg.code, lg.err.slice(-400)).toBe(0);
  // Gameplay background VIDEO for composite_bg (Brain Rot) — a separate 8s clip
  // (different content/size) so vstack/hstack scaling has real, distinct frames.
  bgPath = join(work, "bg.mp4");
  const bg = await run(["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=8",
    "-c:v", "libx264", "-preset", "ultrafast", "-an", bgPath]);
  expect(bg.code, bg.err.slice(-400)).toBe(0);
  // A SHORT (3s) gameplay bg — shorter than the 8s clip window — so composite_bg
  // MUST -stream_loop -1 to fill the clip. Guards the regression where looping +
  // an input -ss seek corrupted the bg PTS and vstack runaway-duped frames (hang).
  shortBgPath = join(work, "shortbg.mp4");
  const sbg = await run(["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=3",
    "-c:v", "libx264", "-preset", "ultrafast", "-an", shortBgPath]);
  expect(sbg.code, sbg.err.slice(-400)).toBe(0);
  // A 24fps source + a 60fps LONG gameplay bg — MISMATCHED cadence (not a loop case).
  // vstack is framesync: stacking a 60fps bg on a 24fps clip pane floods the encoder
  // with duped frames (out_time pinned ~0) and hangs unless BOTH panes are pinned to a
  // common CFR first. Guards the A2 dup-explosion regression. (The other composite
  // tests use a 25fps bg that matches the 25fps source, so they DON'T catch this.)
  src24Path = join(work, "src24.mp4");
  const s24 = await run(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=40",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=40",
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", src24Path]);
  expect(s24.code, s24.err.slice(-400)).toBe(0);
  bg60Path = join(work, "bg60.mp4");
  const b60 = await run(["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=60:duration=135",
    "-c:v", "libx264", "-preset", "ultrafast", "-an", bg60Path]);
  expect(b60.code, b60.err.slice(-400)).toBe(0);
  // Trending AUDIO file for audio_overlay (Meme Audio) — a short tone at a
  // different frequency so amix has a real second source.
  audioPath = join(work, "meme.m4a");
  const au = await run(["-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=3",
    "-c:a", "aac", audioPath]);
  expect(au.code, au.err.slice(-400)).toBe(0);
}, 90000);

afterAll(async () => { await rm(work, { recursive: true, force: true }).catch(() => {}); });

async function render(ops: EditOp[], extra: { assPath?: string; logoPaths?: string[]; bgPaths?: string[]; bgStartOffsets?: number[]; audioPaths?: string[]; faceCx?: number; faceCy?: number; src?: string; hasAudio?: boolean; faceShots?: Parameters<typeof buildClipGraph>[0]["faceShots"]; dualFaceShots?: Parameters<typeof buildClipGraph>[0]["dualFaceShots"]; framingMode?: Parameters<typeof buildClipGraph>[0]["framingMode"] } = {}, label = "out") {
  // 270x480 instead of the default 1080x1920: these tests assert ffmpeg ACCEPTS
  // each graph (exit code 0), which is resolution-independent — the emitted
  // topology is identical, only the numeric dims change. At full res the freeze
  // graph alone burns ~5 CPU-seconds (split doubles the stream and framesync
  // buffers ~75 full-res frames before the encoder emits anything), which times
  // out on 2-core CI runners. Dims stay even for libx264 and keep 9:16 math valid.
  const { src, ...graphExtra } = extra;
  const g = buildClipGraph({ ops, startSeconds: START, endSeconds: END, width: 270, height: 480, ...graphExtra });
  // The route writes each drawtext textfile into workDir before spawning ffmpeg;
  // the harness must do the same or drawtext fails with "Cannot read file txt0.txt".
  for (const tf of g.textFiles) await writeFile(join(work, tf.name), tf.content);
  const out = join(work, `${label}.mp4`);
  const args = [
    "-y", "-ss", String(START), "-t", String(END - START), "-i", src ?? srcPath,
    ...g.inputArgs, ...g.filterArgs,
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-movflags", "+faststart", out,
  ];
  const res = await run(args, work); // cwd=work so drawtext textfile basenames resolve
  return { res, out, usesComplex: g.usesComplex, warnings: g.warnings };
}

const reframe: EditOp = { op: "reframe", mode: "crop" };

describe("ffmpeg accepts every built graph", () => {
  it("renders every hook design WITH its motion (wipe/stagger/drop/rise + shine)", async () => {
    for (const d of HOOK_DESIGNS) {
      const op = hookOverlayOp("HE HAS TO BE MUSLIM", 4, d.id);
      const { res, out } = await render([reframe, op], {}, `hook-${d.id}`);
      expect(res.code, `${d.id}: ${res.err.slice(-900)}`).toBe(0);
      expect((await stat(out)).size).toBeGreaterThan(0);
    }
  }, 180000);

  it("renders an Always on hook (window past the clip end)", async () => {
    const op = hookOverlayOp("THE STORY BEHIND THIS", 4, "coral_punch", null, true);
    const { res } = await render([reframe, op], {}, "hook-always-on");
    expect(res.code, res.err.slice(-900)).toBe(0);
  }, 60000);

  it("reframe crop (simple -vf)", async () => {
    const { res, out, usesComplex } = await render([reframe], {}, "reframe");
    expect(usesComplex).toBe(false);
    expect(res.code, res.err.slice(-600)).toBe(0);
    expect((await stat(out)).size).toBeGreaterThan(0);
  }, 60000);

  it("reframe pad", async () => {
    const { res } = await render([{ op: "reframe", mode: "pad" }], {}, "pad");
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("subtitles burn from ASS", async () => {
    const words: TranscriptWord[] = [
      { word: "hello", start: 2, end: 2.5 }, { word: "world", start: 2.6, end: 3.2 },
      { word: "ship", start: 4, end: 4.4 }, { word: "fast", start: 4.5, end: 5 },
    ];
    const assPath = join(work, "subs.ass");
    await writeFile(assPath, renderCaptionsAss(words, { clipStartSec: START, clipEndSec: END, style: { mode: "line", fontColor: "#FFEE00", fontSize: 48, position: "bottom" } }));
    const { res } = await render([reframe, { op: "subtitles", style: { mode: "line", fontColor: "#FFEE00", fontSize: 48, position: "bottom" } }], { assPath }, "subs");
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("caption preset ASS burns (word-sync scale, \\t pop, underline, pill box)", async () => {
    // The preset engine emits inline \fscx/\t/\u1 overrides and BorderStyle=3 —
    // prove libass accepts the densest preset outputs end-to-end, not just
    // that the strings look right.
    const words: TranscriptWord[] = [
      { word: "money", start: 2, end: 2.4 }, { word: "talks", start: 2.5, end: 3 },
      { word: "loud.", start: 3.1, end: 3.6 }, { word: "Listen", start: 4, end: 4.5 },
    ];
    for (const preset of ["karaoke", "popline", "deepdiver", "bounce"]) {
      const assPath = join(work, `preset-${preset}.ass`);
      await writeFile(assPath, renderCaptionsAss(words, {
        clipStartSec: START, clipEndSec: END, width: 270, height: 480,
        style: { mode: "karaoke", fontColor: "#FFFFFF", fontSize: 48, position: "bottom", preset },
      }));
      const { res } = await render([reframe, { op: "subtitles", style: { mode: "karaoke", fontColor: "#FFFFFF", fontSize: 48, position: "bottom", preset } }], { assPath }, `preset-${preset}`);
      expect(res.code, `${preset}: ${res.err.slice(-600)}`).toBe(0);
    }
  }, 90000);

  it("text_overlay drawtext", async () => {
    const op: EditOp = { op: "text_overlay", text: "POV: you ship, it's 50% done", position: "top", startSec: 0, endSec: 3, style: { fontColor: "#ffffff", fontSize: 56, bold: true } };
    const { res } = await render([reframe, op], {}, "text");
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("logo_overlay (filter_complex, 2nd input, opacity, corner)", async () => {
    const op: EditOp = { op: "logo_overlay", imageUrl: "x", corner: "br", opacity: 0.8 };
    const { res, usesComplex } = await render([reframe, op], { logoPaths: [logoPath] }, "logo");
    expect(usesComplex).toBe(true);
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("a legacy title_card (retired) still renders the clip — without the slate", async () => {
    const op: EditOp = { op: "title_card", text: "How I ship fast", durationSec: 2, style: { fontColor: "#ffffff", fontSize: 72, bold: true } };
    const { res, warnings } = await render([reframe, op], {}, "title");
    expect(res.code, res.err.slice(-600)).toBe(0);
    expect(warnings.some((w) => w.includes("title_card"))).toBe(true);
  }, 60000);

  it("a legacy title_card over a SILENT source still renders", async () => {
    const op: EditOp = { op: "title_card", text: "How I ship fast", durationSec: 2, style: { fontColor: "rgb(0,255,0)", fontSize: 72, bold: true } };
    const { res } = await render([reframe, op], { src: silentSrcPath, hasAudio: false }, "title-silent");
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("emphasis zoom_punch", async () => {
    const op: EditOp = { op: "emphasis", kind: "zoom_punch", atSec: 3, amount: 1.3 };
    const { res } = await render([reframe, op], {}, "zoom");
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("emphasis freeze", async () => {
    const op: EditOp = { op: "emphasis", kind: "freeze", atSec: 3, amount: 0.6 };
    const { res } = await render([reframe, op], {}, "freeze");
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 120000); // slowest graph (framesync stall) — extra headroom for contended CI runners

  it("face_reframe crop expression (faceCx off-center)", async () => {
    const op: EditOp = { op: "face_reframe" };
    const { res } = await render([reframe, op], { faceCx: 0.71 }, "face");
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("smooth camera shots (pan ease + follow path) crop expression encodes end-to-end", async () => {
    const faceShots = [
      { startT: 0, endT: 2, cx: 0.3, cy: 0.4, confident: true, path: [
        { t: 0.25, cx: 0.28, cy: 0.4 }, { t: 0.75, cx: 0.34, cy: 0.42 }, { t: 1.25, cx: 0.3, cy: 0.4 }, { t: 1.75, cx: 0.32, cy: 0.41 },
      ] },
      { startT: 2, endT: 4, cx: 0.55, cy: 0.4, confident: true, transition: { kind: "pan" as const, durS: 0.5 } },
      { startT: 4, endT: 5, cx: 0.5, cy: 0.5, confident: false },
      { startT: 5, endT: 11, cx: 0.8, cy: 0.45, confident: true },
    ];
    const { res } = await render([reframe], { faceShots, framingMode: "auto" }, "smooth-cam");
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("dual camera renders two tracked faces in top/bottom panes", async () => {
    const faceShots = [
      { startT: 0, endT: 10, cx: 0.3, cy: 0.42, confident: true },
    ];
    const dualFaceShots = {
      top: [{ startT: 0, endT: 10, cx: 0.25, cy: 0.42, confident: true }],
      bottom: [{ startT: 0, endT: 10, cx: 0.76, cy: 0.45, confident: true }],
    };
    const { res, out, usesComplex } = await render(
      [reframe],
      { faceShots, dualFaceShots, framingMode: "dual" },
      "dual-camera",
    );
    expect(usesComplex).toBe(true);
    expect(res.code, res.err.slice(-800)).toBe(0);
    expect((await stat(out)).size).toBeGreaterThan(0);
  }, 60000);

  it("face_reframe without faceCx degrades to centered crop", async () => {
    const op: EditOp = { op: "face_reframe" };
    const { res } = await render([reframe, op], {}, "faceless");
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("every premium color filter burns end-to-end", async () => {
    for (const preset of FILTER_PRESET_IDS) {
      const { res } = await render([reframe, { op: "color_filter", preset, saturation: 1.05, brightness: 0.01 }], {}, `color-${preset}`);
      expect(res.code, `${preset}: ${res.err.slice(-600)}`).toBe(0);
    }
  }, 120000);

  it("composite_bg vstack (gameplay bg input + vstack)", async () => {
    const op: EditOp = { op: "composite_bg", layout: "vstack", bgUrl: "x", clipPos: "top" };
    const { res, usesComplex } = await render([reframe, op], { bgPaths: [bgPath] }, "brainrot-v");
    expect(usesComplex).toBe(true);
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("composite_bg loops a SHORT bg to clip length and TERMINATES (no -ss dup-explosion)", async () => {
    // 3s bg under the 8s clip → -stream_loop -1 must loop; vstack shortest=1 cuts to
    // the clip. The pre-fix bug (-ss on a looped input) ran away duping frames until
    // the wall clock; here exit 0 within the timeout + a sane file size proves it
    // terminates. A non-zero bgStartOffset is also passed to prove it is NOT seeked.
    const op: EditOp = { op: "composite_bg", layout: "vstack", bgUrl: "x", clipPos: "top" };
    const { res, out } = await render([reframe, op], { bgPaths: [shortBgPath], bgStartOffsets: [2] }, "brainrot-shortloop");
    expect(res.code, res.err.slice(-600)).toBe(0);
    const sz = (await stat(out)).size;
    expect(sz).toBeGreaterThan(0);
    expect(sz, `output ${sz} bytes — a dup-explosion would be enormous`).toBeLessThan(20_000_000);
  }, 60000);

  it("composite_bg over a HIGH-fps gameplay bg does NOT dup-explode (A2 regression)", async () => {
    // vstack is framesync: a 60fps gameplay bg stacked on a 24fps clip pane floods the
    // encoder with duped frames (out_time pinned ~0, dup= climbs to tens of thousands)
    // and the render hangs to the wall clock. The fix normalizes BOTH panes to fps=fps=N
    // before the stack. Pre-fix this SIGKILLs at the budget; post-fix it finishes in ~5s
    // with a clip-length output. Full 1080x1920 + libass (the real A2 case) — heavier
    // than the 270x480 accept-only tests. Renders the bundled ffmpeg-static (has libass);
    // homebrew ffmpeg has no ass filter and can't burn the ASS subtitle on the clip pane.
    const DUR = 8; // src24 is 40s; 8s keeps CI fast while still exercising the mismatch
    const words: TranscriptWord[] = [
      { word: "brain", start: 2, end: 2.4 }, { word: "rot", start: 2.5, end: 3 }, { word: "mode", start: 3.1, end: 3.6 },
    ];
    const assPath = join(work, "a2subs.ass");
    await writeFile(assPath, renderCaptionsAss(words, { clipStartSec: START, clipEndSec: START + DUR, width: 1080, height: 1920, style: { mode: "line", fontColor: "#fff", fontSize: 36, position: "bottom" }, clipPane: { layout: "vstack", spot: "center" } }));
    const ops: EditOp[] = [
      { op: "reframe", mode: "crop" },
      { op: "text_overlay", text: "HOOK", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#ffff00", fontSize: 40, bold: true } },
      { op: "subtitles", style: { mode: "line", fontColor: "#fff", fontSize: 36, position: "bottom" } },
      { op: "text_overlay", text: "more", position: "center", startSec: 3, endSec: 5, style: { fontColor: "#fff", fontSize: 36, bold: false } },
      { op: "face_reframe" },
      { op: "composite_bg", layout: "vstack", bgUrl: "x", clipPos: "top" },
    ];
    const g = buildClipGraph({ ops, startSeconds: START, endSeconds: START + DUR, width: 1080, height: 1920, assPath, bgPaths: [bg60Path], faceCy: 0.3 });
    for (const tf of g.textFiles) await writeFile(join(work, tf.name), tf.content);
    const out = join(work, "a2.mp4");
    // Mirror the route EXACTLY: no extra -map (g.filterArgs already carries -map [vout] -map 0:a?).
    // Kill at 45s: a healthy render is ~5s; a dup-explosion runs to the wall clock.
    const res = await run(["-y", "-ss", String(START), "-t", String(DUR), "-i", src24Path,
      ...g.inputArgs, ...g.filterArgs,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", out], work, 45000);
    expect(res.killed, `dup-explosion: render did not terminate — ${res.err.slice(-300)}`).toBe(false);
    expect(res.code, res.err.slice(-600)).toBe(0);
    const sz = (await stat(out)).size;
    expect(sz, `output ${sz} bytes — a dup-explosion balloons to ~50+ Mbit/s`).toBeLessThan(20_000_000);
    // output bounded to the clip window, not the 135s bg
    const probe = await run(["-hide_banner", "-i", out]);
    expect(probe.err.match(/Duration: (\d\d:\d\d:\d\d)/)?.[1]).toBe("00:00:08");
  }, 120000);

  it("composite_bg hstack (side-by-side)", async () => {
    const op: EditOp = { op: "composite_bg", layout: "hstack", bgUrl: "x", clipPos: "left" };
    const { res } = await render([reframe, op], { bgPaths: [bgPath] }, "brainrot-h");
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("composite_bg + faceCx/faceCy: face-aware pane crop encodes (end-to-end)", async () => {
    const v: EditOp = { op: "composite_bg", layout: "vstack", bgUrl: "x", clipPos: "top" };
    const { res: rv } = await render([reframe, v], { bgPaths: [bgPath], faceCy: 0.3 }, "brainrot-face-v");
    expect(rv.code, rv.err.slice(-600)).toBe(0);
    const h: EditOp = { op: "composite_bg", layout: "hstack", bgUrl: "x", clipPos: "left" };
    const { res: rh } = await render([reframe, h], { bgPaths: [bgPath], faceCx: 0.3 }, "brainrot-face-h");
    expect(rh.code, rh.err.slice(-600)).toBe(0);
  }, 60000);

  it("composite_bg + subtitles + text_overlay: caption/overlay burn on the CLIP pane (end-to-end)", async () => {
    // The caption + hook overlay must render on the clip pane (pane-local coords),
    // before the vstack — prove the whole chain (pane scale → subtitles → drawtext →
    // vstack) is a graph ffmpeg actually accepts, not just a string that looks right.
    const words: TranscriptWord[] = [
      { word: "brain", start: 2, end: 2.4 }, { word: "rot", start: 2.5, end: 3 }, { word: "mode", start: 3.1, end: 3.6 },
    ];
    const assPath = join(work, "brsubs.ass");
    await writeFile(assPath, renderCaptionsAss(words, { clipStartSec: START, clipEndSec: END, style: { mode: "line", fontColor: "#FFFFFF", fontSize: 36, position: "bottom" }, width: 270, height: 480, clipPane: { layout: "vstack", spot: "center" } }));
    const bg: EditOp = { op: "composite_bg", layout: "vstack", bgUrl: "x", clipPos: "top" };
    const ov: EditOp = { op: "text_overlay", text: "HOOK", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#ffff00", fontSize: 30, bold: true } };
    const sub: EditOp = { op: "subtitles", style: { mode: "line", fontColor: "#FFFFFF", fontSize: 36, position: "bottom" } };
    const { res, usesComplex } = await render([reframe, sub, ov, bg], { assPath, bgPaths: [bgPath] }, "brainrot-caption");
    expect(usesComplex).toBe(true);
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("audio_overlay (adelay + volume + amix → [aout])", async () => {
    const op: EditOp = { op: "audio_overlay", audioUrl: "x", atSec: 2, gainDb: -3, durationSec: 2 };
    const { res, usesComplex } = await render([reframe, op], { audioPaths: [audioPath] }, "memeaudio");
    expect(usesComplex).toBe(true);
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("audio_overlay over a SILENT source (amix onto generated silence)", async () => {
    const op: EditOp = { op: "audio_overlay", audioUrl: "x", atSec: 1, gainDb: 0 };
    const { res } = await render([reframe, op], { audioPaths: [audioPath], src: silentSrcPath, hasAudio: false }, "memeaudio-silent");
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("audio_overlay with a stray (retired) title_card still mixes (→ [aout])", async () => {
    const title: EditOp = { op: "title_card", text: "Hook line", durationSec: 1.5, style: { fontColor: "#fff", fontSize: 64, bold: true } };
    const audio: EditOp = { op: "audio_overlay", audioUrl: "x", atSec: 0.5, gainDb: -2 };
    const { res } = await render([reframe, title, audio], { audioPaths: [audioPath] }, "title-memeaudio");
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 90000);

  it("combined: zoom + text + subtitles + logo in one graph", async () => {
    const words: TranscriptWord[] = [{ word: "ship", start: 3, end: 3.5 }, { word: "fast", start: 3.6, end: 4 }];
    const assPath = join(work, "subs2.ass");
    await writeFile(assPath, renderCaptionsAss(words, { clipStartSec: START, clipEndSec: END, style: { mode: "karaoke", fontColor: "#FFEE00", fontSize: 48, position: "bottom" } }));
    const ops: EditOp[] = [
      reframe,
      { op: "emphasis", kind: "zoom_punch", atSec: 2 },
      { op: "text_overlay", text: "hook line", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 48, bold: true } },
      { op: "subtitles", style: { mode: "karaoke", fontColor: "#FFEE00", fontSize: 48, position: "bottom" } },
      { op: "logo_overlay", imageUrl: "x", corner: "tr", opacity: 0.7 },
    ];
    const { res, warnings } = await render(ops, { assPath, logoPaths: [logoPath] }, "combined");
    expect(warnings).toEqual([]);
    expect(res.code, res.err.slice(-800)).toBe(0);
  }, 90000);
});

// Real-ffmpeg proof that the two bug-hunt CRASH fixes (#11, #13) actually render —
// the pre-fix graphs made ffmpeg exit non-zero on these exact inputs.
describe("ffmpeg — bug-hunt crash regressions (2026-06-29)", () => {
  it("[#13] full/pad letterbox on a TALLER-than-9:16 source encodes (was: pad-cannot-shrink crash)", async () => {
    // A portrait source taller than the canvas: the old `scale=W:-2` overflowed the
    // height so pad errored "Padded dimensions cannot be smaller than input". The
    // decrease-fit shrinks within BOTH dims first, so pad only ever adds bars.
    const tallSrc = join(work, "tall.mp4");
    const mk = await run(["-y", "-f", "lavfi", "-i", "testsrc2=size=270x600:rate=25:duration=10",
      "-c:v", "libx264", "-preset", "ultrafast", "-an", tallSrc]);
    expect(mk.code, mk.err.slice(-400)).toBe(0);
    const { res } = await render([reframe, { op: "face_reframe", mode: "full" }], { src: tallSrc, hasAudio: false }, "full-tall");
    expect(res.code, res.err.slice(-600)).toBe(0);
  }, 60000);

  it("[#11] composite_bg + title_card on a 4:5 (odd-half) canvas encodes (was: concat dim-mismatch crash)", async () => {
    // 4:5 height 270 → round(135) is ODD → an even-half pane (134) made the composite
    // 216x268, 2px short of the 216x270 title slate → concat HARD-ERRORS. The bg pane
    // now takes the remainder (136) so the panes sum to EXACTLY the canvas.
    const ops: EditOp[] = [
      { op: "reframe", mode: "crop" },
      { op: "composite_bg", layout: "vstack", bgUrl: "x", clipPos: "top" },
      { op: "title_card", text: "Hook", durationSec: 1, style: { fontColor: "#fff", fontSize: 40, bold: true } },
    ];
    const g = buildClipGraph({ ops, startSeconds: START, endSeconds: END, width: 216, height: 270, bgPaths: [bgPath] });
    for (const tf of g.textFiles) await writeFile(join(work, tf.name), tf.content);
    const out = join(work, "brainrot-title-45.mp4");
    const res = await run(["-y", "-ss", String(START), "-t", String(END - START), "-i", srcPath,
      ...g.inputArgs, ...g.filterArgs,
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-movflags", "+faststart", out], work);
    expect(res.code, res.err.slice(-800)).toBe(0);
    expect((await stat(out)).size).toBeGreaterThan(0);
  }, 60000);
});
