// @vitest-environment node
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isChannelLayoutError, monoFallbackArgs, resolveFfmpegPath, runWithMonoFallback } from "./ffmpegBin";

const ff = resolveFfmpegPath();
function run(args: string[]): Promise<void> {
  const r = spawnSync(ff!, args, { encoding: "utf8" });
  return r.status === 0 ? Promise.resolve() : Promise.reject(new Error(`ffmpeg ${r.status}: ${r.stderr.slice(-400)}`));
}

describe("mono downmix fallback", () => {
  it("swaps only the -ac 1 pair for the pan filter", () => {
    expect(monoFallbackArgs(["-y", "-i", "in", "-vn", "-ac", "1", "-ar", "16000", "out"]))
      .toEqual(["-y", "-i", "in", "-vn", "-af", "pan=mono|c0=c0", "-ar", "16000", "out"]);
    expect(isChannelLayoutError(new Error("between 32 channels and mono but there is not enough information to do it"))).toBe(true);
    expect(isChannelLayoutError(new Error("No such file or directory"))).toBe(false);
  });

  it.skipIf(!ff)("extracts mono audio from an unlabeled 32-channel source (the prod failure)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mono-"));
    const src = join(dir, "c32.wav");
    const labels = Array.from({ length: 32 }, (_, i) => `[a${i}]`).join("");
    await run(["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-filter_complex", `[0:a]asplit=32${labels};${labels}amerge=inputs=32`, "-c:a", "pcm_s16le", src]);
    const args = ["-y", "-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", "-f", "mp3", join(dir, "out.mp3")];
    await expect(run(args)).rejects.toThrow(); // plain -ac 1 fails, like prod
    await runWithMonoFallback(run, args);       // fallback succeeds
    expect(statSync(join(dir, "out.mp3")).size).toBeGreaterThan(1000);
  });
});
