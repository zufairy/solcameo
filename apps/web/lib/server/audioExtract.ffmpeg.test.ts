// @vitest-environment node
// Real-ffmpeg integration for the whole-source AUDIO extract (the Google-Drive
// campaign-clip timeout fix). runAudioExtract must turn a video into a TINY
// audio-only artifact — both stream-through (pipe:0, the >2GB path, never lands
// the video on disk) and from a file (the moov-at-end disk fallback). A pure
// string test can't prove ffmpeg actually strips video + downmixes, so we run it.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { runAudioExtract } from "./downloader";

const BIN = ffmpegPath as string;

function run(args: string[]): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); if (err.length > 20000) err = err.slice(-20000); });
    p.on("error", (e) => resolve({ code: -1, err: String(e) }));
    p.on("close", (c) => resolve({ code: c ?? -1, err }));
  });
}

/** ffmpeg `-i` probe → the stderr that names the streams + duration. */
async function probe(path: string): Promise<string> {
  return (await run(["-i", path])).err;
}

function streamFromBuffer(buf: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });
}

let work: string;
let faststartMp4: string;   // moov-at-front → decodable from a pipe
let moovAtEndMp4: string;   // default mux → NOT pipe-decodable (disk-fallback case)

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "vello-aext-"));
  faststartMp4 = join(work, "faststart.mp4");
  moovAtEndMp4 = join(work, "regular.mp4");
  // 2s of color-bars video + a 440Hz tone. One with +faststart, one without.
  const mk = (out: string, faststart: boolean) => run([
    "-y",
    "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    ...(faststart ? ["-movflags", "+faststart"] : []),
    out,
  ]);
  const a = await mk(faststartMp4, true);
  const b = await mk(moovAtEndMp4, false);
  expect(a.code, `fixture build failed: ${a.err.slice(-300)}`).toBe(0);
  expect(b.code).toBe(0);
}, 60000);

afterAll(async () => {
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

describe("runAudioExtract — whole-source audio (campaign-clip timeout fix)", () => {
  it("STREAM-THROUGH (pipe:0) extracts audio-only from a faststart mp4 — no video, ~source duration, tiny", async () => {
    const out = join(work, "stream.mp3");
    const srcBytes = await readFile(faststartMp4);
    await runAudioExtract(BIN, "pipe:0", out, streamFromBuffer(srcBytes));

    const { size } = await stat(out);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(srcBytes.byteLength); // audio-only ⇒ smaller than the video

    const info = await probe(out);
    expect(info).toMatch(/Audio:\s*mp3/i);     // produced mp3 audio
    expect(info).not.toMatch(/Video:/i);       // video genuinely stripped (-vn)
    expect(info).toMatch(/Duration:\s*00:00:0[12]/); // ~2s, not truncated
    expect(info).toMatch(/\b16000 Hz\b/);      // downmixed to 16kHz for STT
  }, 60000);

  it("FILE input extracts audio-only (the moov-at-end disk fallback)", async () => {
    const out = join(work, "file.mp3");
    await runAudioExtract(BIN, moovAtEndMp4, out);

    const info = await probe(out);
    expect(info).toMatch(/Audio:\s*mp3/i);
    expect(info).not.toMatch(/Video:/i);
    expect(info).toMatch(/Duration:\s*00:00:0[12]/);
  }, 60000);

  it("rejects on a non-zero ffmpeg exit (bad input) so the caller can fall back", async () => {
    const out = join(work, "nope.mp3");
    await writeFile(join(work, "garbage.bin"), Buffer.from("not a media file at all"));
    await expect(runAudioExtract(BIN, join(work, "garbage.bin"), out)).rejects.toThrow(/audio-extract exited/i);
  }, 60000);
});
