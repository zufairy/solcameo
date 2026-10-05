// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { writeVelloWatermark } from "./velloWatermark";
import { withVelloWatermark, VELLO_WATERMARK_ASSET } from "../builder/velloWatermark";
import { normalizeClipConfig } from "../builder/clipConfig";
import { buildClipGraph } from "./clipFilterGraph";
import { planClipEdits } from "./clipEditPlanner";

describe("Vello watermark", () => {
  it("defaults on, preserves off, and reaches the fallback render plan", async () => {
    expect(normalizeClipConfig({}).velloWatermark).toBe(true);
    const args = { skills: [], config: normalizeClipConfig({ captionsOn: false }), window: [], moment: { startSeconds: 0, endSeconds: 2, title: "Test", captionText: "Test", reason: "test", viralScore: 1 } };
    const down = { callJSON: async () => { throw new Error("offline"); } };
    const on = await planClipEdits(args, down);
    expect(on.some((o) => o.op === "logo_overlay" && o.imageUrl === VELLO_WATERMARK_ASSET)).toBe(true);
    const off = await planClipEdits({ ...args, config: normalizeClipConfig({ captionsOn: false, velloWatermark: false }) }, down);
    expect(off.some((o) => o.op === "logo_overlay")).toBe(false);
    expect(withVelloWatermark(on, true)).toEqual(on);
  });

  it.each([[270, 480], [480, 270], [270, 270]])("burns visible logo pixels only when enabled at %sx%s", async (width, height) => {
    const dir = await mkdtemp(join(tmpdir(), "vello-watermark-test-"));
    try {
      const logo = await writeVelloWatermark(join(dir, "watermark.png"), width, height);
      for (const enabled of [true, false]) {
        const graph = buildClipGraph({ ops: withVelloWatermark([{ op: "reframe", mode: "pad" }], enabled), startSeconds: 0, endSeconds: 1, width, height, hasAudio: false, logoPaths: enabled ? [logo] : [] });
        const output = spawnSync(ffmpeg!, ["-v", "error", "-f", "lavfi", "-i", `color=black:s=${width}x${height}:d=1`, ...graph.inputArgs, ...graph.filterArgs, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
        expect(output.status, output.stderr.toString()).toBe(0);
        const pixels = output.stdout;
        expect(pixels.length).toBe(width * height * 3);
        const bright = [...pixels].filter((v) => v > 100).length;
        if (enabled) expect(bright).toBeGreaterThan(50);
        else expect(bright).toBe(0);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
