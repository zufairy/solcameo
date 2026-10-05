// @vitest-environment node
/**
 * Real-ffmpeg proof that the Video Filters app (clip.filters) actually burns its
 * grade into EVERY frame of the clip.
 *
 * The string-level graph tests only prove the chain is present in the command; they
 * cannot catch a grade that renders on part of the timeline (or on the wrong stream
 * once another op forces the filter_complex path). This renders real clips, samples
 * frames at the START, MIDDLE and END, and measures saturation — B&W is the perfect
 * probe because "did it apply" reduces to "is there any colour left".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { buildClipGraph } from "./clipFilterGraph";
import type { EditOp } from "./clipEditOps";

const BIN = ffmpegPath as string;

function run(args: string[], cwd?: string): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(BIN, args, { stdio: ["ignore", "ignore", "pipe"], cwd });
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); if (err.length > 20000) err = err.slice(-20000); });
    p.on("error", (e) => resolve({ code: -1, err: String(e) }));
    p.on("close", (c) => resolve({ code: c ?? -1, err }));
  });
}

/**
 * Mean chroma distance from grey at `atSec`, 0..~180.
 *
 * `signalstats` reports SATMAX/SATAVG per frame; a greyscale frame has SATAVG ~0
 * while the colour bars of testsrc2 sit far above it. Reading the AVERAGE rather
 * than the max keeps a single stray pixel from deciding the test.
 */
async function saturationAt(file: string, atSec: number): Promise<number> {
  const { err } = await run([
    "-hide_banner", "-nostats",
    "-ss", String(atSec), "-i", file, "-frames:v", "1",
    "-vf", "signalstats,metadata=print",
    "-f", "null", "-",
  ]);
  const m = err.match(/lavfi\.signalstats\.SATAVG=([0-9.]+)/);
  return m ? parseFloat(m[1]) : Number.NaN;
}

let work: string;
let srcPath: string;
const START = 1, END = 9;

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "colorfilter-"));
  srcPath = join(work, "src.mp4");
  // testsrc2 is heavily saturated colour bars — the strongest possible signal that
  // a greyscale grade did or did not land.
  const mk = await run(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", srcPath]);
  expect(mk.code, mk.err.slice(-400)).toBe(0);
}, 120_000);

afterAll(async () => { await rm(work, { recursive: true, force: true }).catch(() => {}); });

async function render(label: string, ops: EditOp[]): Promise<string> {
  const g = buildClipGraph({ ops, startSeconds: START, endSeconds: END, width: 270, height: 480 });
  for (const tf of g.textFiles) await writeFile(join(work, tf.name), tf.content);
  const out = join(work, `${label}.mp4`);
  const res = await run([
    "-y", "-ss", String(START), "-t", String(END - START), "-i", srcPath,
    ...g.inputArgs, ...g.filterArgs,
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-movflags", "+faststart", out,
  ], work);
  expect(res.code, res.err.slice(-800)).toBe(0);
  return out;
}

describe("clip.filters — the grade burns into the whole clip", () => {
  it("the ungraded clip is genuinely colourful (control)", async () => {
    const out = await render("plain", [{ op: "reframe", mode: "crop" }]);
    expect(await saturationAt(out, 4)).toBeGreaterThan(20);
  }, 120_000);

  // The report was "I applied B&W and it did not apply". Sampling all three points
  // is the difference between "the filter ran" and "the filter ran on everything".
  it("B&W leaves no colour at the start, middle OR end", async () => {
    const out = await render("bw", [{ op: "reframe", mode: "crop" }, { op: "color_filter", preset: "bw" }]);
    const dur = END - START;
    for (const at of [0.2, dur / 2, dur - 0.4]) {
      const sat = await saturationAt(out, at);
      expect(sat, `frame at ${at.toFixed(1)}s still has colour (SATAVG ${sat})`).toBeLessThan(3);
    }
  }, 180_000);

  // A second op pushes the build onto the filter_complex path, where the grade is a
  // separate segment — the case where a colour grade is easiest to silently lose.
  it("survives the filter_complex path (grade + zoom punch)", async () => {
    const out = await render("bw-complex", [
      { op: "reframe", mode: "crop" },
      { op: "color_filter", preset: "bw" },
      { op: "emphasis", kind: "zoom_punch", atSec: 2 },
    ]);
    for (const at of [0.2, 4, 7.4]) {
      const sat = await saturationAt(out, at);
      expect(sat, `complex-path frame at ${at}s still has colour (SATAVG ${sat})`).toBeLessThan(3);
    }
  }, 180_000);

  // A Hook Title Card is a SEPARATE lavfi slate concatenated in front of the body,
  // so the body-only grade left it in full colour — a B&W clip that opens on a
  // colour card, which is what "it did not apply to the whole video" looks like.
  it("grades the title slate too, not just the body", async () => {
    const out = await render("bw-title", [
      { op: "reframe", mode: "crop" },
      { op: "color_filter", preset: "bw" },
      { op: "title_card", text: "BREAKING", durationSec: 2, style: { fontColor: "#ffffff", fontSize: 64, bold: true, bgColor: "#C81E1E" } },
    ]);
    // 0.5s is inside the 2s slate; 4s is well into the body.
    expect(await saturationAt(out, 0.5), "the title slate is still in colour").toBeLessThan(3);
    expect(await saturationAt(out, 4)).toBeLessThan(3);
  }, 180_000);

  it("a saturation slider alone still grades the whole clip", async () => {
    const out = await render("desat", [{ op: "reframe", mode: "crop" }, { op: "color_filter", saturation: 0 }]);
    for (const at of [0.2, 4, 7.4]) {
      expect(await saturationAt(out, at)).toBeLessThan(3);
    }
  }, 180_000);
});

/**
 * The Transitions app documents the title-slate→body join as one of the seams it
 * styles, but that join was a hard `concat` — the operator's pick only ever reached
 * the CTA join and the multi-clip stitch, so picking a transition changed nothing
 * inside a clip.
 */
describe("clip.transitions — no title seam (slate retired)", () => {
  const titleOp: EditOp = { op: "title_card", text: "BREAKING", durationSec: 2, style: { fontColor: "#ffffff", fontSize: 64, bold: true } };

  // The opening slate was the only "seam" a picked transition blended into. With
  // title_card retired, a stray one is dropped: no concat, no xfade, and the clip
  // itself still renders from its first frame.
  it("drops the slate, emits no seam transition, and still renders", async () => {
    const g = buildClipGraph({
      ops: [{ op: "reframe", mode: "crop" }, titleOp],
      startSeconds: START, endSeconds: END, width: 270, height: 480,
      transition: { id: "fade", durationSec: 0.5 },
    });
    const args = g.filterArgs.join(" ");
    expect(args).not.toContain("concat=n=2");
    expect(args).not.toContain("xfade=");

    for (const tf of g.textFiles) await writeFile(join(work, tf.name), tf.content);
    const out = join(work, "seam.mp4");
    const res = await run(["-y", "-ss", String(START), "-t", String(END - START), "-i", srcPath,
      ...g.inputArgs, ...g.filterArgs,
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", out], work);
    expect(res.code, res.err.slice(-800)).toBe(0);
  }, 180_000);
});
