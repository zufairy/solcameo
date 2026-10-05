import { describe, expect, it, vi } from "vitest";
import { corruptAudioFallbackArgs, isCorruptAudioDecodeError, runWithDiscardCorruptFallback } from "./ffmpegBin";

const AAC_ERROR = new Error(
  "ffmpeg 69: e decoding stream #0:1: Invalid data found when processing input [aac @ 0x560d170fa640] " +
  "TNS filter order 16 is greater than maximum 12. Error while decoding stream #0:1: Invalid data found when processing input " +
  "size=  582kB time=01:09:34.87 bitrate=1.1kbits/s speed=998x Conversion failed!",
);

describe("isCorruptAudioDecodeError", () => {
  it("matches the real 'TNS filter order' ffmpeg AAC decode abort", () => {
    expect(isCorruptAudioDecodeError(AAC_ERROR)).toBe(true);
  });
  it("does not match unrelated ffmpeg failures", () => {
    expect(isCorruptAudioDecodeError(new Error("ffmpeg 1: No such file or directory"))).toBe(false);
    expect(isCorruptAudioDecodeError(new Error("ffmpeg killed: exceeded 240000ms wall clock"))).toBe(false);
  });
});

describe("corruptAudioFallbackArgs", () => {
  it("inserts err_detect/discardcorrupt as INPUT options, before -i", () => {
    const args = ["-y", "-i", "src.mp4", "-vn", "-ac", "1", "out.mp3"];
    expect(corruptAudioFallbackArgs(args)).toEqual([
      "-y", "-err_detect", "ignore_err", "-fflags", "+discardcorrupt", "-i", "src.mp4", "-vn", "-ac", "1", "out.mp3",
    ]);
  });
  it("leaves args unchanged when there's no -i to anchor on", () => {
    const args = ["-version"];
    expect(corruptAudioFallbackArgs(args)).toEqual(args);
  });
});

describe("runWithDiscardCorruptFallback", () => {
  it("retries once with the tolerant flags on a corrupt-frame decode error", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(AAC_ERROR)
      .mockResolvedValueOnce("ok");
    const result = await runWithDiscardCorruptFallback(run, ["-y", "-i", "src.mp4", "out.mp3"]);
    expect(result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(["-y", "-err_detect", "ignore_err", "-fflags", "+discardcorrupt", "-i", "src.mp4", "out.mp3"]);
  });

  it("propagates an unrelated error without retrying", async () => {
    const run = vi.fn().mockRejectedValue(new Error("ffmpeg 1: No such file or directory"));
    await expect(runWithDiscardCorruptFallback(run, ["-y", "-i", "src.mp4", "out.mp3"])).rejects.toThrow("No such file");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not retry a second time once the tolerant flags are already present", async () => {
    const run = vi.fn().mockRejectedValue(AAC_ERROR);
    const args = ["-y", "-err_detect", "ignore_err", "-fflags", "+discardcorrupt", "-i", "src.mp4", "out.mp3"];
    await expect(runWithDiscardCorruptFallback(run, args)).rejects.toBe(AAC_ERROR);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
